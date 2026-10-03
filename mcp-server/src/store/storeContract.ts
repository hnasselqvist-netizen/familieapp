/**
 * Felles kontrakttest for store-porten. Kjøres mot in-memory-faken
 * (`memoryStore.test.ts`, alltid) og mot Firebase Admin-adapteren på
 * RTDB-emulatoren (`firebaseAdminStore.integration.test.ts`) — slik at
 * faken som de raske testene bygger på bevislig oppfører seg som den ekte
 * adapteren (inkl. RTDBs array-tolkning og transaksjonens alt-eller-ingenting).
 */
import { describe, expect, it } from "vitest";
import { byggKontroll } from "../forvaltning/cutoverKontroll";
import { actionPath, forsoningsnodePath, itemPath, shoppingPath } from "./paths";
import type { ActionRecord, FamilyId, HverdagsflytStore, PrincipalLink } from "./types";

export interface Seeder {
  member(familyId: FamilyId, uid: string): Promise<void>;
  principal(idpSub: string, link: PrincipalLink): Promise<void>;
  /** Skriver en rå verdi på en sti (som en annen klient — appen eller legacy — ville gjort). */
  raw(path: string, value: unknown): Promise<void>;
  read(path: string): Promise<unknown>;
}

export interface ContractHarness {
  store: HverdagsflytStore;
  seed: Seeder;
  /** Unik familie per test, så testene ikke deler tilstand. */
  newFamilyId(): FamilyId;
}

const record = (requestId: string, committedAt: number): ActionRecord => ({
  requestId,
  tool: "shopping_list_add_items",
  fingerprint: "fp-1",
  idpSub: "google-oauth2|123",
  firebaseUid: "uid-1",
  clientId: "client-1",
  committedAt,
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

    it("leser shopping-noden rått (inkl. `_ops`) og `_ops` for seg", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      expect(await h.store.readShoppingNode(familyId)).toBeNull();
      const node = { a: { name: "Melk", id: "a" }, _ops: { r1: { tool: "x", at: 1 } } };
      await h.seed.raw(shoppingPath(familyId), node);
      expect(await h.store.readShoppingNode(familyId)).toEqual(node);
      expect(await h.store.readShoppingOps(familyId)).toEqual(node._ops);
    });

    it("legacy-seedens heltallsnøkler (INIT_SHOPPING, id 1–4) leses som RTDB-array", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      const seed = Object.fromEntries(
        [1, 2, 3, 4].map((id) => [String(id), { id, name: `Vare ${id}`, done: false }]),
      );
      await h.seed.raw(shoppingPath(familyId), seed);
      const node = (await h.store.readShoppingNode(familyId)) as unknown[];
      expect(Array.isArray(node)).toBe(true);
      expect(node).toHaveLength(5);
      expect(0 in node).toBe(false); // hull, ikke null — `Object.values` hopper over det
      expect(Object.values(node)).toEqual([seed["1"], seed["2"], seed["3"], seed["4"]]);
    });

    it("createItemIfAbsent skriver kun på ledig id, og returnerer det som ligger der", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      expect(
        await h.store.createItemIfAbsent(familyId, "v1", { name: "Kanel", cat: "Tørrvarer" }),
      ).toEqual({ name: "Kanel", cat: "Tørrvarer" });
      expect(
        await h.store.createItemIfAbsent(familyId, "v1", { name: "Annet", cat: "Diverse" }),
      ).toEqual({ name: "Kanel", cat: "Tørrvarer" });
      expect(await h.seed.read(itemPath(familyId, "v1"))).toEqual({
        name: "Kanel",
        cat: "Tørrvarer",
      });
      expect(await h.store.readItems(familyId)).toEqual([
        { id: "v1", name: "Kanel", cat: "Tørrvarer" },
      ]);
    });

    it("transactShopping: updateren får fersk verdi; ny verdi skrives, `undefined` skriver ingenting", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.seed.raw(`${shoppingPath(familyId)}/a`, { name: "Melk", amount: "2" });

      const seen: unknown[] = [];
      const first = await h.store.transactShopping(familyId, (current) => {
        seen.push(current);
        if (current === null) return { placeholder: true }; // spekulativt kall mot kald cache
        return { ...(current as object), b: { name: "Egg" }, _ops: { r1: { at: 1 } } };
      });
      expect(first).toEqual({ committed: true });
      expect(seen.at(-1)).toEqual({ a: { name: "Melk", amount: "2" } });
      expect(await h.store.readShoppingNode(familyId)).toEqual({
        a: { name: "Melk", amount: "2" },
        b: { name: "Egg" },
        _ops: { r1: { at: 1 } },
      });

      const aborted = await h.store.transactShopping(familyId, (current) =>
        current === null ? {} : undefined,
      );
      expect(aborted).toEqual({ committed: false });
      expect(await h.store.readShoppingNode(familyId)).toMatchObject({ b: { name: "Egg" } });
    });

    it("transactShopping: en legacy-array blir et objekt med samme nøkler når en strengnøkkel skrives", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.seed.raw(shoppingPath(familyId), { "1": { id: 1, name: "Melk" } });
      await h.store.transactShopping(familyId, (current) => {
        const node = Array.isArray(current)
          ? Object.fromEntries(current.flatMap((v, i) => (v ? [[String(i), v]] : [])))
          : ((current as object | null) ?? {});
        return { ...node, _ops: { r1: { at: 1 } } };
      });
      expect(await h.store.readShoppingNode(familyId)).toEqual({
        "1": { id: 1, name: "Melk" },
        _ops: { r1: { at: 1 } },
      });
    });

    it("readForsoningsnoder: legacy-arrays leses som arrays, glisne som hull, manglende som null — uten å skrive", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      const t = (id: string) => ({
        id,
        dato: "2026-09-01",
        belop: 10,
        retning: "ut",
        status: "ny",
      });
      await h.seed.raw(forsoningsnodePath(familyId, "transaksjoner"), [t("t1"), t("t2"), t("t3")]);
      // Indeks 1 mangler, men over halvparten er fylt → RTDB leser det som array med hull.
      await h.seed.raw(forsoningsnodePath(familyId, "hendelser"), {
        "0": { id: "h1", status: "ferdig" },
        "2": { id: "h3", status: "pa_vent" },
      });
      await h.seed.raw(forsoningsnodePath(familyId, "rules"), { a: { id: "r1", mode: "auto" } });
      const foer = JSON.stringify(await h.seed.read(`families/${familyId}`));

      const raa = await h.store.readForsoningsnoder(familyId);
      expect(raa.transaksjoner).toEqual([t("t1"), t("t2"), t("t3")]);
      expect(raa.receipts).toBeNull();

      const rapport = byggKontroll(raa, { lest: "2026-10-03T18:00:00.000Z" });
      expect(rapport.noder.transaksjoner).toMatchObject({ form: "array", antall: 3 });
      expect(rapport.noder.hendelser).toMatchObject({
        form: "array_med_hull",
        antall: 2,
        hull: [1],
      });
      expect(rapport.noder.rules).toMatchObject({ form: "objekt", ikkeArrayNokler: ["a"] });
      expect(rapport.noder.receipts).toMatchObject({ form: "tom", antall: 0 });
      expect(JSON.stringify(await h.seed.read(`families/${familyId}`))).toBe(foer);
    });

    it("archiveAction + readArchivedAction; beskjæring sletter eldste dagsbøtter ≤ lastDay", async () => {
      const h = setup();
      const familyId = h.newFamilyId();
      await h.store.archiveAction(familyId, record("req.gammel/1", 1), "2026-01-01");
      await h.store.archiveAction(familyId, record("req-2", 2), "2026-01-02");
      await h.store.archiveAction(familyId, record("req-3", 3), "2026-01-03");
      await h.store.archiveAction(familyId, record("req-4", 4), "2026-03-01");
      expect(await h.store.readArchivedAction(familyId, "req.gammel/1")).toEqual(
        record("req.gammel/1", 1),
      );

      // Kun to bøtter per kall, eldste først; aldri nyere enn lastDay.
      expect(await h.store.pruneArchivedActions(familyId, "2026-02-01", 2)).toBe(2);
      expect(await h.store.readArchivedAction(familyId, "req.gammel/1")).toBeNull();
      expect(await h.store.readArchivedAction(familyId, "req-2")).toBeNull();
      expect(await h.store.readArchivedAction(familyId, "req-3")).not.toBeNull();
      expect(await h.store.pruneArchivedActions(familyId, "2026-02-01", 2)).toBe(1);
      expect(await h.store.readArchivedAction(familyId, "req-3")).toBeNull();
      expect(await h.store.readArchivedAction(familyId, "req-4")).not.toBeNull();
      expect(await h.seed.read(actionPath(familyId, "req-4"))).not.toBeNull();
      expect(await h.store.pruneArchivedActions(familyId, "2026-02-01", 2)).toBe(0);
    });
  });
}
