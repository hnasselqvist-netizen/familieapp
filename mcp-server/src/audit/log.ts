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
 * Trygg feilbeskrivelse for loggen (#85-review 5709352689): bare feilklassen
 * og en kode som matcher et smalt mønster — aldri melding, stack eller
 * payload. SDK-, nettverks- og JSON-feil kan inneholde dataverdier,
 * URL-er eller deler av forespørselen.
 */
export function tryggFeil(err: unknown): { feilklasse: string; feilkode?: string } {
  const feilklasse =
    err instanceof Error
      ? /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(err.name)
        ? err.name
        : "Error"
      : typeof err;
  const kode =
    err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  return typeof kode === "string" && /^[A-Za-z0-9_/-]{1,60}$/.test(kode)
    ? { feilklasse, feilkode: kode }
    : { feilklasse };
}
