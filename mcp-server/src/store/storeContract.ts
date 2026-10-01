/**
 * Felles kontrakttest for store-porten. Kjøres mot in-memory-faken
 * (`memoryStore.test.ts`, alltid) og mot Firebase Admin-adapteren på
 * RTDB-emulatoren (`firebaseAdminStore.integration.test.ts`) — slik at
 * faken som de raske testene bygger på bevislig oppfører seg som den ekte
 * adapteren.
 */
import { describe, expect, it } from "vitest";
import type { ShoppingListEntry } from "@app-types/shopping";
import type {
  ActionRecord,
  ClaimRequest,
  FamilyId,
  HverdagsflytStore,
  PrincipalLink,
} from "./types";

export interface Seeder {
  member(familyId: FamilyId, uid: string): Promise<void>;
  principal(idpSub: string, link: PrincipalLink): Promise<void>;
  shoppingRaw(familyId: FamilyId, id: string, raw: Record<string, unknown>): Promise<void>;
  item(familyId: FamilyId, id: string, fields: { name: string; cat: string }): Promise<void>;
}

export interface ContractHarness {
  store: HverdagsflytStore;
  seed: Seeder;
  /** Unik familie per test, så testene ikke deler tilstand. */
  newFamilyId(): FamilyId;
}

const entry = (overrides: Partial<ShoppingListEntry> = {}): ShoppingListEntry => ({
  itemId: "v1",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
  ...overrides,
});

const claim = (overrides: Partial<ClaimRequest> = {}): ClaimRequest => ({
  requestId: "11111111-1111-4111-8111-111111111111",
  tool: "shopping_list_add_items",
  fingerprint: "fp-1",
  idpSub: "google-oauth2|123",
  firebaseUid: "uid-1",
  clientId: "client-1",
  claimToken: "token-a",
  now: 1_000_000,
  leaseMs: 60_000,
  ...overrides,
});

const committedRecord = (c: ClaimRequest): Extract<ActionRecord, { status: "committed" }> => ({
  status: "committed",
  requestId: c.requestId,
  tool: c.tool,
  fingerprint: c.fingerprint,
  idpSub: c.idpSub,
  firebaseUid: c.firebaseUid,
  clientId: c.clientId,
  createdAt: c.now,
  committedAt: c.now + 5,
  result: [
    {
      inputName: "melk",
      outcome: "added",
      entryId: "e-new",
      itemId: "v-new",
      name: "Melk",
      amount: "",
      cat: "Ost og meieri",
      newItemCreated: true,
    },
  ],
});

export function runStoreContract(name: string, setup: () => ContractHarness): void {
  describe(`store-kontrakt: ${name}`, () => {
    it("leser en eksplisitt principal-kobling (også sub med `|` og `.`), ellers null", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.seed.principal("google-oauth2|123.x", { firebaseUid: "uid-1", familyId });
      expect(await h.store.getPrincipalLink("google-oauth2|123.x")).toEqual({
        firebaseUid: "uid-1",
        familyId,
        disabled: false,
      });
      expect(await h.store.getPrincipalLink("google-oauth2|999")).toBeNull();
    });

    it("sjekker medlemskap", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.seed.member(familyId, "uid-1");
      expect(await h.store.isFamilyMember(familyId, "uid-1")).toBe(true);
      expect(await h.store.isFamilyMember(familyId, "uid-2")).toBe(false);
    });

    it("leser handlelisten med appens standardverdier og hopper over poster uten navn", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.seed.shoppingRaw(familyId, "a", { name: "Melk" });
      await h.seed.shoppingRaw(familyId, "b", { amount: "2" });
      expect(await h.store.readShoppingList(familyId)).toEqual([
        { id: "a", itemId: null, name: "Melk", amount: "", cat: "Diverse", done: false },
      ]);
    });

    it("claim: første kaller får leasen; samme forespørsel under aktiv lease → in_progress", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      expect(await h.store.claimAction(familyId, claim())).toEqual({
        kind: "claimed",
        leaseUntil: 1_060_000,
      });
      expect(
        await h.store.claimAction(familyId, claim({ claimToken: "token-b", now: 1_030_000 })),
      ).toEqual({ kind: "in_progress", leaseUntil: 1_060_000 });
    });

    it("claim: annen payload eller annen principal med samme requestId → conflict", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.store.claimAction(familyId, claim());
      expect(
        await h.store.claimAction(familyId, claim({ fingerprint: "fp-2", claimToken: "b" })),
      ).toEqual({ kind: "conflict" });
      expect(
        await h.store.claimAction(familyId, claim({ idpSub: "auth0|other", claimToken: "b" })),
      ).toEqual({ kind: "conflict" });
    });

    it("claim: en utløpt lease kan overtas av samme forespørsel", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.store.claimAction(familyId, claim());
      const takeover = claim({ claimToken: "token-b", now: 1_060_001 });
      expect(await h.store.claimAction(familyId, takeover)).toEqual({
        kind: "claimed",
        leaseUntil: 1_120_001,
      });
      const record = await h.store.readAction(familyId, takeover.requestId);
      expect(record).toMatchObject({
        status: "pending",
        claimToken: "token-b",
        createdAt: 1_000_000,
      });
    });

    it("commit skriver varer, poster og committet record samlet; påfølgende claim → committed", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.seed.shoppingRaw(familyId, "old", { ...entry(), extra: "fjernes som i appen" });
      const c = claim();
      await h.store.claimAction(familyId, c);
      await h.store.commitAction(familyId, {
        requestId: c.requestId,
        claimToken: c.claimToken,
        plan: {
          newItems: [{ id: "v-new", fields: { name: "Kanel", cat: "Tørrvarer" } }],
          newEntries: [
            { id: "e-new", entry: entry({ itemId: "v-new", name: "Kanel", amount: "" }) },
          ],
          updatedEntries: [{ id: "old", entry: entry({ amount: "5" }) }],
        },
        record: committedRecord(c),
      });

      expect(await h.store.readItems(familyId)).toEqual([
        { id: "v-new", name: "Kanel", cat: "Tørrvarer" },
      ]);
      const list = await h.store.readShoppingList(familyId);
      expect(list).toEqual(
        expect.arrayContaining([
          { id: "old", ...entry({ amount: "5" }) },
          { id: "e-new", ...entry({ itemId: "v-new", name: "Kanel", amount: "" }) },
        ]),
      );
      expect(list).toHaveLength(2);

      const again = await h.store.claimAction(familyId, claim({ claimToken: "token-b" }));
      expect(again).toEqual({ kind: "committed", record: committedRecord(c) });
    });

    it("release frigir kun egen pending lease — aldri en committet record", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      const c = claim();
      await h.store.claimAction(familyId, c);
      await h.store.releaseAction(familyId, c.requestId, "noen-andre");
      expect(await h.store.readAction(familyId, c.requestId)).toMatchObject({ status: "pending" });
      await h.store.releaseAction(familyId, c.requestId, c.claimToken);
      expect(await h.store.readAction(familyId, c.requestId)).toBeNull();

      await h.store.claimAction(familyId, c);
      await h.store.commitAction(familyId, {
        requestId: c.requestId,
        claimToken: c.claimToken,
        plan: { newItems: [], newEntries: [], updatedEntries: [] },
        record: committedRecord(c),
      });
      await h.store.releaseAction(familyId, c.requestId, c.claimToken);
      expect(await h.store.readAction(familyId, c.requestId)).toMatchObject({
        status: "committed",
      });
    });
  });
}
