/**
 * Idempotens- og krasj/retry-matrisen (Issue #27, 5937138669 pkt. 4–5)
 * mot in-memory-store med fault injection og styrt klokke.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FamilyContext } from "../auth/authorize";
import { MemoryStore } from "../store/memoryStore";
import { ToolError } from "./errors";
import { HandlelisteService, requestFingerprint } from "./service";

const FAMILY = "fam";
const ctx: FamilyContext = {
  familyId: FAMILY,
  firebaseUid: "uid-1",
  idpSub: "google-oauth2|123",
  clientId: "chatgpt",
};
const REQ = "8f2b8d0e-3a5c-4d7e-9f10-1a2b3c4d5e6f";

let store: MemoryStore;
let now: number;
let events: { name: string; fields: Record<string, unknown> }[];
let service: HandlelisteService;

beforeEach(() => {
  store = new MemoryStore();
  now = 1_000_000;
  events = [];
  let n = 0;
  service = new HandlelisteService(store, {
    clock: () => now,
    newId: () => `id-${++n}`,
    leaseMs: 60_000,
    commitDeadlineMs: 20_000,
    audit: { event: (name, fields) => events.push({ name, fields }) },
  });
  store.family(FAMILY).items.set("v-melk", { name: "Melk", cat: "Ost og meieri" });
  store.family(FAMILY).shopping.set("a", {
    itemId: "v-melk",
    name: "Melk",
    amount: "2",
    cat: "Ost og meieri",
    done: false,
  });
});

const melkAmount = () => store.family(FAMILY).shopping.get("a")?.amount;
const addMelk = (requestId = REQ) =>
  service.addItems(ctx, { requestId, items: [{ name: "Melk", amount: "3" }] });

describe("normal flyt", () => {
  it("utfører, returnerer utfall + tilbakelest liste, og lagrer committet audit-record", async () => {
    const result = await addMelk();
    expect(result.replayed).toBe(false);
    expect(result.results[0]).toMatchObject({ outcome: "merged", amount: "5" });
    expect(result.list?.items).toEqual([
      { id: "a", name: "Melk", amount: "5", cat: "Ost og meieri", done: false },
    ]);
    expect(await store.readAction(FAMILY, REQ)).toMatchObject({
      status: "committed",
      idpSub: ctx.idpSub,
      firebaseUid: ctx.firebaseUid,
      clientId: ctx.clientId,
      fingerprint: requestFingerprint([{ name: "Melk", amount: "3" }]),
      result: result.results,
    });
  });

  it("samme requestId på nytt → replay, ingen dobbel summering", async () => {
    await addMelk();
    const again = await addMelk();
    expect(again.replayed).toBe(true);
    expect(melkAmount()).toBe("5");
    expect(events.map((e) => e.name)).toContain("action_replayed");
  });

  it("ny requestId → ny handling (summeres igjen)", async () => {
    await addMelk();
    await addMelk("0b7c1f8e-1111-4222-8333-444455556666");
    expect(melkAmount()).toBe("8");
  });

  it("samme requestId med annen payload → idempotency_conflict, ingenting skrevet", async () => {
    await addMelk();
    await expect(
      service.addItems(ctx, { requestId: REQ, items: [{ name: "Melk", amount: "4" }] }),
    ).rejects.toMatchObject({ code: "idempotency_conflict", retryable: false });
    expect(melkAmount()).toBe("5");
  });

  it("samme requestId fra en annen principal → idempotency_conflict", async () => {
    await addMelk();
    await expect(
      service.addItems(
        { ...ctx, idpSub: "auth0|annen" },
        { requestId: REQ, items: [{ name: "Melk", amount: "3" }] },
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("duplikate varer i samme kall avvises før noe claimes", async () => {
    await expect(
      service.addItems(ctx, { requestId: REQ, items: [{ name: "Melk" }, { name: "melk" }] }),
    ).rejects.toMatchObject({ code: "duplicate_items" });
    expect(await store.readAction(FAMILY, REQ)).toBeNull();
  });
});

describe("krasj/retry", () => {
  it("feil FØR commit: ingenting skrevet, leasen frigis, retry utfører ÉN gang", async () => {
    store.failNextCommit("before");
    await expect(addMelk()).rejects.toThrow("Simulert feil før commit");
    expect(melkAmount()).toBe("2");
    expect(await store.readAction(FAMILY, REQ)).toBeNull();

    const retry = await addMelk();
    expect(retry.replayed).toBe(false);
    expect(melkAmount()).toBe("5");
  });

  it("feil ETTER commit (tapt svar): retry gir replay, ingen dobbel summering", async () => {
    store.failNextCommit("after");
    await expect(addMelk()).rejects.toThrow("Simulert tapt svar etter commit");
    expect(melkAmount()).toBe("5");
    expect(await store.readAction(FAMILY, REQ)).toMatchObject({ status: "committed" });

    const retry = await addMelk();
    expect(retry.replayed).toBe(true);
    expect(retry.results[0]).toMatchObject({ outcome: "merged", amount: "5" });
    expect(melkAmount()).toBe("5");
  });

  it("hard krasj etter claim (ingen release): retry under lease → request_in_progress; etter utløp → utføres én gang", async () => {
    // Simuler en prosess som dør mellom claim og commit: claim direkte i
    // storen uten at tjenesten får ryddet opp.
    await store.claimAction(FAMILY, {
      requestId: REQ,
      tool: "shopping_list_add_items",
      fingerprint: requestFingerprint([{ name: "Melk", amount: "3" }]),
      idpSub: ctx.idpSub,
      firebaseUid: ctx.firebaseUid,
      clientId: ctx.clientId,
      claimToken: "død-prosess",
      now,
      leaseMs: 60_000,
    });

    now += 30_000;
    const inProgress = addMelk();
    await expect(inProgress).rejects.toBeInstanceOf(ToolError);
    await expect(inProgress).rejects.toMatchObject({
      code: "request_in_progress",
      retryable: true,
    });
    expect(melkAmount()).toBe("2");

    now += 31_000;
    const retry = await addMelk();
    expect(retry.replayed).toBe(false);
    expect(melkAmount()).toBe("5");
  });

  it("passert commit-frist: committer aldri (så en ny lease-eier ikke kan kollidere)", async () => {
    store.beforeCommit = null;
    const slowStore = store;
    const original = slowStore.readItems.bind(slowStore);
    slowStore.readItems = async (f) => {
      now += 25_000; // lesingen "tar" 25 s — over 20 s-fristen
      return original(f);
    };
    await expect(addMelk()).rejects.toMatchObject({ code: "deadline_exceeded", retryable: true });
    expect(melkAmount()).toBe("2");
    expect(await store.readAction(FAMILY, REQ)).toBeNull();
  });

  it("feilet tilbakelesing gjør ikke en utført handling om til en feil", async () => {
    // Første lesing (planlegging) lykkes; tilbakelesingen etter commit feiler.
    const original = store.readShoppingList.bind(store);
    let calls = 0;
    store.readShoppingList = async (f) => {
      calls += 1;
      if (calls === 2) throw new Error("tilbakelesing feilet");
      return original(f);
    };
    const result = await addMelk();
    expect(result.replayed).toBe(false);
    expect(result.list).toBeNull();
    expect(melkAmount()).toBe("5");
    expect(events.map((e) => e.name)).toContain("read_back_failed");
  });

  it("en kastende audit-logg gjør aldri en utført skriving om til en feil", async () => {
    const withThrowingAudit = new HandlelisteService(store, {
      clock: () => now,
      audit: {
        event: () => {
          throw new Error("logg nede");
        },
      },
    });
    const result = await withThrowingAudit.addItems(ctx, {
      requestId: REQ,
      items: [{ name: "Melk", amount: "3" }],
    });
    expect(result.replayed).toBe(false);
    expect(melkAmount()).toBe("5");
  });
});

describe("samtidighet", () => {
  it("to samtidige kall med samme requestId: ett utfører, det andre får request_in_progress", async () => {
    const [a, b] = await Promise.allSettled([addMelk(), addMelk()]);
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    const rejected = [a, b].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "request_in_progress",
    });
    expect(melkAmount()).toBe("5");
  });
});

describe("lesing", () => {
  it("shopping_list_get skjuler avkryssede som standard, men teller dem", async () => {
    store.family(FAMILY).shopping.set("b", {
      itemId: null,
      name: "Egg",
      amount: "",
      cat: "Ost og meieri",
      done: true,
    });
    const list = await service.getShoppingList(ctx, {});
    expect(list.items.map((i) => i.name)).toEqual(["Melk"]);
    expect(list).toMatchObject({ pendingCount: 1, doneCount: 1 });
    const all = await service.getShoppingList(ctx, { includeDone: true });
    expect(all.items.map((i) => i.name)).toEqual(["Egg", "Melk"]);
  });

  it("items_search rangerer eksakt > prefiks > ordstart > delstreng", async () => {
    const items = store.family(FAMILY).items;
    items.set("1", { name: "Lettmelk", cat: "Ost og meieri" });
    items.set("2", { name: "Melkesjokolade", cat: "Diverse" });
    items.set("3", { name: "Kokos melk", cat: "Tørrvarer" });
    const result = await service.searchItems(ctx, { query: "MELK", limit: 10 });
    expect(result.items.map((i) => i.name)).toEqual([
      "Melk",
      "Melkesjokolade",
      "Kokos melk",
      "Lettmelk",
    ]);
    expect((await service.searchItems(ctx, { query: "melk", limit: 2 })).items).toHaveLength(2);
  });
});
