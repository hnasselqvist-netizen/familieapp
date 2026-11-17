/**
 * Datalag for basisvarer (`families/{familyId}/staples`).
 *
 * Uendret datastruktur: `{varenavn (lowercase): true}` — ikke en
 * id-keyet samling. Opprinnelig eneste skriving var
 * `ShoppingGenerator.confirmStaple` (index.html linje ~2830–2836 —
 * "merk som basisvare"-spørsmålet som dukker opp når brukeren fjerner en
 * vare i gjennomgangen): et ubetinget `set(true)` på varens egen nøkkel,
 * allerede målrettet og uten samtidighetsrisiko (ingen les-før-skriv).
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
import { onValue, ref, set } from "firebase/database";
import { databaseRestUrl, getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { Staples } from "@app-types/shopping";

function staplesPath(familyId: FamilyId): string {
  return `families/${familyId}/staples`;
}

/** Abonnerer på basisvarer. Returnerer en avmeldingsfunksjon. */
export function subscribeStaples(
  familyId: FamilyId,
  onChange: (staples: Staples) => void,
): () => void {
  const staplesRef = ref(getFirebaseDatabase(), staplesPath(familyId));
  const unsubscribe = onValue(staplesRef, (snapshot) => {
    onChange(snapshot.exists() ? (snapshot.val() as Staples) : {});
  });
  return unsubscribe;
}

/** Markerer en vare som basisvare. Speiler `confirmStaple` (index.html linje ~2830–2836) 1:1 — navnet lowercases før skriving, akkurat som i dag. */
export async function markItemAsStaple(familyId: FamilyId, name: string): Promise<void> {
  await set(ref(getFirebaseDatabase(), `${staplesPath(familyId)}/${name.toLowerCase()}`), true);
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
    body: "null",
  });
}

/**
 * Fjerner én basisvaremarkering VERSJONSBETINGET via Firebase REST: les
 * verdien på eksakt nøkkel (eksportform, med prioritet) med ETag, la
 * `vurder` avgjøre, og slett (`PUT null`) med `if-match`. Endret verdien seg
 * i mellomtiden, svarer serveren 412, og runden tas på nytt mot fersk verdi.
 * Bare den ene nøkkelen berøres; øvrige nøkler, råfelt og uventet innhold
 * står. Nøkkelen må være validert av kalleren (én gyldig RTDB-nøkkel).
 */
export async function fjernBasisvareVersjonert(
  familyId: FamilyId,
  nokkel: string,
  vurder: BasisvareFjerningVurdering,
): Promise<BasisvareFjerningUtfall> {
  if (!nokkel || nokkel.includes("/")) return { utfall: "erstattet" };
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
    const beslutning = vurder(verdi);
    if (beslutning === "borte") return { utfall: "borte" };
    if (beslutning === "erstattet") return { utfall: "erstattet" };

    let put: Response;
    try {
      put = await basisvareRest(familyId, nokkel, "PUT", etag);
    } catch (err) {
      console.error("[Basisvarer] svar på fjerning uteble:", err);
      return { utfall: "ukjent" };
    }
    if (put.status === 412) continue;
    if (put.status === 401 || put.status === 403) return { utfall: "avvist" };
    return put.ok ? { utfall: "fjernet" } : { utfall: "ukjent" };
  }
  return { utfall: "samtidig" };
}
