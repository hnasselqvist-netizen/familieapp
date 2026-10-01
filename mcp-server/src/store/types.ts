/**
 * Store-PORTEN — alt MCP-serveren trenger fra Hverdagsflyts datalag, og
 * ingenting mer. Tjenestelogikken (`handleliste/`) kjenner kun denne
 * kontrakten; Firebase Admin-adapteren (`firebaseAdminStore.ts`) og
 * in-memory-faken (`memoryStore.ts`) implementerer den og kjøres mot den
 * SAMME kontrakttesten (`storeContract.ts`).
 *
 * Firebase-shape er UENDRET: handlelisten (`families/{f}/shopping/{id}`)
 * og varebasen (`families/{f}/items/{id}`) skrives i nøyaktig samme form
 * som appen. Kun to nye noder, begge UTENFOR `families/`:
 *
 *  - `mcp/principals/{idpSubKey}` — eksplisitt IdP-sub → Firebase-bruker-
 *    kobling (aldri e-postbasert). Opprettes manuelt, ikke av serveren.
 *  - `mcp/actions/{familyId}/{requestId}` — idempotens-markør OG
 *    transaksjonell audit for skrivende verktøykall.
 *
 * Bevisst utenfor `families/`: dagens security rules
 * (`infra/firebase/database.rules.json`) gir kun lese-/skrivetilgang under
 * `families/{familyId}` til medlemmer, så en klient (appen) kan verken lese
 * eller endre koblinger/markører — kun Admin SDK-et (som omgår reglene).
 * Ingen regelendring trengs.
 */
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";

export type FamilyId = string;

/** `mcp/principals/{idpSubKey}` — v1: én familie per kobling (multi-family-seamen bevares). */
export interface PrincipalLink {
  firebaseUid: string;
  familyId: FamilyId;
  /** Satt for å trekke tilbake tilgang uten å slette koblingen (audit-spor). */
  disabled?: boolean;
}

/** Utfallet per vare i `shopping_list_add_items` — også lagret i action-recorden. */
export interface AddItemOutcome {
  /** Navnet slik det ble sendt inn (trimmet). */
  inputName: string;
  outcome: "added" | "merged" | "already_on_list";
  entryId: string;
  itemId: string;
  /** Navnet posten faktisk har på listen (varebasens kanoniske navn). */
  name: string;
  /** Mengden etter handlingen. */
  amount: string;
  /** Kun for `merged`: mengden før sammenslåing. */
  previousAmount?: string;
  cat: string;
  newItemCreated: boolean;
}

export type ActionTool = "shopping_list_add_items";

interface ActionRecordBase {
  requestId: string;
  tool: ActionTool;
  fingerprint: string;
  idpSub: string;
  firebaseUid: string;
  clientId: string;
  createdAt: number;
}

export type ActionRecord =
  | (ActionRecordBase & { status: "pending"; claimToken: string; leaseUntil: number })
  | (ActionRecordBase & { status: "committed"; committedAt: number; result: AddItemOutcome[] });

export interface ClaimRequest {
  requestId: string;
  tool: ActionTool;
  fingerprint: string;
  idpSub: string;
  firebaseUid: string;
  clientId: string;
  claimToken: string;
  now: number;
  leaseMs: number;
}

export type ClaimResult =
  | { kind: "claimed"; leaseUntil: number }
  | { kind: "committed"; record: Extract<ActionRecord, { status: "committed" }> }
  | { kind: "in_progress"; leaseUntil: number }
  /** Samme requestId, men annen payload eller annen principal. */
  | { kind: "conflict" };

/**
 * Det komplette settet endringer ett `shopping_list_add_items`-kall gjør.
 * Hele poster/varer (ikke enkeltfelt) — samme skriveform som appens egen
 * `addBatchToShoppingList`-transaksjon (`{...parsed, amount}`), slik at en
 * post aldri kan bli stående som et ufullstendig `{amount}`-fragment.
 */
export interface WritePlan {
  newItems: { id: string; fields: Omit<Vare, "id"> }[];
  newEntries: { id: string; entry: ShoppingListEntry }[];
  updatedEntries: { id: string; entry: ShoppingListEntry }[];
}

export interface CommitRequest {
  requestId: string;
  claimToken: string;
  plan: WritePlan;
  record: Extract<ActionRecord, { status: "committed" }>;
}

export interface HverdagsflytStore {
  getPrincipalLink(idpSub: string): Promise<PrincipalLink | null>;
  isFamilyMember(familyId: FamilyId, firebaseUid: string): Promise<boolean>;
  readShoppingList(familyId: FamilyId): Promise<ShoppingItem[]>;
  readItems(familyId: FamilyId): Promise<Vare[]>;

  /**
   * Tar (eller overtar en utløpt) lease på `requestId` atomisk. Kun ÉN
   * samtidig kaller kan få `claimed` for samme requestId.
   */
  claimAction(familyId: FamilyId, claim: ClaimRequest): Promise<ClaimResult>;

  /**
   * Skriver HELE `plan` OG den committede action-recorden i ÉN atomisk
   * operasjon — enten alt eller ingenting. Det er dette som gjør at en
   * krasj/retry aldri kan etterlate endringen uten idempotens-markøren
   * (eller omvendt).
   */
  commitAction(familyId: FamilyId, commit: CommitRequest): Promise<void>;

  /**
   * Best-effort: frigir en `pending` lease som fortsatt eies av
   * `claimToken`, slik at en umiddelbar retry etter en kontrollert feil
   * ikke må vente på lease-utløp. No-op for en committet record.
   */
  releaseAction(familyId: FamilyId, requestId: string, claimToken: string): Promise<void>;

  readAction(familyId: FamilyId, requestId: string): Promise<ActionRecord | null>;
}
