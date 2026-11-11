/**
 * Datalag for Spillerom (`families/{familyId}/liquidity`).
 *
 * Skrivemønster: målrettede skrivinger til de faktiske delene som
 * endret seg (`liquidity/saldo`, `/prognosisDate`, `/posts/{id}`) —
 * aldri hele `liquidity`-noden tilbake. `regenerateLiquidityPosts`
 * skriver hele `posts`-undernoden i ett kall — dette er bevisst, ikke
 * et unntak fra prinsippet: selve regenereringen (§domain/liquidity/
 * liquidity.ts sin `generateForecastPosts`) MÅ resonnere over ALLE
 * eksisterende poster samtidig for å beholde manuelle/overstyrte poster
 * korrekt, samme atomicitetsenhet som legacy sin `runGenerator`
 * (§index.html linje 10403–10416) allerede bruker.
 *
 * `subscribeForecastInputs` leser `budget`/`incomeGroups`/`sparingGroups`
 * READ-ONLY, direkte fra den lagrede Firebase-formen — IKKE en
 * migrering av Budsjett/Inntekter/Sparing (de forblir i `index.html`
 * inntil egen slice, §Issue #34). Legacy sin egen lesing av disse
 * stiene (§index.html linje ~15965–16050) bootstrapper mot en lokal
 * `BUDGET_TEMPLATE`-mal med en egen "aldri mist noe"-sammenslåingslogikk
 * for REDIGERINGSSKJERMENE (Budsjett/Inntekter/Sparing) — det er
 * bevisst IKKE portert her, siden denne funksjonen kun konsumerer
 * dataene read-only for prognosegenerering, samme rolle som Gangen
 * allerede har for transaksjoner/hendelser/receipts
 * (§data/gangen.repository.ts).
 *
 * Den EKTE Firebase-formen for `budget`/`incomeGroups`/`sparingGroups`
 * (verifisert direkte mot legacy sine `listen(...)`-lyttere, §index.html
 * linje 15965, 16123, 16168) er `{groupId: {itemId: {name, months, meta,
 * ...}}}` — posten ligger DIREKTE under gruppe-IDen, ingen `.items`-
 * undernøkkel, og gruppen har ALDRI et lagret `label`-felt (lesbare
 * navn finnes kun i legacy sin lokale `BUDGET_TEMPLATE`). `parseForecastGroups`
 * under speiler dette nøyaktig — se liquidity.repository.test.ts for
 * karakteriseringstesten som låser formen.
 */
import { onValue, ref, runTransaction, set, update } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { ForecastGroup, ForecastItem, Liquidity, LiquidityPost } from "@app-types/liquidity";

function liquidityPath(familyId: FamilyId): string {
  return `families/${familyId}/liquidity`;
}

function liquidityPostsPath(familyId: FamilyId): string {
  return `${liquidityPath(familyId)}/posts`;
}

function liquidityPostPath(familyId: FamilyId, id: string): string {
  return `${liquidityPostsPath(familyId)}/${id}`;
}

const EMPTY_LIQUIDITY: Liquidity = {
  saldo: 0,
  saldoUpdated: null,
  prognosisDate: "",
  lonnDay: 20,
  posts: {},
};

/** Abonnerer på hele `liquidity`-noden. Returnerer en avmeldingsfunksjon. */
export function subscribeLiquidity(
  familyId: FamilyId,
  onChange: (liquidity: Liquidity) => void,
): () => void {
  const liquidityRef = ref(getFirebaseDatabase(), liquidityPath(familyId));
  const unsubscribe = onValue(liquidityRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange(EMPTY_LIQUIDITY);
      return;
    }
    const value = snapshot.val() as Partial<Liquidity>;
    onChange({
      saldo: value.saldo ?? 0,
      saldoUpdated: value.saldoUpdated ?? null,
      prognosisDate: value.prognosisDate ?? "",
      lonnDay: value.lonnDay ?? 20,
      posts: value.posts ?? {},
    });
  });
  return unsubscribe;
}

/**
 * Parser rå Firebase-form ({groupId: {itemId: {name, months, meta}}}) til
 * ForecastGroup[] — se filens toppkommentar for den verifiserte, ekte
 * formen. `label` settes til `groupId` (ingen ekte etikett finnes for en
 * read-only konsument, §filens toppkommentar) — brukes kun av
 * `generateForecastPosts` sitt `sourceGroup`-visningsfelt, aldri av selve
 * prognoselogikken. `_gruppeplassholder` er legacy sitt interne signal om
 * en bevisst tom gruppe (§index.html linje 16007), aldri en ekte post —
 * filtrert bort her av samme grunn.
 */
export function parseForecastGroups(raw: unknown): ForecastGroup[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, Record<string, unknown>>).map(
    ([groupId, itemsRaw]) => {
      const items: ForecastItem[] = Object.entries(itemsRaw)
        .filter(([itemId]) => itemId !== "_gruppeplassholder")
        .map(([itemId, item]) => {
          const itemFields = item as Record<string, unknown>;
          const monthsRaw = (itemFields.months ?? {}) as Record<
            number,
            { budget?: number; spent?: number }
          >;
          const months = Array.from({ length: 12 }, (_, i) =>
            monthsRaw[i]
              ? { budget: monthsRaw[i].budget ?? 0, spent: monthsRaw[i].spent ?? 0 }
              : undefined,
          );
          return {
            id: itemId,
            name: (itemFields.name as string) ?? "",
            meta: itemFields.meta as ForecastItem["meta"],
            months,
          };
        });
      return { id: groupId, label: groupId, items };
    },
  );
}

/**
 * Abonnerer READ-ONLY på de tre gruppene `generateForecastPosts` trenger
 * — se filens toppkommentar for hvorfor dette ikke er en Budsjett-
 * migrering. Ett samlet abonnement (tre underliggende `onValue`-kall)
 * for enkel bruk fra `useLiquidity`.
 */
export function subscribeForecastInputs(
  familyId: FamilyId,
  onChange: (inputs: {
    budgetGroups: ForecastGroup[];
    incomeGroups: ForecastGroup[];
    sparingGroups: ForecastGroup[];
  }) => void,
  /**
   * Valgfri lastestatus (funn F): `onReady` kalles hver gang alle tre
   * kildene har levert minst ett snapshot (først da er et tomt resultat
   * et ekte svar), `onError` når en av lytterne avvises.
   */
  status: { onReady?: () => void; onError?: (error: Error) => void } = {},
): () => void {
  const db = getFirebaseDatabase();
  let budgetGroups: ForecastGroup[] = [];
  let incomeGroups: ForecastGroup[] = [];
  let sparingGroups: ForecastGroup[] = [];
  const mottatt = { budget: false, income: false, sparing: false };
  const emit = () => {
    onChange({ budgetGroups, incomeGroups, sparingGroups });
    if (mottatt.budget && mottatt.income && mottatt.sparing) status.onReady?.();
  };
  const feil = (error: Error) => status.onError?.(error);

  const unsubBudget = onValue(
    ref(db, `families/${familyId}/budget`),
    (snapshot) => {
      budgetGroups = parseForecastGroups(snapshot.exists() ? snapshot.val() : null);
      mottatt.budget = true;
      emit();
    },
    feil,
  );
  const unsubIncome = onValue(
    ref(db, `families/${familyId}/incomeGroups`),
    (snapshot) => {
      incomeGroups = parseForecastGroups(snapshot.exists() ? snapshot.val() : null);
      mottatt.income = true;
      emit();
    },
    feil,
  );
  const unsubSparing = onValue(
    ref(db, `families/${familyId}/sparingGroups`),
    (snapshot) => {
      sparingGroups = parseForecastGroups(snapshot.exists() ? snapshot.val() : null);
      mottatt.sparing = true;
      emit();
    },
    feil,
  );

  return () => {
    unsubBudget();
    unsubIncome();
    unsubSparing();
  };
}

/** Lagrer saldo + tidsstempel. Speiler `SpilleromScreen.saveSaldo` (§index.html linje 10482–10486). */
export async function saveLiquiditySaldo(familyId: FamilyId, saldo: number): Promise<void> {
  await update(ref(getFirebaseDatabase(), liquidityPath(familyId)), {
    saldo,
    saldoUpdated: Date.now(),
  });
}

/** Lagrer prognosedato. Speiler `saveDate` (§index.html linje 10488–10491). */
export async function saveLiquidityPrognosisDate(
  familyId: FamilyId,
  prognosisDate: string,
): Promise<void> {
  await update(ref(getFirebaseDatabase(), liquidityPath(familyId)), { prognosisDate });
}

/** Oppretter en manuell prognosepost. Speiler `addPost` (§index.html linje 10493–10501). */
export async function addLiquidityPost(
  familyId: FamilyId,
  fields: Omit<LiquidityPost, "id" | "kilde">,
): Promise<string> {
  const id = crypto.randomUUID();
  const post: LiquidityPost = { ...fields, id, kilde: "manuell" };
  await set(ref(getFirebaseDatabase(), liquidityPostPath(familyId, id)), post);
  return id;
}

/** Fjerner én prognosepost. Speiler `removePost` (§index.html linje 10503–10509). */
export async function removeLiquidityPost(familyId: FamilyId, id: string): Promise<void> {
  await set(ref(getFirebaseDatabase(), liquidityPostPath(familyId, id)), null);
}

/**
 * Markerer/avmarkerer en post som oppfylt. Speiler `markerOppfylt`/
 * `angreOppfylt` (§index.html linje 10518–10537) — transaksjon fordi
 * `oppfyltAt` avhenger av at posten faktisk finnes NÅ, samme
 * begrunnelse som `toggleShoppingItemDone`.
 */
export async function setLiquidityPostFulfilled(
  familyId: FamilyId,
  id: string,
  fulfilled: boolean,
): Promise<void> {
  await runTransaction(ref(getFirebaseDatabase(), liquidityPostPath(familyId, id)), (current) => {
    if (!current) return null;
    const post = current as LiquidityPost;
    if (fulfilled) {
      return { ...post, status: "oppfylt", oppfyltAt: Date.now() };
    }
    const rest = { ...post };
    delete rest.oppfyltAt;
    return { ...rest, status: "aktiv" };
  });
}

/** Lagring ble ikke gjort fordi grunnlaget er endret eller borte (#59, samtidighet). */
export class LikviditetKonflikt extends Error {
  readonly grunn: "mangler" | "konflikt";
  constructor(message: string, grunn: "mangler" | "konflikt") {
    super(message);
    this.name = "LikviditetKonflikt";
    this.grunn = grunn;
  }
}

const likVerdi = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Redigerer felter på en eksisterende post. Speiler `saveEditPost`
 * (§index.html linje 10545–10556) — markerer en generert post som
 * `manueltOverstyrt` ved enhver redigering, slik at neste regenerering
 * (§`regenerateLiquidityPosts`) beholder den fremfor å overskrive den.
 *
 * Samtidighet (#59, ordre 6675906923): kjøres som transaksjon på posten.
 * Med `grunnlag` (verdiene brukeren så da redigeringen startet) skrives
 * bare når hvert felt i `patch` fortsatt har grunnlagsverdien på serveren;
 * ellers kastes `LikviditetKonflikt` og ingenting skrives. En slettet post
 * gjenoppstår aldri (`grunn: "mangler"`). Updateren avbryter aldri lokalt —
 * ved konflikt eller manglende post committes uendret verdi, slik at
 * serveren alltid avgjør mot fersk tilstand (en kald eller foreldet lokal
 * cache kan ikke gi falsk konflikt).
 */
export async function updateLiquidityPost(
  familyId: FamilyId,
  id: string,
  patch: Partial<LiquidityPost>,
  grunnlag?: Partial<LiquidityPost>,
): Promise<void> {
  // Satt av siste kjøring av updateren (den som ble committet).
  const sist: { utfall: "ok" | "mangler" | "konflikt" } = { utfall: "ok" };
  await runTransaction(ref(getFirebaseDatabase(), liquidityPostPath(familyId, id)), (current) => {
    if (!current) {
      sist.utfall = "mangler";
      return null;
    }
    const post = current as LiquidityPost;
    if (
      grunnlag &&
      (Object.keys(patch) as (keyof LiquidityPost)[]).some((k) => !likVerdi(post[k], grunnlag[k]))
    ) {
      sist.utfall = "konflikt";
      return current;
    }
    sist.utfall = "ok";
    // `manueltOverstyrt` legges bare på genererte poster. Før #59-vernet ble
    // feltet satt til `undefined` på manuelle poster, og RTDB avviste da hele
    // transaksjonen (redigering av manuelle poster feilet stille).
    return {
      ...post,
      ...patch,
      ...(post.kilde === "generator" ? { manueltOverstyrt: true } : {}),
    };
  });
  if (sist.utfall === "mangler") {
    throw new LikviditetKonflikt("Posten finnes ikke lenger. Ingenting er lagret.", "mangler");
  }
  if (sist.utfall === "konflikt") {
    throw new LikviditetKonflikt(
      "Posten er endret på en annen enhet siden du åpnet den. Ingenting er lagret — lukk og åpne posten på nytt.",
      "konflikt",
    );
  }
}

/**
 * Regenererer `posts`-undernoden (#59, samtidighet, ordre 6675906923).
 *
 * `beregn` får **gjeldende** `posts` fra serveren og kjøres i en RTDB-
 * transaksjon: endrer en annen klient `posts` (ny manuell post, endring,
 * oppfylt, sletting) mellom lesing og skriving, kjøres `beregn` på nytt
 * med fersk tilstand i stedet for at et gammelt, fullstendig resultat
 * skrives blindt. Søsken utenfor `posts` (saldo, prognosedato) røres ikke.
 * Hele `posts` er fortsatt atomicitetsenheten (se filens toppkommentar).
 * Kaster hvis transaksjonen ikke ble committet.
 */
export async function regenerateLiquidityPosts(
  familyId: FamilyId,
  beregn: (gjeldende: Record<string, LiquidityPost>) => Record<string, LiquidityPost>,
): Promise<void> {
  const resultat = await runTransaction(
    ref(getFirebaseDatabase(), liquidityPostsPath(familyId)),
    (current) => beregn((current ?? {}) as Record<string, LiquidityPost>),
  );
  if (!resultat.committed) throw new Error("Prognosen ble ikke lagret.");
}
