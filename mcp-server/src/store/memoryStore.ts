/**
 * In-memory implementasjon av store-porten — for enhets-, kontrakt- og
 * HTTP-ende-til-ende-tester uten emulator. Holder samme form som RTDB-
 * treet og samme atomisitetsgaranti som Admin-adapteren (commit skrives
 * alt-eller-ingenting), pluss feilinjeksjon for krasj/retry-tester.
 */
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import { interpretClaim, nextClaimState } from "./actionRecord";
import type {
  ActionRecord,
  ClaimRequest,
  ClaimResult,
  CommitRequest,
  FamilyId,
  HverdagsflytStore,
  PrincipalLink,
} from "./types";

interface FamilyState {
  members: Set<string>;
  shopping: Map<string, ShoppingListEntry>;
  items: Map<string, Omit<Vare, "id">>;
  actions: Map<string, ActionRecord>;
}

/**
 * `before`: commit kaster UTEN å skrive noe (f.eks. nettverksfeil før
 * serveren mottok skrivingen, eller prosessen dør).
 * `after`: commit skriver HELE planen + markøren atomisk, og kaster DERETTER
 * (f.eks. svaret gikk tapt på vei tilbake) — kalleren tror det feilet.
 */
export type CommitFault = "before" | "after";

export class MemoryStore implements HverdagsflytStore {
  readonly principals = new Map<string, PrincipalLink>();
  private readonly families = new Map<FamilyId, FamilyState>();
  private commitFaults: CommitFault[] = [];
  private readShoppingFaults = 0;
  /** Kjøres rett før en commit — for å simulere samtidige endringer fra appen. */
  beforeCommit: (() => void) | null = null;

  family(familyId: FamilyId): FamilyState {
    let state = this.families.get(familyId);
    if (!state) {
      state = { members: new Set(), shopping: new Map(), items: new Map(), actions: new Map() };
      this.families.set(familyId, state);
    }
    return state;
  }

  failNextCommit(fault: CommitFault): void {
    this.commitFaults.push(fault);
  }

  failNextShoppingRead(): void {
    this.readShoppingFaults += 1;
  }

  async getPrincipalLink(idpSub: string): Promise<PrincipalLink | null> {
    const link = this.principals.get(idpSub);
    return link ? { ...link, disabled: link.disabled === true } : null;
  }

  async isFamilyMember(familyId: FamilyId, firebaseUid: string): Promise<boolean> {
    return this.families.get(familyId)?.members.has(firebaseUid) ?? false;
  }

  async readShoppingList(familyId: FamilyId): Promise<ShoppingItem[]> {
    if (this.readShoppingFaults > 0) {
      this.readShoppingFaults -= 1;
      throw new Error("Simulert lesefeil (handleliste)");
    }
    return [...this.family(familyId).shopping].map(([id, e]) => ({ id, ...structuredClone(e) }));
  }

  async readItems(familyId: FamilyId): Promise<Vare[]> {
    return [...this.family(familyId).items].map(([id, v]) => ({ id, ...v }));
  }

  async claimAction(familyId: FamilyId, claim: ClaimRequest): Promise<ClaimResult> {
    const actions = this.family(familyId).actions;
    const next = nextClaimState(actions.get(claim.requestId) ?? null, claim);
    if (next) actions.set(claim.requestId, next);
    return interpretClaim(actions.get(claim.requestId) ?? null, claim);
  }

  async commitAction(familyId: FamilyId, commit: CommitRequest): Promise<void> {
    this.beforeCommit?.();
    const fault = this.commitFaults.shift();
    if (fault === "before") throw new Error("Simulert feil før commit");

    const state = this.family(familyId);
    for (const { id, fields } of commit.plan.newItems) state.items.set(id, { ...fields });
    for (const { id, entry } of commit.plan.newEntries) state.shopping.set(id, { ...entry });
    for (const { id, entry } of commit.plan.updatedEntries) state.shopping.set(id, { ...entry });
    state.actions.set(commit.requestId, structuredClone(commit.record));

    if (fault === "after") throw new Error("Simulert tapt svar etter commit");
  }

  async releaseAction(familyId: FamilyId, requestId: string, claimToken: string): Promise<void> {
    const actions = this.family(familyId).actions;
    const current = actions.get(requestId);
    if (current?.status === "pending" && current.claimToken === claimToken) {
      actions.delete(requestId);
    }
  }

  async readAction(familyId: FamilyId, requestId: string): Promise<ActionRecord | null> {
    const record = this.family(familyId).actions.get(requestId);
    return record ? structuredClone(record) : null;
  }
}
