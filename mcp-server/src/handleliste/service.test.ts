/**
 * Idempotens-, samtidighets- og krasj/retry-matrisen (Issue #27 pkt. 4–5;
 * Kontrolltårn-beslutning 5950478583 pkt. 1, 2 og 6) mot in-memory-store
 * med RTDB-semantikk, feilinjeksjon og styrt klokke.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { FamilyContext } from "../auth/authorize";
import { MemoryStore } from "../store/memoryStore";
import { actionPath, itemsPath, shoppingOpsPath, shoppingPath } from "../store/paths";
import { HandlelisteService, requestFingerprint } from "./service";
import { OPS_MAX, OPS_TTL_MS } from "./shoppingNode";

const FAMILY = "fam";
const ctx: FamilyContext = {
  familyId: FAMILY,
  firebaseUid: "uid-1",
  idpSub: "google-oauth2|123",
  clientId: "chatgpt",
};
const REQ = "8f2b8d0e-3a5c-4d7e-9f10-1a2b3c4d5e6f";
const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 2, 12);

let store: MemoryStore;
let now: number;
let events: { name: string; fields: Record<string, unknown> }[];
let service: HandlelisteService;

beforeEach(() => {
  store = new MemoryStore();
  now = START;
  events = [];
  let n = 0;
  service = new HandlelisteService(store, {
    clock: () => now,
    newId: () => `id-${++n}`,
    audit: { event: (name, fields) => events.push({ name, fields }) },
  });
  store.set(`${itemsPath(FAMILY)}/v-melk`, { name: "Melk", cat: "Ost og meieri" });
  store.set(`${shoppingPath(FAMILY)}/a`, {
    id: "a",
    itemId: "v-melk",
    name: "Melk",
    amount: "2",
    cat: "Ost og meieri",
    done: false,
  });
});

const entry = (id: string) => store.get(`${shoppingPath(FAMILY)}/${id}`) as Record<string, unknown>;
const melkAmount = () => entry("a").amount;
const ops = () => (store.get(shoppingOpsPath(FAMILY)) ?? {}) as Record<string, unknown>;
const addMelk = (requestId = REQ, amount = "3") =>
  service.addItems(ctx, { requestId, items: [{ name: "Melk", amount }] });
const opFor = (at: number) => ({
  tool: "shopping_list_add_items",
  fp: "fp-gammel",
  sub: ctx.idpSub,
  uid: ctx.firebaseUid,
  client: ctx.clientId,
  at,
  result: [],
});

describe("normal flyt", () => {
  it("utfører atomisk: vareendring + kompakt `_ops`-record i shopping, og arkiverer i mcp/actions", async () => {
    const result = await addMelk();
    expect(result.replayed).toBe(false);
    expect(result.results[0]).toMatchObject({ outcome: "merged", amount: "5" });
    expect(result.list?.items).toEqual([
      { id: "a", name: "Melk", amount: "5", cat: "Ost og meieri", done: false },
    ]);
    expect(ops()[REQ]).toEqual({
      tool: "shopping_list_add_items",
      fp: requestFingerprint([{ name: "Melk", amount: "3" }]),
      sub: ctx.idpSub,
      uid: ctx.firebaseUid,
      client: ctx.clientId,
      at: START,
      result: result.results,
    });
    expect(store.get(actionPath(FAMILY, REQ))).toMatchObject({
      requestId: REQ,
      idpSub: ctx.idpSub,
      firebaseUid: ctx.firebaseUid,
      clientId: ctx.clientId,
      committedAt: START,
      result: result.results,
    });
  });

  it("bevarer rå felt på en sammenslått post (f.eks. `id`) og skriver `id` i nye poster", async () => {
    store.set(`${shoppingPath(FAMILY)}/a/ukjentFelt`, "beholdes");
    const result = await service.addItems(ctx, {
      requestId: REQ,
      items: [
        { name: "Melk", amount: "3" },
        { name: "Kanel", cat: "Tørrvarer" },
      ],
    });
    expect(entry("a")).toMatchObject({ id: "a", ukjentFelt: "beholdes", amount: "5" });
    const kanel = result.results.find((r) => r.name === "Kanel")!;
    expect(entry(kanel.entryId)).toEqual({
      id: kanel.entryId,
      itemId: kanel.itemId,
      name: "Kanel",
      amount: "",
      cat: "Tørrvarer",
      done: false,
    });
  });

  it("samme requestId på nytt → replay fra mcp/actions, ingen ny mutasjon", async () => {
    await addMelk();
    const again = await addMelk();
    expect(again.replayed).toBe(true);
    expect(melkAmount()).toBe("5");
    expect(events.find((e) => e.name === "action_replayed")?.fields.source).toBe("archive");
  });

  it("ny requestId → ny handling (summeres igjen)", async () => {
    await addMelk();
    await addMelk("0b7c1f8e-1111-4222-8333-444455556666");
    expect(melkAmount()).toBe("8");
  });

  it("samme requestId med annen payload → idempotency_conflict, ingenting skrevet", async () => {
    await addMelk();
    await expect(addMelk(REQ, "4")).rejects.toMatchObject({
      code: "idempotency_conflict",
      retryable: false,
    });
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

  it("konflikt oppdages også mot `_ops` alene (arkiveringen feilet)", async () => {
    store.failNextArchive();
    await addMelk();
    expect(store.get(actionPath(FAMILY, REQ))).toBeNull();
    await expect(addMelk(REQ, "4")).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(melkAmount()).toBe("5");
  });

  it("duplikate varer i samme kall avvises før noe skrives", async () => {
    await expect(
      service.addItems(ctx, { requestId: REQ, items: [{ name: "Melk" }, { name: "melk" }] }),
    ).rejects.toMatchObject({ code: "duplicate_items" });
    expect(ops()).toEqual({});
  });

  it("`_ops` vises aldri som vare i shopping_list_get", async () => {
    await addMelk();
    const list = await service.getShoppingList(ctx, { includeDone: true });
    expect(list.items.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("stale state / lost update (blokkeren i PR #40)", () => {
  it("appen endrer SAMME vare mens transaksjonen pågår → MCP beregner fra ny tilstand, appens endring overlever", async () => {
    store.onTransactionAttempt = (attempt) => {
      if (attempt === 1) store.set(`${shoppingPath(FAMILY)}/a/amount`, "10"); // bruker retter mengden
    };
    const result = await addMelk();
    expect(store.lastTransactionAttempts).toBe(2);
    expect(melkAmount()).toBe("13"); // 10 (appens) + 3 (MCP) — ikke 2 + 3
    expect(result.results[0]).toMatchObject({ previousAmount: "10", amount: "13" });
  });

  it("appen krysser av varen underveis → MCP legger til ny post; avkrysningen overlever", async () => {
    store.onTransactionAttempt = (attempt) => {
      if (attempt === 1) store.set(`${shoppingPath(FAMILY)}/a/done`, true);
    };
    const result = await addMelk();
    expect(entry("a")).toMatchObject({ done: true, amount: "2" });
    expect(result.results[0]).toMatchObject({ outcome: "added", amount: "3" });
    expect(entry(result.results[0]!.entryId)).toMatchObject({ name: "Melk", amount: "3" });
  });

  it("appen sletter en annen vare underveis → slettingen gjenopplives ikke av MCP", async () => {
    store.set(`${shoppingPath(FAMILY)}/b`, { id: "b", name: "Egg", amount: "", cat: "Diverse" });
    store.onTransactionAttempt = (attempt) => {
      if (attempt === 1) store.set(`${shoppingPath(FAMILY)}/b`, null);
    };
    await addMelk();
    expect(store.get(`${shoppingPath(FAMILY)}/b`)).toBeNull();
    expect(melkAmount()).toBe("5");
  });
});

describe("krasj/retry", () => {
  it("feil FØR commit: ingenting skrevet, retry utfører ÉN gang", async () => {
    store.failNextCommit("before");
    await expect(addMelk()).rejects.toThrow("Simulert feil før commit");
    expect(melkAmount()).toBe("2");
    expect(ops()).toEqual({});

    const retry = await addMelk();
    expect(retry.replayed).toBe(false);
    expect(melkAmount()).toBe("5");
  });

  it("feil ETTER commit (tapt svar), før arkivering: retry gir replay fra `_ops` og reparerer arkivet", async () => {
    store.failNextCommit("after");
    await expect(addMelk()).rejects.toThrow("Simulert tapt svar etter commit");
    expect(melkAmount()).toBe("5");
    expect(store.get(actionPath(FAMILY, REQ))).toBeNull();

    const retry = await addMelk();
    expect(retry.replayed).toBe(true);
    expect(retry.results[0]).toMatchObject({ outcome: "merged", amount: "5" });
    expect(melkAmount()).toBe("5");
    expect(events.find((e) => e.name === "action_replayed")?.fields.source).toBe("ops");
    expect(store.get(actionPath(FAMILY, REQ))).toMatchObject({ requestId: REQ });
  });

  it("varer opprettet før en feilet transaksjon gjenbrukes ved retry (ingen duplikat i varebasen)", async () => {
    store.failNextCommit("before");
    const input = { requestId: REQ, items: [{ name: "Kanel", cat: "Tørrvarer" as const }] };
    await expect(service.addItems(ctx, input)).rejects.toThrow();
    const retry = await service.addItems(ctx, input);
    const kanel = (await store.readItems(FAMILY)).filter((v) => v.name === "Kanel");
    expect(kanel).toHaveLength(1);
    expect(retry.results[0]).toMatchObject({ newItemCreated: true, itemId: kanel[0]!.id });
  });

  it("feilet tilbakelesing gjør ikke en utført handling om til en feil", async () => {
    const original = store.readShoppingNode.bind(store);
    store.readShoppingNode = async () => {
      throw new Error("tilbakelesing feilet");
    };
    const result = await addMelk();
    store.readShoppingNode = original;
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
    store.failNextArchive(); // også arkiveringsfeil logges — og svelges
    const result = await withThrowingAudit.addItems(ctx, {
      requestId: REQ,
      items: [{ name: "Melk", amount: "3" }],
    });
    expect(result.replayed).toBe(false);
    expect(melkAmount()).toBe("5");
  });
});

describe("samtidighet", () => {
  it("to samtidige kall med samme requestId: ett utfører, det andre får replay", async () => {
    const [a, b] = await Promise.all([addMelk(), addMelk()]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.results).toEqual(b.results);
    expect(melkAmount()).toBe("5");
  });

  it("samme requestId committet av en annen prosess MIDT i transaksjonen → updateren ser `_ops` → replay", async () => {
    const committedElsewhere = [
      {
        inputName: "Melk",
        outcome: "merged",
        entryId: "a",
        itemId: "v-melk",
        name: "Melk",
        amount: "5",
        previousAmount: "2",
        cat: "Ost og meieri",
        newItemCreated: false,
      },
    ];
    store.onTransactionAttempt = (attempt) => {
      if (attempt !== 1) return;
      // En annen serverinstans fullførte samme forespørsel mellom vår lesing og vår skriving.
      store.set(`${shoppingPath(FAMILY)}/a/amount`, "5");
      store.set(`${shoppingOpsPath(FAMILY)}/${REQ}`, {
        tool: "shopping_list_add_items",
        fp: requestFingerprint([{ name: "Melk", amount: "3" }]),
        sub: ctx.idpSub,
        uid: ctx.firebaseUid,
        client: ctx.clientId,
        at: START,
        result: committedElsewhere,
      });
    };
    const result = await addMelk();
    expect(store.lastTransactionAttempts).toBe(2);
    expect(result.replayed).toBe(true);
    expect(result.results).toEqual(committedElsewhere);
    expect(melkAmount()).toBe("5");
  });
});

describe("retensjon (pkt. 2)", () => {
  it("beskjærer `_ops` eldre enn 7 d — kun når recorden er bekreftet i mcp/actions", async () => {
    store.set(`${shoppingOpsPath(FAMILY)}/gammel-arkivert`, opFor(START - OPS_TTL_MS - 1));
    await store.archiveAction(
      FAMILY,
      {
        requestId: "gammel-arkivert",
        tool: "shopping_list_add_items",
        fingerprint: "fp-gammel",
        idpSub: ctx.idpSub,
        firebaseUid: ctx.firebaseUid,
        clientId: ctx.clientId,
        committedAt: START - OPS_TTL_MS - 1,
        result: [],
      },
      "2026-09-25",
    );
    store.set(`${shoppingOpsPath(FAMILY)}/ung`, opFor(START - DAY));
    await addMelk();
    expect(Object.keys(ops()).sort()).toEqual([REQ, "ung"].sort());
  });

  it("en gammel op-record som mangler i mcp/actions repareres FØR den beskjæres", async () => {
    store.set(`${shoppingOpsPath(FAMILY)}/uarkivert`, opFor(START - OPS_TTL_MS - 1));
    await addMelk();
    expect(ops()["uarkivert"]).toBeUndefined();
    expect(store.get(actionPath(FAMILY, "uarkivert"))).toMatchObject({
      requestId: "uarkivert",
      fingerprint: "fp-gammel",
      committedAt: START - OPS_TTL_MS - 1,
    });
  });

  it("feiler reparasjonen, blir op-recorden stående (garantien går foran 7 d-grensen)", async () => {
    store.set(`${shoppingOpsPath(FAMILY)}/uarkivert`, opFor(START - OPS_TTL_MS - 1));
    store.failNextArchive(2); // reparasjonen OG arkiveringen av den nye
    await addMelk();
    expect(ops()["uarkivert"]).toBeDefined();
    expect(events.map((e) => e.name)).toContain("archive_confirm_failed");
  });

  it("maks 100: de eldste (arkiverte) beskjæres, den nye beholdes", async () => {
    for (let i = 0; i < OPS_MAX + 5; i++) {
      const id = `r-${String(i).padStart(3, "0")}`;
      store.set(`${shoppingOpsPath(FAMILY)}/${id}`, opFor(START - DAY + i));
    }
    await addMelk();
    const keys = Object.keys(ops());
    expect(keys).toHaveLength(OPS_MAX);
    expect(keys).toContain(REQ);
    expect(keys).not.toContain("r-000");
    expect(keys).toContain(`r-${OPS_MAX + 4}`);
    // De beskårne finnes fortsatt i det lange registeret (reparert ved beskjæring).
    expect(store.get(actionPath(FAMILY, "r-000"))).not.toBeNull();
  });

  it("en retry etter at `_ops` er beskåret (> 7 d, < 90 d) gir replay fra mcp/actions — ikke ny mutasjon", async () => {
    await addMelk();
    now += 8 * DAY;
    await addMelk("0b7c1f8e-1111-4222-8333-444455556666", "1"); // beskjærer REQ fra _ops
    expect(ops()[REQ]).toBeUndefined();
    expect(melkAmount()).toBe("6");

    now += 30 * DAY;
    const retry = await addMelk();
    expect(retry.replayed).toBe(true);
    expect(melkAmount()).toBe("6");
  });

  it("annen payload på en requestId som kun finnes i mcp/actions (> 7 d) → idempotency_conflict, ingen mutasjon", async () => {
    await addMelk();
    now += 8 * DAY;
    await addMelk("0b7c1f8e-1111-4222-8333-444455556666", "1"); // beskjærer REQ fra _ops
    expect(ops()[REQ]).toBeUndefined();
    await expect(addMelk(REQ, "4")).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(melkAmount()).toBe("6");
  });

  it("etter 90 d er requestId-en utløpt: begge registrene er beskåret (dokumentert oppførsel)", async () => {
    await addMelk();
    now += 92 * DAY;
    await addMelk("0b7c1f8e-1111-4222-8333-444455556666", "1"); // beskjærer både _ops og mcp/actions
    expect(store.get(actionPath(FAMILY, REQ))).toBeNull();
    expect(ops()[REQ]).toBeUndefined();

    const reused = await addMelk();
    expect(reused.replayed).toBe(false);
    expect(melkAmount()).toBe("9");
  });
});

describe("legacy-shape", () => {
  it("gammel array-seed (INIT_SHOPPING, id 1–4): postene bevares, noden blir et objekt med `_ops`", async () => {
    store.set(shoppingPath(FAMILY), null);
    const seed = Object.fromEntries(
      [1, 2, 3, 4].map((id) => [
        String(id),
        {
          id,
          name: ["Melk", "Brød", "Egg", "Smør"][id - 1],
          amount: "1",
          cat: "Diverse",
          done: false,
        },
      ]),
    );
    store.set(shoppingPath(FAMILY), seed);
    expect(Array.isArray(store.get(shoppingPath(FAMILY)))).toBe(true);

    const result = await addMelk();
    expect(result.results[0]).toMatchObject({ outcome: "merged", entryId: "1", amount: "4" });
    const node = store.get(shoppingPath(FAMILY)) as Record<string, unknown>;
    expect(Array.isArray(node)).toBe(false);
    expect(Object.keys(node).sort()).toEqual(["1", "2", "3", "4", "_ops"]);
    expect(node["1"]).toEqual({ id: 1, name: "Melk", amount: "4", cat: "Diverse", done: false });
    expect(node["4"]).toEqual(seed["4"]);
  });
});

describe("lesing", () => {
  it("shopping_list_get skjuler avkryssede som standard, men teller dem", async () => {
    store.set(`${shoppingPath(FAMILY)}/b`, {
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
    store.set(`${itemsPath(FAMILY)}/1`, { name: "Lettmelk", cat: "Ost og meieri" });
    store.set(`${itemsPath(FAMILY)}/2`, { name: "Melkesjokolade", cat: "Diverse" });
    store.set(`${itemsPath(FAMILY)}/3`, { name: "Kokos melk", cat: "Tørrvarer" });
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
