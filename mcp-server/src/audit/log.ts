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
