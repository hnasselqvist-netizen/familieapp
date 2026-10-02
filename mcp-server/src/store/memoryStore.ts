/**
 * In-memory implementasjon av store-porten — for enhets-, kontrakt- og
 * HTTP-ende-til-ende-tester uten emulator. Holder ett JSON-tre med RTDB-
 * semantikk (null sletter, tomme noder forsvinner, heltallsnøkler leses
 * som array etter RTDBs regel) og samme transaksjonsgaranti som Admin-
 * adapteren: compare-and-set på hele noden, updateren kjøres på nytt når
 * noden endret seg underveis. Pluss feilinjeksjon for krasj/retry-tester
 * og en krok for å simulere samtidige app-endringer midt i en transaksjon.
 */
import type { Vare } from "@app-types/vare";
import { withoutUndefined } from "./json";
import {
  actionDayEntryPath,
  actionPath,
  actionsByDayPath,
  itemPath,
  itemsPath,
  memberPath,
  shoppingOpsPath,
  shoppingPath,
} from "./paths";
import type {
  ActionRecord,
  FamilyId,
  HverdagsflytStore,
  PrincipalLink,
  ShoppingUpdater,
} from "./types";

/**
 * `before`: transaksjonen kaster UTEN å skrive noe (nettverksfeil før
 * serveren mottok skrivingen, eller prosessen dør).
 * `after`: transaksjonen skriver, og kaster DERETTER (svaret gikk tapt
 * på vei tilbake) — kalleren tror det feilet.
 */
export type CommitFault = "before" | "after";

type Tree = Record<string, unknown>;

const isObject = (v: unknown): v is Tree =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Lagringsform: arrays som objekter med indeksnøkler, uten null/tomme noder. */
function toStored(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return toStored(Object.fromEntries(value.map((v, i) => [String(i), v])));
  }
  if (!isObject(value)) return value;
  const out: Tree = {};
  for (const [k, v] of Object.entries(value)) {
    const stored = toStored(v);
    if (stored !== undefined) out[k] = stored;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** RTDBs leseregel: kun heltallsnøkler og over halvparten av 0..maks fylt → (sparsom) array. */
function toRtdbView(value: unknown): unknown {
  if (!isObject(value)) return value;
  const keys = Object.keys(value);
  const asArray = keys.every((k) => /^(0|[1-9]\d*)$/.test(k));
  const max = asArray ? Math.max(...keys.map(Number)) : -1;
  if (asArray && keys.length * 2 > max + 1) {
    // Sparsom array: manglende indekser er hull (ikke `null`), som i Admin SDK-et.
    const array: unknown[] = new Array(max + 1);
    for (const k of keys) array[Number(k)] = toRtdbView(value[k]);
    return array;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toRtdbView(v)]));
}

export class MemoryStore implements HverdagsflytStore {
  readonly principals = new Map<string, PrincipalLink>();
  private root: Tree = {};
  private transactFaults: CommitFault[] = [];
  private readShoppingFaults = 0;
  private archiveFaults = 0;
  /**
   * Kjøres etter at updateren har beregnet ny verdi, men FØR compare-and-
   * set — for å simulere en samtidig app-endring midt i transaksjonen.
   */
  onTransactionAttempt: ((attempt: number) => void) | null = null;
  /** Antall updater-kall i siste `transactShopping`. */
  lastTransactionAttempts = 0;

  // --- Treet (også brukt direkte av testene) -------------------------------

  get(path: string): unknown {
    let node: unknown = this.root;
    for (const part of path.split("/")) {
      if (!isObject(node)) return null;
      node = node[part];
    }
    return node === undefined ? null : toRtdbView(structuredClone(node));
  }

  set(path: string, value: unknown): void {
    const parts = path.split("/");
    const stored = toStored(structuredClone(value));
    const parents: Tree[] = [this.root];
    let node = this.root;
    for (const part of parts.slice(0, -1)) {
      if (!isObject(node[part])) node[part] = {};
      node = node[part] as Tree;
      parents.push(node);
    }
    const last = parts[parts.length - 1]!;
    if (stored === undefined) delete node[last];
    else node[last] = stored;
    // Tomme foreldre forsvinner, som i RTDB.
    for (let i = parts.length - 2; i >= 0; i--) {
      if (Object.keys(parents[i + 1]!).length === 0) delete parents[i]![parts[i]!];
    }
  }

  private raw(path: string): string {
    let node: unknown = this.root;
    for (const part of path.split("/")) node = isObject(node) ? node[part] : undefined;
    return JSON.stringify(node ?? null);
  }

  addMember(familyId: FamilyId, uid: string): void {
    this.set(memberPath(familyId, uid), true);
  }

  removeMember(familyId: FamilyId, uid: string): void {
    this.set(memberPath(familyId, uid), null);
  }

  // --- Feilinjeksjon --------------------------------------------------------

  failNextCommit(fault: CommitFault): void {
    this.transactFaults.push(fault);
  }

  failNextShoppingRead(): void {
    this.readShoppingFaults += 1;
  }

  failNextArchive(times = 1): void {
    this.archiveFaults += times;
  }

  // --- Porten ---------------------------------------------------------------

  async getPrincipalLink(idpSub: string): Promise<PrincipalLink | null> {
    const link = this.principals.get(idpSub);
    return link ? { ...link, disabled: link.disabled === true } : null;
  }

  async isFamilyMember(familyId: FamilyId, firebaseUid: string): Promise<boolean> {
    const value = this.get(memberPath(familyId, firebaseUid));
    return value !== null && value !== false;
  }

  async readShoppingNode(familyId: FamilyId): Promise<unknown> {
    if (this.readShoppingFaults > 0) {
      this.readShoppingFaults -= 1;
      throw new Error("Simulert lesefeil (handleliste)");
    }
    return this.get(shoppingPath(familyId));
  }

  async readShoppingOps(familyId: FamilyId): Promise<unknown> {
    return this.get(shoppingOpsPath(familyId));
  }

  async readItems(familyId: FamilyId): Promise<Vare[]> {
    const value = this.get(itemsPath(familyId));
    if (!isObject(value)) return [];
    return Object.entries(value).flatMap(([id, fields]) =>
      isObject(fields) && typeof fields.name === "string"
        ? [{ id, name: fields.name, cat: typeof fields.cat === "string" ? fields.cat : "Diverse" }]
        : [],
    );
  }

  async createItemIfAbsent(
    familyId: FamilyId,
    id: string,
    fields: Omit<Vare, "id">,
  ): Promise<Omit<Vare, "id">> {
    const path = itemPath(familyId, id);
    if (this.get(path) === null) this.set(path, withoutUndefined(fields));
    const stored = this.get(path) as Tree;
    return {
      name: typeof stored.name === "string" ? stored.name : fields.name,
      cat: typeof stored.cat === "string" ? stored.cat : "Diverse",
    };
  }

  async transactShopping(
    familyId: FamilyId,
    updater: ShoppingUpdater,
  ): Promise<{ committed: boolean }> {
    const path = shoppingPath(familyId);
    this.lastTransactionAttempts = 0;
    for (let attempt = 1; attempt <= 25; attempt++) {
      this.lastTransactionAttempts = attempt;
      const before = this.raw(path);
      const next = updater(this.get(path));
      this.onTransactionAttempt?.(attempt);
      if (this.raw(path) !== before) continue; // compare-and-set feilet → kjør på nytt
      if (next === undefined) return { committed: false };
      const fault = this.transactFaults.shift();
      if (fault === "before") throw new Error("Simulert feil før commit");
      this.set(path, withoutUndefined(next as object));
      if (fault === "after") throw new Error("Simulert tapt svar etter commit");
      return { committed: true };
    }
    throw new Error("maxretry: transaksjonen ga opp");
  }

  async readArchivedAction(familyId: FamilyId, requestId: string): Promise<unknown> {
    return this.get(actionPath(familyId, requestId));
  }

  async archiveAction(familyId: FamilyId, record: ActionRecord, day: string): Promise<void> {
    if (this.archiveFaults > 0) {
      this.archiveFaults -= 1;
      throw new Error("Simulert arkiveringsfeil");
    }
    this.set(actionPath(familyId, record.requestId), withoutUndefined(record));
    this.set(actionDayEntryPath(familyId, day, record.requestId), true);
  }

  async pruneArchivedActions(familyId: FamilyId, lastDay: string, maxDays: number) {
    const byDay = this.get(actionsByDayPath(familyId));
    if (!isObject(byDay)) return 0;
    let removed = 0;
    for (const day of Object.keys(byDay)
      .filter((d) => d <= lastDay)
      .sort()
      .slice(0, maxDays)) {
      for (const key of Object.keys(byDay[day] as Tree)) {
        this.set(`mcp/actions/${familyId}/${key}`, null);
        removed += 1;
      }
      this.set(`${actionsByDayPath(familyId)}/${day}`, null);
    }
    return removed;
  }
}
