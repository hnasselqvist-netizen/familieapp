/**
 * «Merk som basisvare» i React (Mat #20, ordre 6953147250). Ren modul.
 *
 * Beslutningen tas mot den ferske verdien på den normaliserte nøkkelen, i
 * samme versjonsbetingede runde som skrivingen (`merkBasisvareVersjonert`,
 * ETag/if-match):
 * - manglende nøkkel → `true` opprettes;
 * - `true`, også med prioritet → allerede merket, skrivefritt;
 * - alt annet (objekt med råfelt, `false`, tekst …) → konflikt, står urørt.
 */
export type BasisvareMerkingBeslutning = "opprett" | "allerede" | "konflikt";

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Beslutningen mot den ferske verdien på nøkkelen (REST eksportform). */
export function vurderBasisvareMerking(eksport: unknown): BasisvareMerkingBeslutning {
  if (eksport === null || eksport === undefined) return "opprett";
  if (eksport === true) return "allerede";
  // `true` med prioritet: `{ ".value": true, ".priority": … }` og ingenting annet.
  if (
    erObjekt(eksport) &&
    eksport[".value"] === true &&
    Object.keys(eksport).every((k) => k === ".value" || k === ".priority")
  ) {
    return "allerede";
  }
  return "konflikt";
}
