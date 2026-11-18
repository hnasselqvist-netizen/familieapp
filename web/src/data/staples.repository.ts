/**
 * Datalag for basisvarer (`families/{familyId}/staples`).
 *
 * Uendret datastruktur: `{varenavn (lowercase): true}` — ikke en
 * id-keyet samling. Opprinnelig eneste skriving var
 * `ShoppingGenerator.confirmStaple` (index.html linje ~2830–2836 —
 * "merk som basisvare"-spørsmålet som dukker opp når brukeren fjerner en
 * vare i gjennomgangen): et ubetinget `set(true)` på varens egen nøkkel.
 * I React er merkingen nå VERSJONSBETINGET (`merkBasisvareVersjonert`, Mat
 * #20, ordre 6953147250): `true` opprettes bare ved faktisk fravær, så en
 * eksisterende råverdi eller prioritet aldri overskrives.
 *
 * **Kjøkken v1 — fjerning** (§Kontrolltårn-handoff, Issue #20,
 * "Matlager... kan bære både frysevarer og basisvarer/beholdning"):
 * basisvarer hadde tidligere INGEN "fjern"-motstykke noe sted i koden
 * (verken her eller i produksjons-`index.html`) — en vare markert som
 * basisvare kunne aldri umerkes igjen uten direkte databaseredigering.
 * Fjerningen var et ubetinget `remove()`; den er nå VERSJONSBETINGET
 * (`fjernBasisvareVersjonert`, Mat #20, ordre 6948538722), så en
 * forsinket fjerning aldri sletter en verdi en annen enhet har byttet ut.
 */
import { onValue, ref } from "firebase/database";
import { databaseRestUrl, getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { Staples } from "@app-types/shopping";

function staplesPath(familyId: FamilyId): string {
  return `families/${familyId}/staples`;
}

/**
 * Abonnerer på basisvarer. Returnerer en avmeldingsfunksjon.
 *
 * `staples` er `val()` som før. `eksport` er samme snapshot i eksportform
 * (med `.priority`, review 5939383134), så det som vises som fjernbart kan
 * avgjøres med samme beslutning som fjerningen tar mot REST-eksporten.
 */
export function subscribeStaples(
  familyId: FamilyId,
  onChange: (staples: Staples, eksport: Readonly<Record<string, unknown>>) => void,
): () => void {
  const staplesRef = ref(getFirebaseDatabase(), staplesPath(familyId));
  const unsubscribe = onValue(staplesRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange({}, {});
      return;
    }
    const eksport: unknown = snapshot.exportVal();
    onChange(
      snapshot.val() as Staples,
      typeof eksport === "object" && eksport !== null && !Array.isArray(eksport)
        ? (eksport as Record<string, unknown>)
        : {},
    );
  });
  return unsubscribe;
}

/** Domenets beslutning mot den ferske verdien (se `domain/shopping/basisvareFjerning`). */
export type BasisvareFjerningVurdering = (eksport: unknown) => "fjern" | "borte" | "erstattet";

/**
 * Utfall av en versjonsbetinget fjerning:
 * - `fjernet`: verdien var `true` og er slettet (bekreftet av serveren);
 * - `borte`: nøkkelen fantes ikke — ingenting skrevet;
 * - `erstattet`: verdien er ikke lenger `true` — står urørt;
 * - `avvist`: 401/403 eller ikke innlogget — ingenting endret;
 * - `ikkeLest`: lesingen lyktes ikke — ingenting skrevet;
 * - `ukjent`: svaret på selve slettingen uteble eller feilet;
 * - `samtidig`: verdien ble endret i alle rundene — ingenting skrevet;
 * - `byttet`: innloggingen ble byttet eller avsluttet før skrivingen ble
 *   sendt — ingenting skrevet (ordre 6984494940).
 */
export type BasisvareFjerningUtfall = {
  utfall:
    "fjernet" | "borte" | "erstattet" | "avvist" | "ikkeLest" | "ukjent" | "samtidig" | "byttet";
};

const MAKS_RUNDER = 5;
/**
 * Avgrenset ventetid for hele forsøket (Mat #20, ordre 6962110764; samme frist
 * som legacy i #173): et svar som aldri kommer, låser ikke UI-et.
 */
export const BASISVARE_FRIST_MS = 15_000;
class Stoppet extends Error {}
/** Innloggingen er byttet eller avsluttet siden forsøket startet (ordre 6984494940). */
class SesjonByttet extends Error {}

type Innlogget = NonNullable<ReturnType<typeof getFirebaseAuth>["currentUser"]>;

/** Delt mellom runder i ett forsøk: innloggingen som startet det, fristen og om en skriving er sendt. */
interface Vakt {
  bruker: Innlogget;
  stoppet: boolean;
  putSendt: boolean;
  signal: AbortSignal;
}

/** Er sesjonen fortsatt den som startet forsøket (samme `User`-objekt)? */
function sammeSesjon(vakt: Vakt): boolean {
  return getFirebaseAuth().currentUser === vakt.bruker;
}

async function basisvareRest(
  familyId: FamilyId,
  nokkel: string,
  metode: "GET" | "PUT",
  vakt: Vakt,
  etag?: string,
  body: true | null = null,
): Promise<Response> {
  // Eksakt lagret nøkkel som ETT stisegment (databaseRestUrl koder det).
  const url = databaseRestUrl(`${staplesPath(familyId)}/${nokkel}`);
  // Alltid tokenet til innloggingen som startet forsøket — aldri en ny `currentUser`.
  const token = await vakt.bruker.getIdToken();
  // Et sent token etter fristen fører aldri til en forespørsel.
  if (vakt.stoppet) throw new Stoppet();
  // Rett etter den asynkrone tokenhentingen og før `fetch`: samme sesjon.
  if (!sammeSesjon(vakt)) throw new SesjonByttet();
  url.searchParams.set("auth", token);
  if (metode === "GET") {
    url.searchParams.set("format", "export");
    return fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { "X-Firebase-ETag": "true" },
      signal: vakt.signal,
    });
  }
  vakt.putSendt = true;
  return fetch(url, {
    method: "PUT",
    cache: "no-store",
    credentials: "omit",
    headers: { "if-match": etag!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: vakt.signal,
  });
}

type Runde<U> = { skriv: true | null } | { ferdig: U };
type Kjerneutfall = {
  utfall: "skrevet" | "avvist" | "ikkeLest" | "ukjent" | "samtidig" | "byttet";
};

/**
 * Felles kjerne for VERSJONSBETINGEDE skrivinger av ÉN basisvarenøkkel via
 * Firebase REST (fjerning #171, merking ordre 6953147250): les verdien på
 * eksakt nøkkel (eksportform, med prioritet) med ETag, la `beslutt` avgjøre,
 * og skriv (`true` eller `null`) med `if-match`. Endret verdien seg i
 * mellomtiden (også bare prioriteten, eller en annen klient opprettet den),
 * svarer serveren 412, og runden tas på nytt mot fersk verdi. Bare den ene
 * nøkkelen berøres. Nøkkelen må være validert av kalleren.
 *
 * Forsøket er bundet til innloggingen som startet det (ordre 6984494940,
 * som #178–#180): alle runder bruker samme bruker, og sesjonen kontrolleres
 * etter hver lesing og rett etter hver tokenhenting før `fetch` — også i
 * runden etter 412. Er den byttet eller avsluttet før PUT er sendt, skrives
 * ingenting (`byttet`).
 *
 * Hele forsøket har en frist (`fristMs`, ordre 6962110764). Ved utløp
 * avbrytes ventende forespørsler, og en stoppvakt hindrer at et sent token
 * eller en sen lesing starter en skriving. Utfallet er da `ikkeLest` hvis
 * ingen skriving var sendt (sikkert ingenting nytt skrevet), ellers `ukjent`
 * (en sendt skriving kan ha blitt lagret). Ingen automatisk ny skriving: et
 * nytt forsøk leser alltid fersk verdi og ETag.
 */
async function kjorBasisvareVersjonert<U>(
  familyId: FamilyId,
  nokkel: string,
  beslutt: (eksport: unknown) => Runde<U>,
  fristMs: number = BASISVARE_FRIST_MS,
): Promise<U | Kjerneutfall> {
  const bruker = getFirebaseAuth().currentUser;
  if (!bruker) return { utfall: "avvist" };
  const styring = new AbortController();
  const vakt: Vakt = { bruker, stoppet: false, putSendt: false, signal: styring.signal };
  let tidtaker: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<Kjerneutfall>((resolve) => {
    tidtaker = setTimeout(() => {
      vakt.stoppet = true;
      resolve({ utfall: vakt.putSendt ? "ukjent" : "ikkeLest" });
      styring.abort();
    }, fristMs);
  });
  try {
    return await Promise.race([kjorRunder(familyId, nokkel, beslutt, vakt), frist]);
  } finally {
    clearTimeout(tidtaker);
  }
}

async function kjorRunder<U>(
  familyId: FamilyId,
  nokkel: string,
  beslutt: (eksport: unknown) => Runde<U>,
  vakt: Vakt,
): Promise<U | Kjerneutfall> {
  for (let runde = 0; runde < MAKS_RUNDER; runde++) {
    let etag: string | null;
    let verdi: unknown;
    if (vakt.stoppet) return { utfall: "ikkeLest" };
    try {
      const res = await basisvareRest(familyId, nokkel, "GET", vakt);
      if (res.status === 401 || res.status === 403) return { utfall: "avvist" };
      if (!res.ok) return { utfall: "ikkeLest" };
      etag = res.headers.get("ETag");
      if (!etag) return { utfall: "ikkeLest" };
      verdi = await res.json();
    } catch (err) {
      if (err instanceof SesjonByttet) return { utfall: "byttet" };
      if (!vakt.stoppet) console.error("[Basisvarer] lesing feilet:", err);
      return { utfall: "ikkeLest" };
    }
    // Fristen eller sesjonen kan ha endret seg mens lesingen pågikk.
    if (vakt.stoppet) return { utfall: "ikkeLest" };
    if (!sammeSesjon(vakt)) return { utfall: "byttet" };
    const r = beslutt(verdi);
    if ("ferdig" in r) return r.ferdig;
    // Fristen kan ha gått ut mens lesingen pågikk: da sendes ingen skriving.
    if (vakt.stoppet) return { utfall: "ikkeLest" };

    let put: Response;
    try {
      put = await basisvareRest(familyId, nokkel, "PUT", vakt, etag, r.skriv);
    } catch (err) {
      if (err instanceof Stoppet) return { utfall: "ikkeLest" };
      if (err instanceof SesjonByttet) return { utfall: "byttet" };
      if (!vakt.stoppet) console.error("[Basisvarer] svar på skriving uteble:", err);
      return { utfall: vakt.putSendt ? "ukjent" : "ikkeLest" };
    }
    if (put.status === 412) {
      // Avvist på ETag: sikkert ikke lagret; ny runde mot fersk verdi.
      vakt.putSendt = false;
      continue;
    }
    if (put.status === 401 || put.status === 403) return { utfall: "avvist" };
    return put.ok ? { utfall: "skrevet" } : { utfall: "ukjent" };
  }
  return { utfall: "samtidig" };
}

/**
 * Fjerner én basisvaremarkering VERSJONSBETINGET: slettes (`PUT null`) bare
 * når `vurder` sier `fjern` mot fersk verdi. Øvrige nøkler, råfelt og
 * uventet innhold står.
 */
export async function fjernBasisvareVersjonert(
  familyId: FamilyId,
  nokkel: string,
  vurder: BasisvareFjerningVurdering,
  valg: { fristMs?: number } = {},
): Promise<BasisvareFjerningUtfall> {
  if (!nokkel || nokkel.includes("/")) return { utfall: "erstattet" };
  const u = await kjorBasisvareVersjonert<BasisvareFjerningUtfall>(
    familyId,
    nokkel,
    (v) => {
      const b = vurder(v);
      if (b === "borte") return { ferdig: { utfall: "borte" } };
      if (b === "erstattet") return { ferdig: { utfall: "erstattet" } };
      return { skriv: null };
    },
    valg.fristMs,
  );
  return u.utfall === "skrevet" ? { utfall: "fjernet" } : (u as BasisvareFjerningUtfall);
}

/** Domenets beslutning mot den ferske verdien (se `domain/shopping/basisvareMerking`). */
export type BasisvareMerkingVurdering = (eksport: unknown) => "opprett" | "allerede" | "konflikt";

/**
 * Utfall av en versjonsbetinget merking:
 * - `merket`: nøkkelen fantes ikke og er opprettet som `true` (bekreftet);
 * - `allerede`: verdien er allerede `true` (også med prioritet) — skrivefritt;
 * - `konflikt`: nøkkelen har en annen verdi — står urørt;
 * - `avvist`, `ikkeLest`, `ukjent`, `samtidig`: som ved fjerning.
 */
export type BasisvareMerkingUtfall = {
  utfall:
    "merket" | "allerede" | "konflikt" | "avvist" | "ikkeLest" | "ukjent" | "samtidig" | "byttet";
};

/**
 * Merker én basisvare VERSJONSBETINGET (Mat #20, ordre 6953147250): `true`
 * opprettes (`PUT true` med `if-match`) bare ved faktisk fravær. Oppretter en
 * annen klient verdien mellom lesing og skriving, avviser serveren
 * skrivingen, og den nye runden ser verdien — den står. Nøkkelen er den
 * normaliserte basisvarenøkkelen, validert av kalleren.
 */
export async function merkBasisvareVersjonert(
  familyId: FamilyId,
  nokkel: string,
  vurder: BasisvareMerkingVurdering,
  valg: { fristMs?: number } = {},
): Promise<BasisvareMerkingUtfall> {
  if (!nokkel || nokkel.includes("/")) return { utfall: "konflikt" };
  const u = await kjorBasisvareVersjonert<BasisvareMerkingUtfall>(
    familyId,
    nokkel,
    (v) => {
      const b = vurder(v);
      if (b === "allerede") return { ferdig: { utfall: "allerede" } };
      if (b === "konflikt") return { ferdig: { utfall: "konflikt" } };
      return { skriv: true };
    },
    valg.fristMs,
  );
  return u.utfall === "skrevet" ? { utfall: "merket" } : (u as BasisvareMerkingUtfall);
}
