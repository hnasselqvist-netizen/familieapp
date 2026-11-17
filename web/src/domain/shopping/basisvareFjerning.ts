/**
 * «Fjern» på en basisvare i Matlager (Mat #20, ordre 6948538722). Ren modul.
 *
 * En basisvaremarkering er `staples/{nøkkel}: true`. Bare en slik gyldig
 * markering kan fjernes, og bare når verdien på EKSAKT lagret nøkkel
 * fortsatt er `true` i samme versjonsbetingede runde som slettingen
 * (`fjernBasisvareVersjonert`, ETag/if-match):
 * - `true` (uten prioritet eller andre felt) → fjernes;
 * - manglende nøkkel → allerede borte, skrivefritt;
 * - alt annet (objekt med råfelt, annen verdi, prioritet) → står urørt.
 */
import { basisvareMaal } from "./basisvare";

export type BasisvareFjerningBeslutning = "fjern" | "borte" | "erstattet";

/** Beslutningen mot den ferske verdien på nøkkelen (REST eksportform). */
export function vurderBasisvareFjerning(eksport: unknown): BasisvareFjerningBeslutning {
  if (eksport === null || eksport === undefined) return "borte";
  return eksport === true ? "fjern" : "erstattet";
}

/** Vises som fjernbar i Matlager: én gyldig nøkkel med verdien `true`. */
export function erFjernbarBasisvare(nokkel: string, verdi: unknown): boolean {
  return verdi === true && basisvareMaal(nokkel).ok;
}
