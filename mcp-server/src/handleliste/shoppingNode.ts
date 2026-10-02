/**
 * Ren tolkning av den RÅ `families/{f}/shopping`-noden og beslutningen
 * inne i `shopping_list_add_items`-transaksjonen (Kontrolltårn-beslutning
 * 5950478583, alternativ A). Ingen I/O — updateren i `service.ts` kaller
 * `decideAddItems` mot hver ferske verdi RTDB gir den.
 *
 * ## Noden
 *
 * `shopping/{id}` er vareposter i appens form. `shopping/_ops/{requestId}`
 * er MCP-flatens idempotens-metadata (`OpRecord`) og ALDRI en vare: alle
 * nøkler som starter med `_` er reservert og filtreres eksplisitt (samme
 * regel som `isReservedShoppingKey` i `web/src/data/shopping.repository.ts`).
 *
 * Legacy-seeden `INIT_SHOPPING` har heltallsnøkler 1–4, så RTDB kan
 * returnere noden som en sparsom array. `normalizeShoppingNode` gjør den
 * til et objekt med samme nøkler; når `_ops` skrives, blir noden et
 * objekt for godt (en strengnøkkel gjør at RTDB aldri tolker den som array).
 *
 * ## Retensjon (pkt. 2)
 *
 * `_ops` beholder en record i 7 d og maks 100 recorder. En record kan KUN
 * beskjæres når `mcp/actions/{f}/{requestId}` (90 d) bekreftet finnes
 * (`archived`) — så en gammel retry kan aldri bli en ny mutasjon fordi
 * kortregisteret er beskåret. Feiler arkiveringen gjentatte ganger, får
 * `_ops` vokse over 100 heller enn å miste garantien.
 */
import { normalizeItemName } from "@domain/shopping/handlelisteRules";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import type { ActionRecord, ActionTool, AddItemOutcome, OpRecord } from "../store/types";
import { planShoppingAdds, type ResolvedInput } from "./plan";

export const OPS_KEY = "_ops";
const DAY_MS = 24 * 60 * 60 * 1000;
export const OPS_TTL_MS = 7 * DAY_MS;
export const OPS_MAX = 100;
export const ACTION_RETENTION_DAYS = 90;

export function isReservedShoppingKey(key: string): boolean {
  return key.startsWith("_");
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** null → `{}`, legacy-array → objekt med indeksnøkler (hull hoppes over). */
export function normalizeShoppingNode(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (Array.isArray(raw)) {
    const node: Record<string, unknown> = {};
    raw.forEach((value, index) => {
      if (value !== null && value !== undefined) node[String(index)] = value;
    });
    return node;
  }
  if (isObject(raw)) return { ...raw };
  // En primitiv verdi på listens plass er korrupt — aldri overskriv den blindt.
  throw new Error("Uventet verdi i families/{f}/shopping");
}

/**
 * Port 1:1 av `parseShoppingListEntry` i `web/src/data/shopping.repository.ts`.
 * Én bevisst tilleggsregel: en post uten streng-`name` hoppes over i stedet
 * for å krasje dedup-matchen (`name.toLowerCase()`) for hele listen.
 */
export function parseShoppingEntry(raw: unknown): ShoppingListEntry | null {
  if (!isObject(raw) || typeof raw.name !== "string") return null;
  return {
    itemId: (raw.itemId as string | null | undefined) ?? null,
    name: raw.name,
    amount: (raw.amount as string | undefined) ?? "",
    cat: (raw.cat as string | undefined) ?? "Diverse",
    done: (raw.done as boolean | undefined) ?? false,
  };
}

/** Vareposter i noden — reserverte nøkler og poster uten navn hoppes over. */
export function parseShoppingEntries(raw: unknown): ShoppingItem[] {
  return Object.entries(normalizeShoppingNode(raw)).flatMap(([id, value]) => {
    if (isReservedShoppingKey(id)) return [];
    const entry = parseShoppingEntry(value);
    return entry ? [{ id, ...entry }] : [];
  });
}

/** `shopping/_ops` som objekt (alt annet → tomt). */
export function opsOf(node: Record<string, unknown>): Record<string, unknown> {
  const ops = node[OPS_KEY];
  return isObject(ops) ? ops : {};
}

export interface RequestIdentity {
  requestId: string;
  tool: ActionTool;
  fingerprint: string;
  idpSub: string;
  firebaseUid: string;
  clientId: string;
}

export type RecordMatch =
  | { kind: "none" }
  | { kind: "replay"; result: AddItemOutcome[] }
  /** Samme requestId, men annen payload eller annen principal. */
  | { kind: "conflict" };

function parseResult(raw: unknown): AddItemOutcome[] | null {
  if (Array.isArray(raw)) return raw as AddItemOutcome[];
  if (isObject(raw)) return Object.values(raw) as AddItemOutcome[];
  return null;
}

/** En velformet `OpRecord`, ellers `null`. */
export function parseOpRecord(raw: unknown): OpRecord | null {
  if (!isObject(raw) || raw.tool !== "shopping_list_add_items") return null;
  const result = parseResult(raw.result ?? []);
  if (
    typeof raw.fp !== "string" ||
    typeof raw.sub !== "string" ||
    typeof raw.at !== "number" ||
    !result
  ) {
    return null;
  }
  return {
    tool: raw.tool,
    fp: raw.fp,
    sub: raw.sub,
    uid: typeof raw.uid === "string" ? raw.uid : "",
    client: typeof raw.client === "string" ? raw.client : "",
    at: raw.at,
    result,
  };
}

/** En velformet `ActionRecord`, ellers `null`. */
export function parseActionRecord(raw: unknown): ActionRecord | null {
  if (!isObject(raw) || raw.tool !== "shopping_list_add_items") return null;
  const result = parseResult(raw.result ?? []);
  if (typeof raw.fingerprint !== "string" || typeof raw.idpSub !== "string" || !result) {
    return null;
  }
  return {
    requestId: String(raw.requestId ?? ""),
    tool: raw.tool,
    fingerprint: raw.fingerprint,
    idpSub: raw.idpSub,
    firebaseUid: String(raw.firebaseUid ?? ""),
    clientId: String(raw.clientId ?? ""),
    committedAt: Number(raw.committedAt ?? 0),
    result,
  };
}

/**
 * Finnes det allerede en record for requestId-en? En node som finnes men
 * ikke har forventet form er en KONFLIKT, aldri "finnes ikke" — en korrupt
 * markør skal aldri føre til dobbel skriving.
 */
function match(
  raw: unknown,
  parsed: { tool: ActionTool; fingerprint: string; sub: string; result: AddItemOutcome[] } | null,
  req: RequestIdentity,
): RecordMatch {
  if (raw === null || raw === undefined) return { kind: "none" };
  if (!parsed) return { kind: "conflict" };
  return parsed.tool === req.tool &&
    parsed.fingerprint === req.fingerprint &&
    parsed.sub === req.idpSub
    ? { kind: "replay", result: parsed.result }
    : { kind: "conflict" };
}

export function matchOpRecord(raw: unknown, req: RequestIdentity): RecordMatch {
  const op = parseOpRecord(raw);
  return match(
    raw,
    op && { tool: op.tool, fingerprint: op.fp, sub: op.sub, result: op.result },
    req,
  );
}

export function matchActionRecord(raw: unknown, req: RequestIdentity): RecordMatch {
  const r = parseActionRecord(raw);
  return match(
    raw,
    r && { tool: r.tool, fingerprint: r.fingerprint, sub: r.idpSub, result: r.result },
    req,
  );
}

/** Recorden for `mcp/actions`, gjenoppbygd fra en op-record (reparasjon/arkivering). */
export function actionRecordFromOp(requestId: string, op: OpRecord): ActionRecord {
  return {
    requestId,
    tool: op.tool,
    fingerprint: op.fp,
    idpSub: op.sub,
    firebaseUid: op.uid,
    clientId: op.client,
    committedAt: op.at,
    result: op.result,
  };
}

/** UTC-dag (`YYYY-MM-DD`) — nøkkel i `mcp/actionsByDay`. */
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Siste dag som skal beskjæres fra `mcp/actions` ved tidspunkt `now`. */
export const lastExpiredActionDay = (now: number) =>
  dayKey(now - (ACTION_RETENTION_DAYS + 1) * DAY_MS);

/**
 * Op-recorder som SKAL beskjæres ved neste skriving (eldste først):
 * eldre enn TTL, pluss de eldste utover `OPS_MAX - 1` (plass til den nye).
 * Misdannede recorder beskjæres aldri — de kan ikke arkiveres og er en
 * konflikt-verdi for sin requestId.
 */
export function pruneCandidates(ops: Record<string, unknown>, now: number): string[] {
  const wellFormed = Object.entries(ops)
    .map(([id, raw]) => [id, parseOpRecord(raw)] as const)
    .filter((e): e is readonly [string, OpRecord] => e[1] !== null)
    .sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]));
  const overflow = Math.max(0, Object.keys(ops).length - (OPS_MAX - 1));
  return wellFormed
    .filter(([, op], index) => op.at < now - OPS_TTL_MS || index < overflow)
    .map(([id]) => id);
}

/** Fjerner kandidater som er BEKREFTET arkivert — ingen andre. */
export function pruneOps(
  ops: Record<string, unknown>,
  now: number,
  archived: ReadonlySet<string>,
): Record<string, unknown> {
  const remove = new Set(pruneCandidates(ops, now).filter((id) => archived.has(id)));
  return Object.fromEntries(Object.entries(ops).filter(([id]) => !remove.has(id)));
}

export interface AddItemsDecisionInput {
  req: RequestIdentity;
  now: number;
  resolved: readonly ResolvedInput[];
  /** requestId-er i `_ops` som er bekreftet å finnes i `mcp/actions`. */
  archived: ReadonlySet<string>;
  newId: () => string;
}

export type AddItemsDecision =
  | { kind: "replay"; result: AddItemOutcome[] }
  | { kind: "conflict" }
  | { kind: "apply"; next: Record<string, unknown>; result: AddItemOutcome[] };

/**
 * Hele beslutningen, beregnet fra ÉN fersk verdi av noden:
 *
 *  - finnes `_ops[requestId]` → replay (samme payload/principal) eller
 *    konflikt — ingen mutasjon;
 *  - ellers planlegges endringen mot DENNE verdiens poster, og neste verdi
 *    er noden med endrede/nye poster + `_ops[requestId]` (+ beskjæring).
 *
 * Endrede poster skrives over den RÅ posten (`{...rå, ...post}`), så felt
 * appen eller legacy har lagt der (f.eks. `id`) bevares. Nye poster får
 * sitt eget `id`, som web-poster (legacy-helnode-skriving kollapser ellers).
 */
export function decideAddItems(raw: unknown, input: AddItemsDecisionInput): AddItemsDecision {
  const node = normalizeShoppingNode(raw);
  const ops = opsOf(node);
  const existing = matchOpRecord(ops[input.req.requestId], input.req);
  if (existing.kind !== "none") return existing;

  const adds = planShoppingAdds(parseShoppingEntries(node), input.resolved, input.newId);
  const result = adds.results.map(withoutUndefinedFields);
  const next: Record<string, unknown> = { ...node };
  for (const { id, entry } of adds.newEntries) next[id] = withoutUndefinedFields({ ...entry, id });
  for (const { id, entry } of adds.updatedEntries) {
    const current = node[id];
    next[id] = withoutUndefinedFields({ ...(isObject(current) ? current : {}), ...entry });
  }
  const op: OpRecord = {
    tool: input.req.tool,
    fp: input.req.fingerprint,
    sub: input.req.idpSub,
    uid: input.req.firebaseUid,
    client: input.req.clientId,
    at: input.now,
    result,
  };
  next[OPS_KEY] = { ...pruneOps(ops, input.now, input.archived), [input.req.requestId]: op };
  return { kind: "apply", next, result };
}

/** RTDB tar ikke imot `undefined`; `null` sletter feltet. */
function withoutUndefinedFields<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Deterministisk vare-id per (familie, requestId, navn) — se `service.ts` §Varebasen. */
export function itemIdSeed(familyId: string, requestId: string, name: string): string {
  return `${familyId}\n${requestId}\n${normalizeItemName(name)}`;
}
