/**
 * Firebase Admin SDK-adapter for store-porten (variant A i auth-designet,
 * Issue #27 kommentar 5936936743). ENESTE fil (utenom `main.ts`) som får
 * importere `firebase-admin` (§eslint.config.js).
 *
 * Admin SDK-et omgår security rules — autorisasjonen (kobling +
 * medlemskap per kall) gjøres derfor eksplisitt i `auth/authorize.ts`
 * FØR noen av metodene under kalles for en familie.
 *
 * Ren I/O: rå verdier inn og ut. All tolkning bor i `handleliste/shoppingNode.ts`.
 *
 * I denne foundation-PR-en kjøres adapteren KUN mot RTDB-emulatoren
 * (`*.integration.test.ts`). Ingen ekte credentialing, ingen prod-skriving.
 */
import type { Database } from "firebase-admin/database";
import type { Vare } from "@app-types/vare";
import { FORSONINGSNODER, type RaaForsoningsnoder } from "../forvaltning/cutoverKontroll";
import { withoutUndefined } from "./json";
import {
  actionDayEntryPath,
  actionPath,
  actionsByDayPath,
  forsoningsnodePath,
  itemPath,
  itemsPath,
  memberPath,
  principalPath,
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

export class FirebaseAdminStore implements HverdagsflytStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getPrincipalLink(idpSub: string): Promise<PrincipalLink | null> {
    const snap = await this.db.ref(principalPath(idpSub)).get();
    if (!snap.exists()) return null;
    const raw = snap.val() as Record<string, unknown>;
    if (typeof raw.firebaseUid !== "string" || typeof raw.familyId !== "string") return null;
    return {
      firebaseUid: raw.firebaseUid,
      familyId: raw.familyId,
      disabled: raw.disabled === true,
    };
  }

  async isFamilyMember(familyId: FamilyId, firebaseUid: string): Promise<boolean> {
    const snap = await this.db.ref(memberPath(familyId, firebaseUid)).get();
    return snap.exists() && snap.val() !== false;
  }

  async readShoppingNode(familyId: FamilyId): Promise<unknown> {
    return (await this.db.ref(shoppingPath(familyId)).get()).val();
  }

  async readShoppingOps(familyId: FamilyId): Promise<unknown> {
    return (await this.db.ref(shoppingOpsPath(familyId)).get()).val();
  }

  async readItems(familyId: FamilyId): Promise<Vare[]> {
    const snap = await this.db.ref(itemsPath(familyId)).get();
    if (!snap.exists()) return [];
    const value = snap.val() as Record<string, Record<string, unknown>>;
    return Object.entries(value).flatMap(([id, fields]) =>
      fields && typeof fields.name === "string"
        ? [{ id, name: fields.name, cat: typeof fields.cat === "string" ? fields.cat : "Diverse" }]
        : [],
    );
  }

  /** Fire uavhengige `get()` — ren lesing, som Admin SDK-et gjør med viewer-rollen. */
  async readForsoningsnoder(familyId: FamilyId): Promise<RaaForsoningsnoder> {
    const verdier = await Promise.all(
      FORSONINGSNODER.map(async (n) =>
        (await this.db.ref(forsoningsnodePath(familyId, n)).get()).val(),
      ),
    );
    return Object.fromEntries(
      FORSONINGSNODER.map((n, i) => [n, verdier[i] as unknown]),
    ) as RaaForsoningsnoder;
  }

  /**
   * Transaksjon på `items/{id}`: for `null` returneres en KONKRET verdi
   * (aldri `undefined`), så et spekulativt første kall mot kald cache
   * sammenlignes mot — og om nødvendig kjøres på nytt mot — serververdien
   * (samme lærdom som appens `toggleShoppingItemDone`). Finnes noden,
   * avbrytes transaksjonen og den eksisterende verdien returneres.
   */
  async createItemIfAbsent(
    familyId: FamilyId,
    id: string,
    fields: Omit<Vare, "id">,
  ): Promise<Omit<Vare, "id">> {
    const result = await this.db
      .ref(itemPath(familyId, id))
      .transaction(
        (current: unknown) => (current === null ? withoutUndefined(fields) : undefined),
        undefined,
        false,
      );
    const stored = result.snapshot.val() as Record<string, unknown> | null;
    return {
      name: typeof stored?.name === "string" ? stored.name : fields.name,
      cat: typeof stored?.cat === "string" ? stored.cat : "Diverse",
    };
  }

  /**
   * ÉN RTDB-transaksjon på `families/{f}/shopping`. RTDB kjører updateren
   * på nytt mot ferskeste serververdi hver gang den lokale gjetningen var
   * feil (compare-and-set på hele noden). `applyLocally=false`: ingen
   * mellomliggende lokale hendelser. Updateren returnerer en konkret verdi
   * for `null`/ukjent node; `undefined` (avbryt) kun ved replay/konflikt,
   * som er basert på en faktisk sett `_ops`-record.
   */
  async transactShopping(
    familyId: FamilyId,
    updater: ShoppingUpdater,
  ): Promise<{ committed: boolean }> {
    const result = await this.db.ref(shoppingPath(familyId)).transaction(
      (current: unknown) => {
        const next = updater(current);
        return next === undefined ? undefined : withoutUndefined(next as object);
      },
      undefined,
      false,
    );
    return { committed: result.committed };
  }

  async readArchivedAction(familyId: FamilyId, requestId: string): Promise<unknown> {
    return (await this.db.ref(actionPath(familyId, requestId)).get()).val();
  }

  /** Én multi-path `update()`: recorden og dens dagsindeks, alt-eller-ingenting. */
  async archiveAction(familyId: FamilyId, record: ActionRecord, day: string): Promise<void> {
    await this.db.ref().update({
      [actionPath(familyId, record.requestId)]: withoutUndefined(record),
      [actionDayEntryPath(familyId, day, record.requestId)]: true,
    });
  }

  /**
   * Dagsbøttene er nøkkelordnet (`YYYY-MM-DD`), så `orderByKey` + `endAt`
   * finner de eldste uten noen `.indexOn`-regel.
   */
  async pruneArchivedActions(familyId: FamilyId, lastDay: string, maxDays: number) {
    const snap = await this.db
      .ref(actionsByDayPath(familyId))
      .orderByKey()
      .endAt(lastDay)
      .limitToFirst(maxDays)
      .get();
    if (!snap.exists()) return 0;
    const updates: Record<string, null> = {};
    let removed = 0;
    for (const [day, entries] of Object.entries(snap.val() as Record<string, object>)) {
      for (const key of Object.keys(entries)) {
        updates[`mcp/actions/${familyId}/${key}`] = null;
        removed += 1;
      }
      updates[`${actionsByDayPath(familyId)}/${day}`] = null;
    }
    await this.db.ref().update(updates);
    return removed;
  }
}
