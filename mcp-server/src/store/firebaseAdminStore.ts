/**
 * Firebase Admin SDK-adapter for store-porten (variant A i auth-designet,
 * Issue #27 kommentar 5936936743). ENESTE fil (utenom `main.ts`) som får
 * importere `firebase-admin` (§eslint.config.js).
 *
 * Admin SDK-et omgår security rules — autorisasjonen (kobling +
 * medlemskap per kall) gjøres derfor eksplisitt i `auth/authorize.ts`
 * FØR noen av metodene under kalles for en familie.
 *
 * I denne foundation-PR-en kjøres adapteren KUN mot RTDB-emulatoren
 * (`*.integration.test.ts`). Ingen ekte credentialing, ingen prod-skriving.
 */
import type { Database } from "firebase-admin/database";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import {
  interpretClaim,
  nextClaimState,
  parseActionRecord,
  withoutUndefined,
} from "./actionRecord";
import {
  actionPath,
  itemPath,
  itemsPath,
  memberPath,
  principalPath,
  shoppingEntryPath,
  shoppingPath,
} from "./paths";
import type {
  ActionRecord,
  ClaimRequest,
  ClaimResult,
  CommitRequest,
  FamilyId,
  HverdagsflytStore,
  PrincipalLink,
} from "./types";

/**
 * Port 1:1 av `parseShoppingListEntry` i `web/src/data/shopping.repository.ts`
 * (kan ikke importeres — den bor i appens klient-SDK-datalag). Én bevisst
 * tilleggsregel: en post uten streng-`name` hoppes over i stedet for å
 * krasje dedup-matchen (`name.toLowerCase()`) for hele listen.
 */
function parseShoppingListEntry(raw: Record<string, unknown>): ShoppingListEntry | null {
  if (typeof raw.name !== "string") return null;
  return {
    itemId: (raw.itemId as string | null | undefined) ?? null,
    name: raw.name,
    amount: (raw.amount as string | undefined) ?? "",
    cat: (raw.cat as string | undefined) ?? "Diverse",
    done: (raw.done as boolean | undefined) ?? false,
  };
}

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

  async readShoppingList(familyId: FamilyId): Promise<ShoppingItem[]> {
    const snap = await this.db.ref(shoppingPath(familyId)).get();
    if (!snap.exists()) return [];
    const value = snap.val() as Record<string, Record<string, unknown>>;
    return Object.entries(value).flatMap(([id, fields]) => {
      const entry = fields && typeof fields === "object" ? parseShoppingListEntry(fields) : null;
      return entry ? [{ id, ...entry }] : [];
    });
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

  /**
   * RTDB-transaksjon på action-noden. Updateren returnerer en KONKRET
   * verdi for `null` (aldri `undefined`), slik at et spekulativt første
   * kall mot kald cache sammenlignes mot — og om nødvendig kjøres på nytt
   * mot — ferskeste serververdi (samme lærdom som appens
   * `toggleShoppingItemDone`). `undefined` (avbryt) returneres kun når en
   * faktisk eksisterende record er sett.
   */
  async claimAction(familyId: FamilyId, claim: ClaimRequest): Promise<ClaimResult> {
    const result = await this.db.ref(actionPath(familyId, claim.requestId)).transaction(
      (raw: unknown) => {
        const next = nextClaimState(parseActionRecord(raw), claim);
        return next ? withoutUndefined(next) : undefined;
      },
      undefined,
      false,
    );
    return interpretClaim(parseActionRecord(result.snapshot.val()), claim);
  }

  /**
   * ÉN multi-path `update()` på roten: alle nye varer, nye/oppdaterte
   * handlelisteposter OG den committede action-recorden. RTDB garanterer
   * at en multi-path-oppdatering er atomisk — enten lykkes alle stiene,
   * eller ingen (§"Update specific fields", Firebase-dokumentasjonen).
   */
  async commitAction(familyId: FamilyId, commit: CommitRequest): Promise<void> {
    const updates: Record<string, unknown> = {};
    for (const { id, fields } of commit.plan.newItems) {
      updates[itemPath(familyId, id)] = withoutUndefined(fields);
    }
    for (const { id, entry } of [...commit.plan.newEntries, ...commit.plan.updatedEntries]) {
      updates[shoppingEntryPath(familyId, id)] = withoutUndefined(entry);
    }
    updates[actionPath(familyId, commit.requestId)] = withoutUndefined(commit.record);
    await this.db.ref().update(updates);
  }

  async releaseAction(familyId: FamilyId, requestId: string, claimToken: string): Promise<void> {
    await this.db.ref(actionPath(familyId, requestId)).transaction(
      (raw: unknown) => {
        if (raw === null) return null;
        const current = parseActionRecord(raw);
        return current?.status === "pending" && current.claimToken === claimToken
          ? null
          : undefined;
      },
      undefined,
      false,
    );
  }

  async readAction(familyId: FamilyId, requestId: string): Promise<ActionRecord | null> {
    const snap = await this.db.ref(actionPath(familyId, requestId)).get();
    return parseActionRecord(snap.val());
  }
}
