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
 * Firebase-SDK-ets avbruddsgrunner står i MELDINGEN, ikke i `code`:
 * transaksjonen avbrytes med `new Error("maxretry")` / `new Error("set")`,
 * og en serverstatus kommer som `"<status> at /sti: …"` (første
 * produksjonsskriving, #27 6525665315). Bare et fast vokabular gjenkjennes;
 * stien og resten av meldingen brukes aldri.
 */
const AVBRUDDSGRUNNER = new Set([
  "maxretry",
  "set",
  "nodata",
  "disconnect",
  "datastale",
  "permission_denied",
  "too_big",
  "write_too_big",
  "unavailable",
  "invalid_token",
  "expired_token",
  "overriddenBySet",
]);

/** SDK-ets klientvalidering av transaksjonsverdien (kastes før noe sendes). */
const SDK_VALIDERING = "transaction failed: Data returned ";

/**
 * Avbruddsgrunnen til en Firebase-feil som et fast token, eller `undefined`.
 * `ugyldig_data` = SDK-ets klientvalidering; `annen_status` = en serverstatus
 * på SDK-formen (`<status> at /sti`) som ikke er i vokabularet. Kaster aldri.
 */
export function avbruddsgrunn(err: unknown): string | undefined {
  try {
    if (!(err instanceof Error)) return undefined;
    const melding = err.message;
    if (typeof melding !== "string") return undefined;
    if (melding.startsWith(SDK_VALIDERING)) return "ugyldig_data";
    const treff = /^([A-Za-z_]{2,40})( at \/|$)/.exec(melding);
    const token = treff?.[1];
    if (!token) return undefined;
    if (AVBRUDDSGRUNNER.has(token)) return token;
    // Bare SDK-formen for serverstatus (`<status> at /sti`) er entydig nok
    // til å si «en annen status»; et løst ord er ikke en avbruddsgrunn.
    return treff[2] ? "annen_status" : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Trygg feilbeskrivelse for loggen (#85-review 5709352689 og 5710037222):
 * en fast feilklasse avgjort med `instanceof` (aldri `err.name`, som kan
 * settes fritt) og en feilkode bare fra `TILLATTE_KODER`. Aldri melding,
 * stack, navn eller payload — bortsett fra `avbrudd`, et fast token fra
 * `avbruddsgrunn`. Kaster aldri, heller ikke for objekter med kastende
 * gettere eller proxyer.
 */
export function tryggFeil(err: unknown): {
  feilklasse: string;
  feilkode?: string;
  avbrudd?: string;
} {
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
    if (typeof kode === "string" && TILLATTE_KODER.has(kode)) {
      const avbrudd = avbruddsgrunn(err);
      return avbrudd ? { feilklasse, feilkode: kode, avbrudd } : { feilklasse, feilkode: kode };
    }
  } catch {
    // En kastende getter på `code` gir bare klassen.
  }
  const avbrudd = avbruddsgrunn(err);
  return avbrudd ? { feilklasse, avbrudd } : { feilklasse };
}
