/**
 * Datalag for saldoavstemming (#59):
 * `families/{familyId}/saldokontroller/{kontoNøkkel}/{YYYY-MM}`.
 *
 * Ny, additiv node som bare React skriver — ingen eksisterende node røres,
 * og legacy `index.html` skriver aldri hele familieroten. Én post per konto
 * og måned på en deterministisk sti, så lagring er idempotent og målrettet
 * (ingen array-transaksjon). Kontoen ligger i verdien; nøkkelen er en
 * tapsfri koding av den (`kontoNokkel`), så rå kontoverdier — også med
 * tegn Firebase ikke tillater i nøkler — aldri kan kollidere.
 */
import { onValue, ref, set } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { FamilyId } from "@app-types/family";

/** Prefiks som skiller kodede kontonøkler fra alt annet under noden. */
const NOKKEL_PREFIKS = "k_";

/**
 * Tapsfri, injektiv Firebase-nøkkel for en konto (Kontrolltårnet
 * 6062856860): `k_` + base64url av UTF-8. To ulike kontoer kan aldri få
 * samme sti (en ren tegnerstatning ville gjort `A.B` og `A_B` like, og
 * `set()` kunne da overskrevet en annen kontos saldo). base64url bruker
 * bare `A–Z a–z 0–9 - _`, som alle er gyldige i Firebase-nøkler.
 */
export function kontoNokkel(konto: string): string {
  const bytes = new TextEncoder().encode(konto);
  let binar = "";
  for (const b of bytes) binar += String.fromCharCode(b);
  return NOKKEL_PREFIKS + btoa(binar).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Motsatt av `kontoNokkel`, eller `null` hvis nøkkelen ikke er kodet av den. */
export function kontoFraNokkel(nokkel: string): string | null {
  if (!nokkel.startsWith(NOKKEL_PREFIKS)) return null;
  try {
    const b64 = nokkel.slice(NOKKEL_PREFIKS.length).replace(/-/g, "+").replace(/_/g, "/");
    const binar = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binar, (c) => c.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

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
        konto: v.konto ?? kontoFraNokkel(nokkel) ?? nokkel,
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
