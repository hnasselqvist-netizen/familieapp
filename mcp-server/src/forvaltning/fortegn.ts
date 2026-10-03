/**
 * Skrivefri klassifisering av de to kjente feil-signerte «Drivstoff og
 * lading»-hendelsene (Issue #34, cutover-plan §4). Portert fra legacy
 * `kjorFortegnsRecoveryDrivstoffRabatt` (`index.html` ~1863–1918), men
 * returnerer KUN klassifiseringen — aldri nye hendelser. Funksjonen er
 * differensielt testet mot legacy-koden, trukket ordrett ut
 * (`fortegn.legacy.test.ts`).
 *
 * Utfallene tilsvarer det legacy sin «Forhåndsvis» viser:
 *
 * | Her               | Legacy-forhåndsvisning | Betyr                                      |
 * |-------------------|------------------------|--------------------------------------------|
 * | `allerede_korrekt`| ✓ Allerede korrekt     | Ingen retting trengs                       |
 * | `trenger_retting` | ✓ Korrigert a → b      | Recovery ville endret beløpet              |
 * | `hoppet_over`     | ⚠ Hoppet over          | Dataene har endret seg — undersøk, ikke rett |
 * | `finnes_ikke`     | (ingen rad)            | Ingen hendelse med denne id-en             |
 */

export const FORTEGN_RECOVERY_MAAL = [
  { id: "msoknxe09eop", transaksjonId: "msoknxe01b83", forventetBelop: 9.27 },
  { id: "msoknxe0960s", transaksjonId: "msoknxe0v3nj", forventetBelop: 1 },
] as const;
export const FORTEGN_RECOVERY_REGEL_ID = "msok68ov1ag1";
export const FORTEGN_RECOVERY_PLASSERING_ID = "drivstoff_helen";

export type FortegnResultat =
  "allerede_korrekt" | "trenger_retting" | "hoppet_over" | "finnes_ikke";

export interface FortegnStatus {
  id: string;
  resultat: FortegnResultat;
  /** Legacy sin begrunnelse ved `hoppet_over`, ordrett. */
  grunn?: string;
  /** Beløpet i dag (`allerede_korrekt`, `trenger_retting`). */
  belop?: number;
  /** Beløpet recovery ville skrevet (`trenger_retting`). */
  rettetBelop?: number;
}

type Rad = Record<string, unknown>;
const erObjekt = (v: unknown): v is Rad => typeof v === "object" && v !== null && !Array.isArray(v);

/** Én rad per treff på en mål-id (som legacy), pluss `finnes_ikke` for mål uten treff. */
export function klassifiserFortegn(hendelser: readonly unknown[]): FortegnStatus[] {
  const rader: FortegnStatus[] = [];
  for (const h of hendelser) {
    if (!erObjekt(h)) continue;
    const maal = FORTEGN_RECOVERY_MAAL.find((m) => m.id === h.id);
    if (!maal) continue;
    rader.push(vurder(h, maal));
  }
  for (const maal of FORTEGN_RECOVERY_MAAL) {
    if (!rader.some((r) => r.id === maal.id)) rader.push({ id: maal.id, resultat: "finnes_ikke" });
  }
  return rader;
}

function vurder(h: Rad, maal: (typeof FORTEGN_RECOVERY_MAAL)[number]): FortegnStatus {
  const hopp = (grunn: string): FortegnStatus => ({ id: maal.id, resultat: "hoppet_over", grunn });

  if (h.transaksjonId !== maal.transaksjonId) return hopp("transaksjonId matcher ikke forventet");
  if (h.regelId !== FORTEGN_RECOVERY_REGEL_ID) return hopp("regelId matcher ikke forventet");
  const fordelinger = Array.isArray(h.fordelinger) ? h.fordelinger : null;
  if (!fordelinger || fordelinger.length !== 1) {
    return hopp("forventet noyaktig én fordeling, fant " + (fordelinger ?? []).length);
  }
  // Legacy kaster her hvis elementet ikke er et objekt; RTDB lagrer aldri null i en array,
  // men et ikke-objekt gir «hoppet over» i stedet for at kontrollen feiler.
  const f: Rad = erObjekt(fordelinger[0]) ? fordelinger[0] : {};
  if (f.plasseringId !== FORTEGN_RECOVERY_PLASSERING_ID) {
    return hopp("plasseringId matcher ikke forventet");
  }
  if (f.plasseringType !== "budget") return hopp("plasseringType matcher ikke forventet");
  if (f.belop === -maal.forventetBelop) {
    return { id: maal.id, resultat: "allerede_korrekt", belop: -maal.forventetBelop };
  }
  if (f.belop !== maal.forventetBelop) {
    return hopp(
      `belop (${f.belop}) matcher verken forventet feiltilstand (${maal.forventetBelop}) eller allerede korrigert (${-maal.forventetBelop})`,
    );
  }
  return {
    id: maal.id,
    resultat: "trenger_retting",
    belop: maal.forventetBelop,
    rettetBelop: -maal.forventetBelop,
  };
}
