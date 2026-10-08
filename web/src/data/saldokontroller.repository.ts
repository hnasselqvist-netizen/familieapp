/**
 * Datalag for saldoavstemming (#59):
 * `families/{familyId}/saldokontroller/{kontoNøkkel}/{YYYY-MM}`.
 *
 * Ny, additiv node som bare React skriver — ingen eksisterende node røres,
 * og legacy `index.html` skriver aldri hele familieroten. Én post per konto
 * og måned på en deterministisk sti, så lagring er idempotent og målrettet
 * (ingen array-transaksjon). Kontoen ligger i verdien; nøkkelen er bare en
 * trygg Firebase-nøkkel (rå kontoverdier, f.eks. kontonumre, kan inneholde
 * tegn Firebase ikke tillater i nøkler).
 */
import { onValue, ref, set } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { FamilyId } from "@app-types/family";

const UGYLDIGE_NOKKELTEGN = /[.#$[\]/]/g;

/** Firebase-trygg nøkkel for en konto (`.#$[]/` → `_`). */
export const kontoNokkel = (konto: string): string =>
  konto.replace(UGYLDIGE_NOKKELTEGN, "_") || "_";

export const saldokontrollerPath = (familyId: FamilyId): string =>
  `families/${familyId}/saldokontroller`;

export const saldokontrollPath = (familyId: FamilyId, konto: string, maaned: string): string =>
  `${saldokontrollerPath(familyId)}/${kontoNokkel(konto)}/${maaned}`;

/** Flater ut `{kontoNøkkel: {YYYY-MM: kontroll}}` til en liste. */
export function parseSaldokontroller(raw: unknown): SaldoKontroll[] {
  if (!raw || typeof raw !== "object") return [];
  const ut: SaldoKontroll[] = [];
  for (const [nokkel, maaneder] of Object.entries(raw as Record<string, unknown>)) {
    if (!maaneder || typeof maaneder !== "object") continue;
    for (const [maaned, verdi] of Object.entries(maaneder as Record<string, unknown>)) {
      if (!verdi || typeof verdi !== "object") continue;
      const v = verdi as Partial<SaldoKontroll>;
      if (typeof v.faktiskSaldo !== "number") continue;
      ut.push({
        konto: v.konto ?? nokkel,
        maaned: v.maaned ?? maaned,
        dato: v.dato ?? "",
        faktiskSaldo: v.faktiskSaldo,
        registrert: v.registrert ?? "",
        oppdatert: v.oppdatert ?? "",
        ...(v.grunnlag ? { grunnlag: v.grunnlag } : {}),
      });
    }
  }
  return ut;
}

export function subscribeSaldokontroller(
  familyId: FamilyId,
  onChange: (kontroller: SaldoKontroll[]) => void,
): () => void {
  return onValue(ref(getFirebaseDatabase(), saldokontrollerPath(familyId)), (snapshot) =>
    onChange(parseSaldokontroller(snapshot.val())),
  );
}

/** Lagrer (oppretter eller erstatter) kontrollpunktet for kontroll.konto/kontroll.maaned. */
export async function lagreSaldokontroll(
  familyId: FamilyId,
  kontroll: SaldoKontroll,
): Promise<void> {
  await set(
    ref(getFirebaseDatabase(), saldokontrollPath(familyId, kontroll.konto, kontroll.maaned)),
    kontroll,
  );
}
