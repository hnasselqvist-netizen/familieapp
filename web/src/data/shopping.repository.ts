/**
 * Datalag for handlelisten (`families/{familyId}/shopping`).
 *
 * Skrivemønster: målrettede skrivinger til ÉN VARE sin egen node
 * (`shopping/{id}`) — aldri hele listen tilbake. Dagens `index.html`
 * (`ShoppingScreen`, linje ~4902–4933, og `setShopping`, linje ~16468)
 * leser/skriver HELE listen ved enhver endring (opprett/fjern/kryss av/
 * rediger/tøm fullførte) — samme risikoklasse som Fryser/Kokebok/
 * Middagsplan hadde før de ble fikset.
 *
 * **To ulike "legg til"-flyter i dagens kode:**
 *  - `ShoppingScreen.add()` (linje ~4926–4933) — det raske skrivefeltet.
 *    ALDRI dedup-sjekk, oppretter alltid en ny post. Dette er
 *    `createShoppingItem` under.
 *  - `MatScreen.onAddToList()` — når generatoren (PR #5) legger til flere
 *    varer samtidig. DEDUP-sjekker mot eksisterende, ikke-fullførte poster
 *    (samme navn). Den rene logikken for dette (`mergeIntoShoppingList`,
 *    §generators/shopping/shopping.ts) ble portert i PR #5; skrivestien
 *    er `addBatchToShoppingList` under (Fase 2, Handlelistegenerator-
 *    skjermen) — se dens egen kommentar for skrivestrategien.
 *
 * **Funn, samme klasse som Kokebok/Middagsplan/Handlelistegenerator sine
 * tilsvarende funn:** RTDB dropper `itemId:null` ved skriving. Dagens
 * `ShoppingScreen.add()` skriver alltid en ekte `itemId` (fra
 * `finnEllerOpprettVare`), men `ShoppingListEntry`-typen (og en fremtidig
 * `mergeIntoShoppingList`-skriving) tillater `itemId:null` — normalisert
 * på lesing under for å være korrekt uansett skrivevei.
 */
import { onValue, ref, remove, runTransaction, set } from "firebase/database";
import { databaseRestUrl, getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type {
  SammenslaingsInfo,
  ShoppingItem,
  ShoppingListEntry,
  ShoppingMergeRules,
} from "@app-types/shopping";

function shoppingPath(familyId: FamilyId): string {
  return `families/${familyId}/shopping`;
}

function shoppingItemPath(familyId: FamilyId, id: string): string {
  return `${shoppingPath(familyId)}/${id}`;
}

/**
 * Reserverte metadata-nøkler direkte under `shopping` (Issue #27 / PR #40,
 * Kontrolltårn-beslutning 5950478583): `shopping/_ops/{requestId}` er
 * MCP-flatens idempotens-metadata og ALDRI en vare. Alle nøkler som starter
 * med `_` hoppes over eksplisitt ved lesing — vareposter har alltid
 * `crypto.randomUUID()`/legacy-`uid()`-nøkler, som aldri starter med `_`.
 * Samme regel som `isReservedShoppingKey` i `mcp-server/src/store/shoppingOps.ts`.
 */
export function isReservedShoppingKey(key: string): boolean {
  return key.startsWith("_");
}

function parseShoppingListEntry(raw: Record<string, unknown>): ShoppingListEntry {
  return {
    itemId: (raw.itemId as string | null | undefined) ?? null,
    name: raw.name as string,
    amount: (raw.amount as string | undefined) ?? "",
    cat: (raw.cat as string | undefined) ?? "Diverse",
    done: (raw.done as boolean | undefined) ?? false,
  };
}

/** Kort info om en angrebar sammenslåing på raden (Mat #20), ellers `undefined`. */
function parseSammenslaingsInfo(raw: Record<string, unknown>): SammenslaingsInfo | undefined {
  const h = raw.sammenslaing as Record<string, unknown> | undefined;
  if (!h || typeof h !== "object" || typeof h.opId !== "string") return undefined;
  const kilder = h.kilder && typeof h.kilder === "object" ? Object.keys(h.kilder) : [];
  return {
    opId: h.opId,
    tidspunkt: typeof h.tidspunkt === "string" ? h.tidspunkt : "",
    antallKilder: kilder.length,
  };
}

/** Abonnerer på hele handlelisten. Returnerer en avmeldingsfunksjon. */
export function subscribeShoppingList(
  familyId: FamilyId,
  onChange: (items: ShoppingItem[]) => void,
): () => void {
  const listRef = ref(getFirebaseDatabase(), shoppingPath(familyId));
  const unsubscribe = onValue(listRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange([]);
      return;
    }
    const value = snapshot.val() as Record<string, Record<string, unknown>>;
    onChange(
      Object.entries(value)
        .filter(([id]) => !isReservedShoppingKey(id))
        .map(([id, fields]) => {
          const sammenslaing = parseSammenslaingsInfo(fields);
          return {
            id,
            ...parseShoppingListEntry(fields),
            ...(sammenslaing ? { sammenslaing } : {}),
          };
        }),
    );
  });
  return unsubscribe;
}

/**
 * Oppretter en ny handlelistepost på sin egen node. Speiler
 * `ShoppingScreen.add()` 1:1 — ALDRI en dedup-sjekk mot eksisterende
 * poster (det er kun `mergeIntoShoppingList`-flyten som gjør det, se
 * filens toppkommentar).
 *
 * **`id` skrives også INNE i posten** (PR #40, Kontrolltårn-beslutning
 * 5950478583 pkt. 3): legacy `setShopping` skriver hele noden tilbake som
 * `Object.fromEntries(next.map(i=>[i.id,i]))`. En post uten eget `id`-felt
 * ville da havne under nøkkelen `"undefined"` — og flere slike poster
 * kollapse til én. Feltet er additivt; `parseShoppingListEntry` ignorerer det.
 */
export async function createShoppingItem(
  familyId: FamilyId,
  fields: ShoppingListEntry,
): Promise<ShoppingItem> {
  const id = crypto.randomUUID();
  await set(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)), { ...fields, id });
  return { id, ...fields };
}

/**
 * Snur `done` på én post. Speiler `ShoppingScreen.toggle()` (linje ~4913).
 * Transaksjon fordi den nye verdien er beregnet FRA den gjeldende (`!done`)
 * — samme begrunnelse som Fryserens batch-justering.
 *
 * **Funn under implementering:** `current===null` her betyr IKKE
 * pålitelig "posten finnes ikke" — RTDB sin `runTransaction` kjører
 * updateren spekulativt mot en lokalt bufret (potensielt kald/tom) verdi
 * FØR den har bekreftet mot serveren, og kaller den PÅ NYTT med riktig
 * verdi hvis den første gjetningen var feil — MEN kun dersom updateren
 * returnerer en KONKRET verdi (som Firebase kan sammenligne mot
 * server-verdien). Returneres `undefined`, tolkes det som et bevisst
 * "avbryt hele transaksjonen NÅ" (samme signal som `addRecipeToMeal` sitt
 * ekte duplikat-tilfelle i Middagsplan-motoren) — den kjøres ALDRI på
 * nytt, selv om posten faktisk fantes på serveren. En tidlig versjon som
 * returnerte `undefined` her feilet derfor i praksis alltid mot en post
 * uten et aktivt `onValue`-abonnement fra før (kald cache) — oppdaget av
 * denne funksjonens egen integrasjonstest. Riktig mønster (som
 * Fryser/Middagsplan sine tilsvarende "kanskje finnes ikke"-tilfeller):
 * returner `null` — en gyldig, konkret verdi som deltar normalt i
 * sammenlign-og-skriv-protokollen, og som er en harmløs no-op dersom
 * posten faktisk er borte.
 */
export async function toggleShoppingItemDone(familyId: FamilyId, id: string): Promise<void> {
  await runTransaction(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)), (current) => {
    if (!current) return null;
    const raw = current as Record<string, unknown>;
    const parsed = parseShoppingListEntry(raw);
    // Rå node spres (ikke den parsede femfelts-formen), så felt appen ikke
    // selv kjenner — særlig `id` (se `createShoppingItem`) — bevares.
    return { ...raw, ...parsed, done: !parsed.done };
  });
}

/**
 * Oppdaterer ett felt (f.eks. `amount`/`cat`/`name`) på én post. Speiler
 * `ShoppingScreen.updateItem()` (linje ~4916).
 *
 * **Transaksjon som krever en eksisterende post** (Mat #20, review
 * 6353438086 pkt. 4): et ubetinget `update()` på `shopping/{id}` ville
 * gjenopprette en DELVIS rad (bare det ene feltet) hvis posten ble fjernet
 * i mellomtiden — f.eks. slått sammen på en annen klient mens feltet ble
 * redigert her. Nå skrives feltet bare inn i en post som faktisk finnes,
 * og alle andre felt (også ukjente) bevares. To samtidige redigeringer av
 * ULIKE felt overlever fortsatt begge: hver transaksjon kjøres på nytt mot
 * den ferske verdien. `null` ved kald cache er en konkret no-op (se
 * `toggleShoppingItemDone`), aldri en avbrytende `undefined`.
 */
export async function updateShoppingItemField(
  familyId: FamilyId,
  id: string,
  field: "name" | "amount" | "cat",
  value: string,
): Promise<void> {
  await runTransaction(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)), (current) => {
    if (!current || typeof current !== "object") return null;
    return { ...(current as Record<string, unknown>), [field]: value };
  });
}

/** Fjerner én handlelistepost. Speiler `ShoppingScreen.remove()` (linje ~4914). */
export async function removeShoppingItem(familyId: FamilyId, id: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)));
}

/**
 * Fjerner alle fullførte poster. Speiler `ShoppingScreen.clearDone()`
 * (linje ~4915) — bruker `items` (en allerede lest liste) kun til å velge
 * HVILKE id-er som er slette-KANDIDATER, aldri til å avgjøre om de faktisk
 * skal slettes.
 *
 * **Funn under Kontrolltårn-review:** en tidligere versjon skrev
 * kandidatenes stier direkte til `null` i ett flerpost-`update()`-kall
 * basert på DEN LESTE listens `done`-flagg. Det er en stale-read-race: en
 * bruker som rekker å krysse en av disse postene TILBAKE til
 * `done:false` mellom lesingen og skrivingen, ville likevel fått den
 * slettet — funksjonen sjekket aldri serverens FAKTISKE verdi på
 * slettetidspunktet, kun det øyeblikksbildet den fikk oppgitt. Rettet
 * ved å slette hver kandidat gjennom sin egen transaksjon, som verifiserer
 * `done===true` på den FERSKESTE server-verdien før noden settes til
 * `null` — er den ikke lenger `done` (eller allerede borte), avbrytes
 * transaksjonen (`undefined`) og posten overlever, urørt.
 */
export async function clearDoneShoppingItems(
  familyId: FamilyId,
  items: ShoppingItem[],
): Promise<void> {
  const doneIds = items.filter((i) => i.done).map((i) => i.id);
  await Promise.all(
    doneIds.map((id) =>
      runTransaction(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)), (current) => {
        if (!current) return null;
        const parsed = parseShoppingListEntry(current as Record<string, unknown>);
        return parsed.done ? null : undefined;
      }),
    ),
  );
}

/**
 * Legger til flere handlelisteposter samtidig — skrivesiden av
 * `mergeIntoShoppingList` (§generators/shopping/shopping.ts). Selve
 * dedup-/sammenslåingsregelen injiseres som `rules`
 * (§domain/shopping/handlelisteRules.ts) — samme regel som generatoren og
 * Kontrolltårnets MCP-flate bruker. Kalt fra
 * Handlelistegeneratorens "Legg til N varer"-steg (Fase 2). `existing` er
 * en allerede lest liste, brukt KUN til å velge hvilken post (om noen) hver
 * nye vare er en dedup-KANDIDAT for — akkurat som `clearDoneShoppingItems`
 * sin `items`-parameter — aldri til å avgjøre den faktiske skrivingen.
 *
 * Én hel-samling-transaksjon ble bevisst IKKE valgt her, selv om det ville
 * vært den enkleste måten å speile `mergeIntoShoppingList` sin rene
 * fold-over-hele-listen-semantikk 1:1: det bryter med det etablerte
 * mønsteret i resten av denne filen (og Fryser/Kokebok/Middagsplan/
 * Middagsbibliotek), der ALDRI mer enn én post sin egen node transaksjoneres
 * om gangen. I stedet verifiseres hver dedup-KANDIDAT mot ferskeste
 * servertilstand i sin egen transaksjon, FØR mengden faktisk slås sammen —
 * samme prinsipp som `clearDoneShoppingItems` sin stale-read-race-fiks.
 *
 * Går bevisst IKKE ut for å hindre at to poster i SAMME kall med samme navn
 * (men ulik enhet — kan overleve `mergeShoppingItems` sin navn+enhet-dedup)
 * slår seg sammen med HVERANDRE slik dagens sekvensielle
 * `mergeIntoShoppingList`-fold ville gjort — et allerede dokumentert,
 * kjent avvik i dagens kode (§generators/shopping/shopping.ts sin
 * `mergeIntoShoppingList`-kommentar: "matcher KUN på navn, kan i teorien
 * summere ulike enheter sammen"). Denne funksjonen matcher hver nye vare
 * kun mot `existing`-øyeblikksbildet, aldri mot andre nye varer i samme
 * batch — et bevisst, dokumentert forenklingsvalg for en allerede
 * inkonsekvent kanttilfelle, ikke en ny regresjon.
 *
 * **Samme klasse feller som `toggleShoppingItemDone`/`transactMealDay`/
 * `transactMealLibraryEntry`, unngått her på en litt annen måte:**
 * updateren returnerer ALDRI `undefined` — heller ikke når `current` er
 * `null` på et speculativt (kaldt cache-)kall, eller når posten er `done`/
 * navnet ikke lenger matcher, eller når mengdene ikke begge er tall. I
 * ALLE disse tilfellene returneres en KONKRET, uendret verdi (`null`
 * eller den rå noden urørt), slik at Firebase alltid får lov til å
 * sammenligne mot — og om nødvendig prøve updateren PÅ NYTT mot — den
 * faktiske ferskeste servertilstanden, i stedet for å avbryte permanent
 * på et første, potensielt utdatert gjettet svar. Fordi transaksjonen
 * derfor ALDRI avbrytes, er `result.committed` ubrukelig til å skille
 * "slo sammen"/"lot stå urørt" fra "kandidaten er faktisk borte" — i
 * stedet sjekkes `result.snapshot.exists()` etter transaksjonen: finnes
 * noden fortsatt (uansett om den ble endret eller bevisst latt urørt), er
 * utfallet riktig og ferdig; finnes den IKKE, er kandidaten reelt slettet
 * mellom `existing` ble lest og nå, og varen legges til som en ny post i
 * stedet — den skal aldri stille forsvinne.
 */
export async function addBatchToShoppingList(
  familyId: FamilyId,
  existing: ShoppingItem[],
  newEntries: ShoppingListEntry[],
  rules: ShoppingMergeRules,
): Promise<void> {
  for (const entry of newEntries) {
    const candidate = rules.findMergeCandidate(existing, entry);
    if (!candidate) {
      await createShoppingItem(familyId, entry);
      continue;
    }

    const result = await runTransaction(
      ref(getFirebaseDatabase(), shoppingItemPath(familyId, candidate.id)),
      (current) => {
        if (!current) return null;
        const raw = current as Record<string, unknown>;
        const merged = rules.mergeShoppingAmount(parseShoppingListEntry(raw), entry);
        // Speiler mergeIntoShoppingList: kun tallmengder slås faktisk sammen —
        // ellers (eller når posten ikke lenger er kandidat) er posten allerede
        // "der", og etterlates urørt (ingen ny rad). Rå node spres, så `id`
        // og andre ukjente felt bevares (se `toggleShoppingItemDone`).
        return merged ? { ...raw, ...merged } : raw;
      },
    );

    if (!result.snapshot.exists()) {
      await createShoppingItem(familyId, entry);
    }
  }
}

/** Utfallet av en beslutning tatt mot den ferske `shopping`-noden. */
export interface NodeBeslutning {
  utfall: "anvendt" | "allerede" | "konflikt" | "ubekreftet";
  grunn?: string;
  /** Ny node ved `anvendt`; ellers ignorert. */
  node: unknown;
}

/** Utfallet av en innlegging (Mat #20, ordre 6830803229). */
export type InnleggingsSkriveutfall =
  | { utfall: "anvendt" | "allerede" }
  | { utfall: "konflikt"; grunn: string; treff?: boolean }
  | { utfall: "ubekreftet"; grunn: string }
  /** Nektet av security rules. Ingenting er skrevet. */
  | { utfall: "avvist" }
  /** Listen kunne ikke leses fra serveren. Ingenting er skrevet i DETTE forsøket. */
  | { utfall: "ikkeLest" }
  /** Svaret på selve skrivingen uteble: den kan være lagret. Prøv igjen med samme `opId`. */
  | { utfall: "ukjent" };

/**
 * Beslutning for `skrivHandlelisteVersjonert`, tatt på serverens ferske
 * lesing. Bare `anvendt` skriver, og bare `endringer` (hele poster) og én
 * kvittering i `kvitteringsregister/{opId}`.
 */
export type InnleggingsBeslutning =
  | {
      utfall: "anvendt";
      endringer: Record<string, Record<string, unknown>>;
      kvittering: { opId: string; verdi: Record<string, unknown> };
    }
  | { utfall: "allerede" }
  | { utfall: "konflikt"; grunn: string; treff?: boolean }
  | { utfall: "ubekreftet"; grunn: string };

type Eksport = Record<string, unknown>;
const erEksportObjekt = (v: unknown): v is Eksport =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Eksportform (`.priority`, `.value`) → vanlig verdi, som `val()`. */
function fraEksport(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(fraEksport);
  const o = v as Eksport;
  if (".value" in o) return fraEksport(o[".value"]);
  const ut: Eksport = {};
  for (const k of Object.keys(o)) if (k !== ".priority") ut[k] = fraEksport(o[k]);
  return ut;
}

/** Har verdien prioritet noe sted under seg (ikke medregnet sin egen)? */
function harDypPrioritet(v: unknown): boolean {
  if (!erEksportObjekt(v)) return false;
  return Object.keys(v).some(
    (k) =>
      k !== ".priority" &&
      erEksportObjekt(v[k]) &&
      (".priority" in (v[k] as Eksport) || harDypPrioritet(v[k])),
  );
}

/** Legacy-array (numeriske nøkler) → objekt; hull hoppes over. */
function somObjekt(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return Object.fromEntries(
    v.flatMap((x, i) => (x === null || x === undefined ? [] : [[String(i), x]])),
  );
}

const SAMTIDIG =
  "Handlelisten endres samtidig på en annen enhet. Ingenting er lagret — prøv igjen.";
const UVENTET_FORM = "Handlelisten har en uventet form. Ingenting er lagret.";
const DYP_PRIORITET =
  "Raden har prioritetsmetadata som ikke kan bevares trygt. Ingenting er lagret.";
const MAKS_RUNDER = 5;
const RESERVERT = "Endringen ville berørt reserverte metadata i handlelisten. Ingenting er endret.";

class Avvist extends Error {}

async function handlelisteRest(
  familyId: FamilyId,
  metode: "GET" | "PUT",
  valg?: { etag: string; body: unknown },
): Promise<Response> {
  const bruker = getFirebaseAuth().currentUser;
  if (!bruker) throw new Avvist("ikke innlogget");
  const url = databaseRestUrl(shoppingPath(familyId));
  url.searchParams.set("auth", await bruker.getIdToken());
  if (metode === "GET") {
    url.searchParams.set("format", "export");
    return fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { "X-Firebase-ETag": "true" },
    });
  }
  return fetch(url, {
    method: "PUT",
    cache: "no-store",
    credentials: "omit",
    headers: { "if-match": valg!.etag, "Content-Type": "application/json" },
    body: JSON.stringify(valg!.body),
  });
}

/** Stabil serialisering (sorterte nøkler) — likhet uavhengig av nøkkelrekkefølge. */
function stabilJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stabilJson).join(",")}]`;
  if (erEksportObjekt(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stabilJson(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Har verdien prioritet noe sted — sin egen eller dypere inne? */
const harPrioritet = (v: unknown): boolean =>
  erEksportObjekt(v) && (v[".priority"] !== undefined || harDypPrioritet(v));

/**
 * Setter (eller sletter, `null`) én post i den nye eksportformen. Prioritet:
 * en endret post beholder sin egen; prioritet dypere inne i en endret post,
 * eller noe prioritet på en post som slettes (den skal kunne gjenopprettes
 * eksakt fra historikk), kan ikke bevares trygt — da returneres grunnen, og
 * ingenting skrives.
 */
function settPost(rot: Eksport, ny: Eksport, k: string, verdi: unknown): string | null {
  const gammel = rot[k];
  if (verdi === null || verdi === undefined) {
    if (harPrioritet(gammel)) return DYP_PRIORITET;
    delete ny[k];
    return null;
  }
  if (harDypPrioritet(gammel)) return DYP_PRIORITET;
  ny[k] =
    erEksportObjekt(gammel) && gammel[".priority"] !== undefined && erEksportObjekt(verdi)
      ? { ...verdi, ".priority": gammel[".priority"] }
      : verdi;
  return null;
}

/** Utfall av en versjonsbetinget skriving (innlegging, sammenslåing, angring). */
export type VersjonertUtfall = InnleggingsSkriveutfall;

type Runde = { skriv: Eksport } | { ferdig: VersjonertUtfall };

/**
 * Felles kjerne for VERSJONSBETINGEDE skrivinger av `families/{f}/shopping`
 * — samme kontrakt som legacy-handlelisten (#159, ADR 0003), via Firebase
 * REST:
 *
 * 1. Les noden i eksportform (med `.priority`) sammen med ETag.
 * 2. `lag` tar beslutningen på DEN lesingen og bygger enten ny eksportform
 *    (`skriv`) eller et ferdig utfall. Et ferdig utfall skriver ingenting —
 *    ingen commit, ingen prioritet som forsvinner.
 * 3. `skriv` sendes med `if-match`. Endret noe på serveren i mellomtiden
 *    (også bare en prioritet), svarer den 412, og hele runden tas på nytt
 *    mot fersk tilstand (inntil fem runder).
 *
 * Utfall: lesing som ikke lykkes er `ikkeLest` (ingenting skrevet);
 * 401/403 er `avvist`; et uteblitt eller feilet svar på selve skrivingen er
 * `ukjent`. Rules og IAM er uendret.
 */
async function kjorVersjonert(
  familyId: FamilyId,
  lag: (rot: Eksport, node: Eksport) => Runde,
): Promise<VersjonertUtfall> {
  for (let runde = 0; runde < MAKS_RUNDER; runde++) {
    let etag: string | null;
    let eksport: unknown;
    try {
      const res = await handlelisteRest(familyId, "GET");
      if (res.status === 401 || res.status === 403) return { utfall: "avvist" };
      if (!res.ok) return { utfall: "ikkeLest" };
      etag = res.headers.get("ETag");
      if (!etag) return { utfall: "ikkeLest" };
      eksport = await res.json();
    } catch (err) {
      if (err instanceof Avvist) return { utfall: "avvist" };
      console.error("[Handleliste] lesing feilet:", err);
      return { utfall: "ikkeLest" };
    }

    const rot = somObjekt(eksport ?? {});
    if (!erEksportObjekt(rot) || ".value" in rot) {
      return { utfall: "konflikt", grunn: UVENTET_FORM };
    }
    const r = lag(rot, fraEksport(rot) as Eksport);
    if ("ferdig" in r) return r.ferdig;

    let put: Response;
    try {
      put = await handlelisteRest(familyId, "PUT", { etag, body: r.skriv });
    } catch (err) {
      console.error("[Handleliste] svar på skriving uteble:", err);
      return { utfall: "ukjent" };
    }
    if (put.status === 412) continue;
    if (put.status === 401 || put.status === 403) return { utfall: "avvist" };
    return put.ok ? { utfall: "anvendt" } : { utfall: "ukjent" };
  }
  return { utfall: "konflikt", grunn: SAMTIDIG };
}

/**
 * Manuell innlegging (ny rad eller «Øk antallet», Mat #20, ordre
 * 6830803229) via `kjorVersjonert`. Bare `endringer` (hele poster) og én
 * kvittering i `kvitteringsregister/{opId}` skrives; alt annet går byte for
 * byte tilbake.
 */
export async function skrivHandlelisteVersjonert(
  familyId: FamilyId,
  kvitteringsregister: string,
  beslutt: (node: unknown) => InnleggingsBeslutning,
): Promise<InnleggingsSkriveutfall> {
  return kjorVersjonert(familyId, (rot, node) => {
    const b = beslutt(node);
    if (b.utfall !== "anvendt") return { ferdig: b };
    const ny: Eksport = { ...rot };
    for (const [k, verdi] of Object.entries(b.endringer)) {
      const feil = settPost(rot, ny, k, verdi);
      if (feil) return { ferdig: { utfall: "konflikt", grunn: feil } };
    }
    const register = rot[kvitteringsregister];
    if (register !== undefined && (!erEksportObjekt(register) || ".value" in register)) {
      return { ferdig: { utfall: "konflikt", grunn: UVENTET_FORM } };
    }
    ny[kvitteringsregister] = { ...(register ?? {}), [b.kvittering.opId]: b.kvittering.verdi };
    return { skriv: ny };
  });
}

/**
 * Sammenslåing og angring av handlelisteduplikater (Mat #20, ordre
 * 6837116507) via `kjorVersjonert`. `beslutt` (domenets
 * `anvendSammenslaing`/`angreSammenslaing`) får den ferske noden og gir en
 * ny node. Bare postene som faktisk avviker fra den ferske lesingen skrives
 * (satt eller slettet); urørte poster, reserverte metadata (`_skriver`,
 * `_ops`, `_reactForsok`) og prioriteter går byte for byte tilbake.
 * `allerede` og `konflikt` skriver ingenting. En berørt post med prioritet
 * som ikke trygt kan bevares eller gjenopprettes stopper før mutasjon.
 * Mål, kilder, `opId` og historikk avgjøres som før av domenet.
 */
export async function skrivHandlelisteNode(
  familyId: FamilyId,
  beslutt: (raw: unknown) => NodeBeslutning,
): Promise<VersjonertUtfall> {
  return kjorVersjonert(familyId, (rot, node) => {
    const b = beslutt(node);
    if (b.utfall === "allerede") return { ferdig: { utfall: "allerede" } };
    if (b.utfall === "ubekreftet") {
      return { ferdig: { utfall: "ubekreftet", grunn: b.grunn ?? "Ikke bekreftet." } };
    }
    if (b.utfall !== "anvendt") {
      return { ferdig: { utfall: "konflikt", grunn: b.grunn ?? "Ingenting er endret." } };
    }
    const nyVerdi = somObjekt(b.node);
    if (!erEksportObjekt(nyVerdi)) return { ferdig: { utfall: "konflikt", grunn: UVENTET_FORM } };
    const ny: Eksport = { ...rot };
    let endret = false;
    for (const k of new Set([...Object.keys(node), ...Object.keys(nyVerdi)])) {
      if (k === ".priority") continue;
      if (stabilJson(node[k]) === stabilJson(nyVerdi[k])) continue;
      // Reserverte metadata (`_skriver`, `_ops`, `_reactForsok` …) endres aldri
      // av sammenslåing/angring — heller ikke fra uventet lagret historikk.
      if (isReservedShoppingKey(k)) {
        return { ferdig: { utfall: "konflikt", grunn: RESERVERT } };
      }
      const feil = settPost(rot, ny, k, nyVerdi[k] ?? null);
      if (feil) return { ferdig: { utfall: "konflikt", grunn: feil } };
      endret = true;
    }
    return endret ? { skriv: ny } : { ferdig: { utfall: "allerede" } };
  });
}
