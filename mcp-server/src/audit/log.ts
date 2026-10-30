/**
 * Best-effort strukturert hendelseslogg (én JSON-linje per hendelse på
 * stdout — Cloud Logging plukker dette opp uten ekstra oppsett). Kaster
 * ALDRI: en loggfeil skal aldri kunne endre utfallet av et verktøykall
 * (Issue #27, 5937138669 pkt. 5). Den transaksjonelle audit-posten for
 * skrivinger er action-recorden (§handleliste/service.ts), ikke denne.
 */
import type { AuditLog } from "../handleliste/service";

export function jsonLineAudit(write: (line: string) => void = (l) => console.log(l)): AuditLog {
  return {
    event(name, fields) {
      try {
        write(
          JSON.stringify({
            severity: "INFO",
            event: name,
            at: new Date().toISOString(),
            ...fields,
          }),
        );
      } catch {
        // Bevisst svelget — se filens toppkommentar.
      }
    },
  };
}

/**
 * Kjente feilkoder som får logges (#85-review 5710037222): Firebase-
 * transaksjonens avbruddsgrunner og RTDB-ens tilgangsfeil. Alt annet logges
 * som en fast kategori — en kode eller et navn kan bære vilkårlig tekst.
 */
const TILLATTE_KODER = new Set([
  "maxretry",
  "overriddenBySet",
  "disconnect",
  "PERMISSION_DENIED",
  "permission_denied",
  "database/permission-denied",
  "app/network-error",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

/**
 * Trygg feilbeskrivelse for loggen (#85-review 5709352689 og 5710037222):
 * en fast feilklasse avgjort med `instanceof` (aldri `err.name`, som kan
 * settes fritt) og en feilkode bare fra `TILLATTE_KODER`. Aldri melding,
 * stack, navn eller payload. Kaster aldri, heller ikke for objekter med
 * kastende gettere eller proxyer.
 */
export function tryggFeil(err: unknown): { feilklasse: string; feilkode?: string } {
  let feilklasse = "ukjent";
  try {
    feilklasse =
      err instanceof TypeError
        ? "TypeError"
        : err instanceof RangeError
          ? "RangeError"
          : err instanceof SyntaxError
            ? "SyntaxError"
            : err instanceof Error
              ? "Error"
              : err === null
                ? "null"
                : typeof err;
  } catch {
    return { feilklasse };
  }
  try {
    const kode =
      err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
    if (typeof kode === "string" && TILLATTE_KODER.has(kode)) return { feilklasse, feilkode: kode };
  } catch {
    // En kastende getter på `code` gir bare klassen.
  }
  return { feilklasse };
}
