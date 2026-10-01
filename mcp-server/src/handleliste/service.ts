/**
 * Handleliste-tjenesten: les, søk, legg til — transport-uavhengig (kjenner
 * kun store-porten). Autorisasjonen er allerede gjort (`FamilyContext`).
 *
 * ## Idempotens (Issue #27, 5937138669 pkt. 4)
 *
 * Mengdesummering er ikke idempotent i seg selv, så `requestId` bærer
 * idempotensen:
 *
 *  1. **Claim** — atomisk lease på `mcp/actions/{f}/{requestId}`. Kun én
 *     samtidig kaller vinner. Finnes en COMMITTET record med samme
 *     fingerprint → replay (lagret resultat returneres, ingenting skrives).
 *  2. **Plan** — fersk lesing av liste + varebase, ren planlegging.
 *  3. **Commit** — HELE endringen OG den committede recorden i ÉN atomisk
 *     RTDB multi-path-oppdatering. Det finnes derfor ingen tilstand der
 *     endringen er skrevet, men markøren mangler (eller omvendt).
 *
 * Krasj/retry-matrisen (dekket av `service.test.ts`):
 *  - feil FØR commit → ingenting skrevet; leasen frigis best-effort (eller
 *    utløper), og retry med samme requestId utfører handlingen ÉN gang;
 *  - feil ETTER commit (tapt svar) → retry ser den committede recorden og
 *    returnerer replay — ingen dobbel summering;
 *  - to samtidige kall med samme requestId → ett utfører, det andre får
 *    `request_in_progress` (retryable) og deretter replay.
 *
 * Leasen er lengre enn tjenestens egen commit-frist (`commitDeadlineMs`):
 * en kaller som har passert fristen committer ALDRI, så en ny eier som
 * overtar en utløpt lease kan ikke kollidere med en treg forrige eier.
 *
 * ## Audit (pkt. 5)
 *
 * Den committede action-recorden ER den transaksjonelle audit-posten for
 * skrivinger (hvem: idpSub/firebaseUid/clientId, hva: fingerprint + utfall
 * per vare, når: committedAt) — skrevet i samme atomiske operasjon som
 * endringen, så audit kan aldri gjøre en vellykket skriving om til en
 * tilsynelatende feil. Alt annet (lesinger, avslag) logges best-effort via
 * `AuditLog`, som aldri kaster.
 */
import { createHash, randomUUID } from "node:crypto";
import type { FamilyContext } from "../auth/authorize";
import type { AddItemOutcome, HverdagsflytStore } from "../store/types";
import { ToolError } from "./errors";
import { findDuplicateNames, isEmptyPlan, planAddItems } from "./plan";
import type { AddItemInput } from "./schemas";
import { LIMITS } from "./schemas";
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
  /** Hvor lenge en claim holdes før en annen kaller kan overta. */
  leaseMs?: number;
  /** Seneste tidspunkt (etter claim) tjenesten selv tillater commit. Må være < leaseMs. */
  commitDeadlineMs?: number;
  audit?: AuditLog;
}

export interface AddItemsResult {
  requestId: string;
  replayed: boolean;
  results: AddItemOutcome[];
  list: ReturnType<typeof shoppingListView> | null;
}

const TOOL = "shopping_list_add_items" as const;

export class HandlelisteService {
  private readonly clock: () => number;
  private readonly newId: () => string;
  private readonly leaseMs: number;
  private readonly commitDeadlineMs: number;
  private readonly audit: AuditLog;

  private readonly store: HverdagsflytStore;

  constructor(store: HverdagsflytStore, options: ServiceOptions = {}) {
    this.store = store;
    this.clock = options.clock ?? Date.now;
    this.newId = options.newId ?? randomUUID;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.commitDeadlineMs = options.commitDeadlineMs ?? 20_000;
    this.audit = safeAudit(options.audit);
    if (this.commitDeadlineMs >= this.leaseMs) {
      throw new Error("commitDeadlineMs må være kortere enn leaseMs");
    }
  }

  async getShoppingList(ctx: FamilyContext, input: { includeDone?: boolean }) {
    const list = await this.store.readShoppingList(ctx.familyId);
    return shoppingListView(list, input.includeDone ?? false);
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

    const fingerprint = requestFingerprint(input.items);
    const claimToken = this.newId();
    const claimedAt = this.clock();
    const claim = await this.store.claimAction(ctx.familyId, {
      requestId: input.requestId,
      tool: TOOL,
      fingerprint,
      idpSub: ctx.idpSub,
      firebaseUid: ctx.firebaseUid,
      clientId: ctx.clientId,
      claimToken,
      now: claimedAt,
      leaseMs: this.leaseMs,
    });

    switch (claim.kind) {
      case "committed":
        this.audit.event("action_replayed", { requestId: input.requestId, tool: TOOL });
        return {
          requestId: input.requestId,
          replayed: true,
          results: claim.record.result,
          list: await this.readBack(ctx),
        };
      case "conflict":
        throw new ToolError(
          "idempotency_conflict",
          "Denne requestId-en er allerede brukt til en annen forespørsel. Bruk en ny requestId.",
          false,
        );
      case "in_progress":
        throw new ToolError(
          "request_in_progress",
          "Den samme forespørselen behandles allerede. Prøv igjen om litt med samme requestId.",
          true,
        );
      case "claimed":
        break;
    }

    let committed = false;
    try {
      const [shopping, items] = await Promise.all([
        this.store.readShoppingList(ctx.familyId),
        this.store.readItems(ctx.familyId),
      ]);
      const { plan, results } = planAddItems(shopping, items, input.items, this.newId);

      if (this.clock() > claimedAt + this.commitDeadlineMs) {
        throw new ToolError(
          "deadline_exceeded",
          "Forespørselen tok for lang tid og ble ikke utført. Prøv igjen med samme requestId.",
          true,
        );
      }

      const committedAt = this.clock();
      await this.store.commitAction(ctx.familyId, {
        requestId: input.requestId,
        claimToken,
        plan,
        record: {
          status: "committed",
          requestId: input.requestId,
          tool: TOOL,
          fingerprint,
          idpSub: ctx.idpSub,
          firebaseUid: ctx.firebaseUid,
          clientId: ctx.clientId,
          createdAt: claimedAt,
          committedAt,
          result: results,
        },
      });
      committed = true;
      this.audit.event("action_committed", {
        requestId: input.requestId,
        tool: TOOL,
        noop: isEmptyPlan(plan),
        outcomes: results.map((r) => r.outcome),
      });
      return {
        requestId: input.requestId,
        replayed: false,
        results,
        list: await this.readBack(ctx),
      };
    } finally {
      if (!committed) {
        // Best-effort: releaseAction er en no-op hvis commit faktisk gikk
        // gjennom (recorden er da `committed`, ikke vår `pending`).
        await this.store
          .releaseAction(ctx.familyId, input.requestId, claimToken)
          .catch(() => undefined);
      }
    }
  }

  /** Tilbakelesing etter handling. Feiler den, er handlingen likevel utført — returner `null`, ikke feil. */
  private async readBack(ctx: FamilyContext) {
    try {
      return shoppingListView(await this.store.readShoppingList(ctx.familyId), false);
    } catch (err) {
      this.audit.event("read_back_failed", { error: String(err) });
      return null;
    }
  }
}

/** Stabil hash av den validerte payloaden — avgjør om en gjenbrukt requestId er "samme forespørsel". */
export function requestFingerprint(items: readonly AddItemInput[]): string {
  const canonical = items.map((i) => [i.name, i.amount ?? "", i.cat ?? ""]);
  return createHash("sha256")
    .update(JSON.stringify([TOOL, canonical]))
    .digest("hex");
}
