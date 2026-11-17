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
 * - `samtidig`: verdien ble endret i alle rundene — ingenting skrevet.
 */
export type BasisvareFjerningUtfall = {
  utfall: "fjernet" | "borte" | "erstattet" | "avvist" | "ikkeLest" | "ukjent" | "samtidig";
};

const MAKS_RUNDER = 5;
class IkkeInnlogget extends Error {}

async function basisvareRest(
  familyId: FamilyId,
  nokkel: string,
  metode: "GET" | "PUT",
  etag?: string,
  body: true | null = null,
): Promise<Response> {
  const bruker = getFirebaseAuth().currentUser;
  if (!bruker) throw new IkkeInnlogget();
  // Eksakt lagret nøkkel som ETT stisegment (databaseRestUrl koder det).
  const url = databaseRestUrl(`${staplesPath(familyId)}/${nokkel}`);
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
    headers: { "if-match": etag!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Runde<U> = { skriv: true | null } | { ferdig: U };
type Kjerneutfall = { utfall: "skrevet" | "avvist" | "ikkeLest" | "ukjent" | "samtidig" };

/**
 * Felles kjerne for VERSJONSBETINGEDE skrivinger av ÉN basisvarenøkkel via
 * Firebase REST (fjerning #171, merking ordre 6953147250): les verdien på
 * eksakt nøkkel (eksportform, med prioritet) med ETag, la `beslutt` avgjøre,
 * og skriv (`true` eller `null`) med `if-match`. Endret verdien seg i
 * mellomtiden (også bare prioriteten, eller en annen klient opprettet den),
 * svarer serveren 412, og runden tas på nytt mot fersk verdi. Bare den ene
 * nøkkelen berøres. Nøkkelen må være validert av kalleren.
 */
async function kjorBasisvareVersjonert<U>(
  familyId: FamilyId,
  nokkel: string,
  beslutt: (eksport: unknown) => Runde<U>,
): Promise<U | Kjerneutfall> {
  for (let runde = 0; runde < MAKS_RUNDER; runde++) {
    let etag: string | null;
    let verdi: unknown;
    try {
      const res = await basisvareRest(familyId, nokkel, "GET");
      if (res.status === 401 || res.status === 403) return { utfall: "avvist" };
      if (!res.ok) return { utfall: "ikkeLest" };
      etag = res.headers.get("ETag");
      if (!etag) return { utfall: "ikkeLest" };
      verdi = await res.json();
    } catch (err) {
      if (err instanceof IkkeInnlogget) return { utfall: "avvist" };
      console.error("[Basisvarer] lesing feilet:", err);
      return { utfall: "ikkeLest" };
    }
    const r = beslutt(verdi);
    if ("ferdig" in r) return r.ferdig;

    let put: Response;
    try {
      put = await basisvareRest(familyId, nokkel, "PUT", etag, r.skriv);
    } catch (err) {
      console.error("[Basisvarer] svar på skriving uteble:", err);
      return { utfall: "ukjent" };
    }
    if (put.status === 412) continue;
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
): Promise<BasisvareFjerningUtfall> {
  if (!nokkel || nokkel.includes("/")) return { utfall: "erstattet" };
  const u = await kjorBasisvareVersjonert<BasisvareFjerningUtfall>(familyId, nokkel, (v) => {
    const b = vurder(v);
    if (b === "borte") return { ferdig: { utfall: "borte" } };
    if (b === "erstattet") return { ferdig: { utfall: "erstattet" } };
    return { skriv: null };
  });
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
  utfall: "merket" | "allerede" | "konflikt" | "avvist" | "ikkeLest" | "ukjent" | "samtidig";
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
): Promise<BasisvareMerkingUtfall> {
  if (!nokkel || nokkel.includes("/")) return { utfall: "konflikt" };
  const u = await kjorBasisvareVersjonert<BasisvareMerkingUtfall>(familyId, nokkel, (v) => {
    const b = vurder(v);
    if (b === "allerede") return { ferdig: { utfall: "allerede" } };
    if (b === "konflikt") return { ferdig: { utfall: "konflikt" } };
    return { skriv: true };
  });
  return u.utfall === "skrevet" ? { utfall: "merket" } : (u as BasisvareMerkingUtfall);
}
