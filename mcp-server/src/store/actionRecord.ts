/**
 * Ren beslutningslogikk for idempotens-leasen, delt av begge store-
 * implementasjonene — Admin-adapteren kjører `nextClaimState` inne i en
 * RTDB-transaksjon på `mcp/actions/{f}/{requestId}`, faken kjører den
 * synkront. Samme regel, ett sted.
 */
import type { ActionRecord, AddItemOutcome, ClaimRequest, ClaimResult } from "./types";

/**
 * Ny verdi for action-noden gitt gjeldende verdi, eller `undefined` for
 * "la noden være" (avbryt transaksjonen):
 *
 *  - ingen record → ny `pending` med vår claimToken og lease;
 *  - `pending` med UTLØPT lease og samme fingerprint/principal → overta
 *    (forrige eier krasjet før commit; commit er atomisk, så ingenting av
 *    endringen ble skrevet);
 *  - alt annet (committet, aktiv lease, konflikt) → urørt.
 */
export function nextClaimState(
  current: ActionRecord | null,
  claim: ClaimRequest,
): ActionRecord | undefined {
  const pending: ActionRecord = {
    status: "pending",
    requestId: claim.requestId,
    tool: claim.tool,
    fingerprint: claim.fingerprint,
    idpSub: claim.idpSub,
    firebaseUid: claim.firebaseUid,
    clientId: claim.clientId,
    createdAt: claim.now,
    claimToken: claim.claimToken,
    leaseUntil: claim.now + claim.leaseMs,
  };
  if (current === null) return pending;
  if (current.status !== "pending") return undefined;
  if (current.leaseUntil > claim.now) return undefined;
  if (!sameRequest(current, claim)) return undefined;
  return { ...pending, createdAt: current.createdAt };
}

/** Tolker nodens verdi ETTER claim-forsøket. */
export function interpretClaim(after: ActionRecord | null, claim: ClaimRequest): ClaimResult {
  if (after === null) {
    // Kan i praksis ikke skje etter en vellykket transaksjon; behandles
    // som "prøv igjen" heller enn å late som vi eier leasen.
    return { kind: "in_progress", leaseUntil: claim.now };
  }
  if (!sameRequest(after, claim)) return { kind: "conflict" };
  if (after.status === "committed") return { kind: "committed", record: after };
  if (after.claimToken === claim.claimToken)
    return { kind: "claimed", leaseUntil: after.leaseUntil };
  return { kind: "in_progress", leaseUntil: after.leaseUntil };
}

function sameRequest(record: ActionRecord, claim: ClaimRequest): boolean {
  return (
    record.tool === claim.tool &&
    record.fingerprint === claim.fingerprint &&
    record.idpSub === claim.idpSub
  );
}

/**
 * Leser en rå RTDB-verdi defensivt tilbake til en `ActionRecord`. En node
 * som ikke har forventet form behandles som en konflikt-verdi (aldri som
 * "finnes ikke"), så en korrupt markør aldri fører til dobbel skriving.
 */
export function parseActionRecord(raw: unknown): ActionRecord | null {
  if (raw === null || raw === undefined) return null;
  const r = raw as Record<string, unknown>;
  const base = {
    requestId: String(r.requestId ?? ""),
    tool: "shopping_list_add_items" as const,
    fingerprint: String(r.fingerprint ?? ""),
    idpSub: String(r.idpSub ?? ""),
    firebaseUid: String(r.firebaseUid ?? ""),
    clientId: String(r.clientId ?? ""),
    createdAt: Number(r.createdAt ?? 0),
  };
  if (r.tool !== "shopping_list_add_items") {
    return { ...base, fingerprint: "", status: "committed", committedAt: 0, result: [] };
  }
  if (r.status === "pending") {
    return {
      ...base,
      status: "pending",
      claimToken: String(r.claimToken ?? ""),
      leaseUntil: Number(r.leaseUntil ?? 0),
    };
  }
  const rawResult = r.result;
  const result = Array.isArray(rawResult)
    ? rawResult
    : rawResult && typeof rawResult === "object"
      ? Object.values(rawResult)
      : [];
  return {
    ...base,
    status: "committed",
    committedAt: Number(r.committedAt ?? 0),
    result: result as AddItemOutcome[],
  };
}

/** Fjerner `undefined`-felt (Admin SDK-et nekter å skrive dem). */
export function withoutUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
