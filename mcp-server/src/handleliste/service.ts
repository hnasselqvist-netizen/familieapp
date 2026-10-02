/**
 * Handleliste-tjenesten: les, søk, legg til — transport-uavhengig (kjenner
 * kun store-porten). Autorisasjonen er allerede gjort (`FamilyContext`).
 *
 * ## Idempotens (Issue #27 pkt. 4; Kontrolltårn-beslutning 5950478583)
 *
 * Mengdesummering er ikke idempotent i seg selv, så `requestId` bærer
 * idempotensen. `shopping_list_add_items` skriver gjennom ÉN RTDB-
 * transaksjon på `families/{f}/shopping`:
 *
 *  1. **Langt register** — `mcp/actions/{f}/{requestId}` (90 d) sjekkes
 *     først: samme payload/principal → replay, ellers konflikt.
 *  2. **Kort register** — `shopping/_ops/{requestId}` (7 d) sjekkes før
 *     varebasen røres, så en replay aldri oppretter varer.
 *  3. **Varebasen** — nye varer opprettes med deterministisk id og kun hvis
 *     id-en er ledig (se under).
 *  4. **Transaksjonen** — updateren (`decideAddItems`) beregner ALT fra
 *     transaksjonens ferske verdi: replay/konflikt hvis `_ops[requestId]`
 *     finnes, ellers vareendringene + `_ops[requestId]` i én og samme
 *     skriving. Endrer appen listen underveis, kjøres updateren på nytt mot
 *     den nye verdien — en endring beregnet fra et utdatert øyeblikksbilde
 *     blir aldri skrevet, og appens endring overlever.
 *  5. **Arkivering** — `mcp/actions` skrives etter commit (best-effort).
 *     Feiler den, blir `_ops`-recorden stående til en senere skriving har
 *     reparert arkivet (`confirmArchived`) — først da kan den beskjæres.
 *
 * Krasj/retry: feil før commit → ingenting skrevet (transaksjonen er
 * alt-eller-ingenting), retry utfører én gang. Tapt svar etter commit →
 * retry finner `_ops`/`mcp/actions` → replay. Samtidige kall med samme
 * requestId → det ene committer, det andres updater ser `_ops` → replay.
 *
 * **Etter 90 dager** er en requestId utløpt: begge registrene er beskåret,
 * og samme requestId behandles som en ny forespørsel. requestId er en
 * nøkkel for retries av ÉN forespørsel (sekunder–minutter), ikke en evig
 * idempotensnøkkel — klienter skal alltid lage en ny per forespørsel.
 *
 * ## Varebasen
 *
 * Varebasen ligger utenfor transaksjonsroten, så nye varer opprettes FØR
 * transaksjonen (som appens `findOrCreateItem`). Id-en er deterministisk
 * per (familie, requestId, navn), og skrives kun hvis den er ledig: en
 * retry eller et samtidig kall med samme requestId gjenbruker samme vare
 * i stedet for å lage et duplikat. Feiler transaksjonen etterpå, står
 * varen igjen i varebasen uten handlelistepost — harmløst, og den samme
 * varen brukes ved retry.
 *
 * ## Audit (pkt. 5)
 *
 * `_ops` og `mcp/actions` er den transaksjonelle audit-posten for
 * skrivinger (hvem, hva, når). Alt annet logges best-effort via
 * `AuditLog`, som aldri kaster.
 */
import { createHash, randomUUID } from "node:crypto";
import { normalizeItemName } from "@domain/shopping/handlelisteRules";
import type { FamilyContext } from "../auth/authorize";
import type { ActionRecord, AddItemOutcome, FamilyId, HverdagsflytStore } from "../store/types";
import { ToolError } from "./errors";
import { findDuplicateNames, resolveItems } from "./plan";
import type { AddItemInput } from "./schemas";
import { LIMITS } from "./schemas";
import {
  actionRecordFromOp,
  type AddItemsDecision,
  dayKey,
  decideAddItems,
  itemIdSeed,
  lastExpiredActionDay,
  matchActionRecord,
  matchOpRecord,
  parseOpRecord,
  parseShoppingEntries,
  pruneCandidates,
  type RequestIdentity,
} from "./shoppingNode";
import { searchItems, shoppingListView } from "./views";

export interface AuditLog {
  event(name: string, fields: Record<string, unknown>): void;
}

/**
 * Pakker en hvilken som helst `AuditLog` slik at den ALDRI kan kaste inn i
 * kalleren — en loggfeil etter commit skal aldri gjøre en vellykket
 * skriving om til en tilsynelatende feil (5937138669 pkt. 5).
 */
export function safeAudit(audit: AuditLog | undefined): AuditLog {
  return {
    event(name, fields) {
      try {
        audit?.event(name, fields);
      } catch {
        // Bevisst svelget — se over.
      }
    },
  };
}

export interface ServiceOptions {
  clock?: () => number;
  newId?: () => string;
  audit?: AuditLog;
}

export interface AddItemsResult {
  requestId: string;
  replayed: boolean;
  results: AddItemOutcome[];
  list: ReturnType<typeof shoppingListView> | null;
}

const TOOL = "shopping_list_add_items" as const;
/** Maks antall dagsbøtter i `mcp/actionsByDay` som beskjæres per skriving. */
const ARCHIVE_PRUNE_DAYS_PER_CALL = 3;

export class HandlelisteService {
  private readonly clock: () => number;
  private readonly newId: () => string;
  private readonly audit: AuditLog;

  private readonly store: HverdagsflytStore;

  constructor(store: HverdagsflytStore, options: ServiceOptions = {}) {
    this.store = store;
    this.clock = options.clock ?? Date.now;
    this.newId = options.newId ?? randomUUID;
    this.audit = safeAudit(options.audit);
  }

  async getShoppingList(ctx: FamilyContext, input: { includeDone?: boolean }) {
    const node = await this.store.readShoppingNode(ctx.familyId);
    return shoppingListView(parseShoppingEntries(node), input.includeDone ?? false);
  }

  async searchItems(ctx: FamilyContext, input: { query: string; limit?: number }) {
    const items = await this.store.readItems(ctx.familyId);
    return searchItems(items, input.query, input.limit ?? LIMITS.searchLimitDefault);
  }

  async addItems(
    ctx: FamilyContext,
    input: { requestId: string; items: AddItemInput[] },
  ): Promise<AddItemsResult> {
    const duplicates = findDuplicateNames(input.items);
    if (duplicates.length > 0) {
      throw new ToolError(
        "duplicate_items",
        `Samme vare er oppgitt flere ganger: ${duplicates.join(", ")}. Slå dem sammen til én linje.`,
        false,
      );
    }

    const familyId = ctx.familyId;
    const req: RequestIdentity = {
      requestId: input.requestId,
      tool: TOOL,
      fingerprint: requestFingerprint(input.items),
      idpSub: ctx.idpSub,
      firebaseUid: ctx.firebaseUid,
      clientId: ctx.clientId,
    };

    // 1. Langt register (90 d).
    const archivedMatch = matchActionRecord(
      await this.store.readArchivedAction(familyId, req.requestId),
      req,
    );
    if (archivedMatch.kind === "conflict") throw conflictError();
    if (archivedMatch.kind === "replay") {
      return this.replay(ctx, req.requestId, archivedMatch.result, "archive");
    }

    // 2. Kort register (_ops, 7 d) — før varebasen røres.
    const ops = asRecord(await this.store.readShoppingOps(familyId));
    const opMatch = matchOpRecord(ops[req.requestId], req);
    if (opMatch.kind === "conflict") throw conflictError();
    if (opMatch.kind === "replay") {
      await this.archiveFromOp(familyId, req.requestId, ops[req.requestId]);
      return this.replay(ctx, req.requestId, opMatch.result, "ops");
    }

    const now = this.clock();
    const archived = await this.confirmArchived(familyId, ops, now);

    // 3. Varebasen.
    const resolved = await this.resolveAndCreateItems(familyId, req.requestId, input.items);

    // 4. Transaksjonen — kun siste kall av updateren teller.
    let decision: AddItemsDecision | null = null;
    const { committed } = await this.store.transactShopping(familyId, (current) => {
      decision = decideAddItems(current, { req, now, resolved, archived, newId: this.newId });
      return decision.kind === "apply" ? decision.next : undefined;
    });
    const final = decision as AddItemsDecision | null;
    if (!final) throw new Error("Transaksjonen kjørte aldri updateren");
    if (final.kind === "conflict") throw conflictError();
    if (final.kind === "replay") {
      // Et samtidig kall med samme requestId committet først.
      return this.replay(ctx, req.requestId, final.result, "ops");
    }
    if (!committed) throw new Error("Handleliste-transaksjonen ble ikke fullført");

    this.audit.event("action_committed", {
      requestId: req.requestId,
      tool: TOOL,
      outcomes: final.result.map((r) => r.outcome),
    });

    // 5. Arkivering og beskjæring av det lange registeret — best-effort.
    await this.archive(familyId, {
      requestId: req.requestId,
      tool: TOOL,
      fingerprint: req.fingerprint,
      idpSub: req.idpSub,
      firebaseUid: req.firebaseUid,
      clientId: req.clientId,
      committedAt: now,
      result: final.result,
    });
    await this.store
      .pruneArchivedActions(familyId, lastExpiredActionDay(now), ARCHIVE_PRUNE_DAYS_PER_CALL)
      .catch((err: unknown) => this.audit.event("archive_prune_failed", { error: String(err) }));

    return {
      requestId: req.requestId,
      replayed: false,
      results: final.result,
      list: await this.readBack(ctx),
    };
  }

  private async replay(
    ctx: FamilyContext,
    requestId: string,
    results: AddItemOutcome[],
    source: "archive" | "ops",
  ): Promise<AddItemsResult> {
    this.audit.event("action_replayed", { requestId, tool: TOOL, source });
    return { requestId, replayed: true, results, list: await this.readBack(ctx) };
  }

  /**
   * Sikrer at hver `_ops`-record som står for tur til beskjæring finnes i
   * `mcp/actions` (reparerer fra op-recorden ved behov). Returnerer de som
   * er BEKREFTET arkivert — kun de kan beskjæres i transaksjonen.
   */
  private async confirmArchived(
    familyId: FamilyId,
    ops: Record<string, unknown>,
    now: number,
  ): Promise<Set<string>> {
    const confirmed = new Set<string>();
    await Promise.all(
      pruneCandidates(ops, now).map(async (requestId) => {
        try {
          const op = parseOpRecord(ops[requestId]);
          if (!op) return;
          const raw = await this.store.readArchivedAction(familyId, requestId);
          if (raw === null || raw === undefined) {
            await this.store.archiveAction(
              familyId,
              actionRecordFromOp(requestId, op),
              dayKey(op.at),
            );
          }
          confirmed.add(requestId);
        } catch (err) {
          this.audit.event("archive_confirm_failed", { requestId, error: String(err) });
        }
      }),
    );
    return confirmed;
  }

  private async archiveFromOp(familyId: FamilyId, requestId: string, raw: unknown) {
    const op = parseOpRecord(raw);
    if (op) await this.archive(familyId, actionRecordFromOp(requestId, op));
  }

  private async archive(familyId: FamilyId, record: ActionRecord): Promise<void> {
    try {
      await this.store.archiveAction(familyId, record, dayKey(record.committedAt));
    } catch (err) {
      this.audit.event("archive_failed", { requestId: record.requestId, error: String(err) });
    }
  }

  /**
   * Finn eller opprett varene. Nye varer får deterministisk id og skrives
   * kun hvis id-en er ledig; ligger det noe annet der (et senere omdøpt
   * vare med samme id — i praksis kun mulig etter 90 d), brukes en ny
   * tilfeldig id i stedet.
   */
  private async resolveAndCreateItems(
    familyId: FamilyId,
    requestId: string,
    inputs: readonly AddItemInput[],
  ) {
    const idFor = (name: string) => deterministicId(itemIdSeed(familyId, requestId, name));
    const items = await this.store.readItems(familyId);
    const { resolved } = resolveItems(items, inputs, idFor);
    for (const r of resolved) {
      if (r.vare.id === idFor(r.input.name)) r.newItemCreated = true;
      if (!r.newItemCreated) continue;
      const fields = { name: r.vare.name, cat: r.vare.cat };
      let stored = await this.store.createItemIfAbsent(familyId, r.vare.id, fields);
      if (normalizeItemName(stored.name) !== normalizeItemName(fields.name)) {
        const id = this.newId();
        stored = await this.store.createItemIfAbsent(familyId, id, fields);
        r.vare = { id, ...stored };
      } else {
        r.vare = { id: r.vare.id, ...stored };
      }
    }
    return resolved;
  }

  /** Tilbakelesing etter handling. Feiler den, er handlingen likevel utført — returner `null`, ikke feil. */
  private async readBack(ctx: FamilyContext) {
    try {
      const node = await this.store.readShoppingNode(ctx.familyId);
      return shoppingListView(parseShoppingEntries(node), false);
    } catch (err) {
      this.audit.event("read_back_failed", { error: String(err) });
      return null;
    }
  }
}

const conflictError = () =>
  new ToolError(
    "idempotency_conflict",
    "Denne requestId-en er allerede brukt til en annen forespørsel. Bruk en ny requestId.",
    false,
  );

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** UUID-formet (versjon 8) id avledet av sha256 — samme seed gir alltid samme id. */
export function deterministicId(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Stabil hash av den validerte payloaden — avgjør om en gjenbrukt requestId er "samme forespørsel". */
export function requestFingerprint(items: readonly AddItemInput[]): string {
  const canonical = items.map((i) => [i.name, i.amount ?? "", i.cat ?? ""]);
  return createHash("sha256")
    .update(JSON.stringify([TOOL, canonical]))
    .digest("hex");
}
