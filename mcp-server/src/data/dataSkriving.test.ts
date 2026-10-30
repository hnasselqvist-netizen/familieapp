import { beforeEach, describe, expect, it } from "vitest";
import { AuthorizationError, type FamilyContext } from "../auth/authorize";
import { ToolError } from "../handleliste/errors";
import { MemoryStore } from "../store/memoryStore";
import type { NodeUpdater } from "../store/types";
import { hentData, MAKS_HENT_BYTES, skrivData } from "./dataSkriving";
import { MAKS_FAMILIE_SKRIVE_BYTES, type SkriveInn } from "./skriving";
import { MANGLER, versjonAv } from "./versjon";

const NAA = Date.parse("2026-10-30T12:00:00Z");
const F = "fam-skriv";
const ctx: FamilyContext = {
  familyId: F,
  firebaseUid: "uid-h",
  idpSub: "google-oauth2|helen",
  clientId: "chatgpt",
};

const SEED = {
  members: { "uid-h": true },
  mealLibrary: { m1: { navn: "Taco" }, m2: { navn: "Suppe" } },
  budget: { mat: 4000 },
  shopping: { _skriver: { app: "web-v2" }, a: { name: "Melk" } },
};

let store: MemoryStore;
let logg: { event: string; data: Record<string, unknown> }[];

beforeEach(() => {
  store = new MemoryStore();
  store.set(`families/${F}`, structuredClone(SEED));
  logg = [];
});

const deps = (s = store) => ({
  store: s,
  audit: {
    event: (event: string, data: Record<string, unknown>) => void logg.push({ event, data }),
  },
  now: () => NAA,
});
const les = (sti: string) => store.get(`families/${F}/${sti}`);
const tilstand = () => JSON.stringify(store.get(`families/${F}`));

async function feil(p: Promise<unknown>): Promise<ToolError | AuthorizationError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ToolError || err instanceof AuthorizationError) return err;
    throw err;
  }
  throw new Error("forventet feil");
}

const endreTaco = async (id = "2026-10-30_taco0001"): Promise<SkriveInn> => {
  const hentet = await hentData(store, ctx, "mealLibrary/m1");
  return {
    opId: id,
    ops: [
      {
        sti: "mealLibrary/m1",
        type: "set",
        verdi: { navn: "Fisketaco" },
        forventet: hentet.versjon!,
      },
    ],
  };
};

describe("data_hent", () => {
  it("gir verdi og versjon fra samme lesing; mangler gir «mangler»", async () => {
    expect(await hentData(store, ctx, "mealLibrary/m1")).toEqual({
      sti: "mealLibrary/m1",
      finnes: true,
      verdi: { navn: "Taco" },
      versjon: versjonAv({ navn: "Taco" }),
      bytes: 15,
    });
    expect(await hentData(store, ctx, "finnes/ikke")).toEqual({
      sti: "finnes/ikke",
      finnes: false,
      versjon: MANGLER,
      bytes: 0,
    });
  });

  it("roten gis uten `_mcp`, og versjonen er rotversjonen", async () => {
    store.set(`families/${F}/_mcp/ops/x`, { a: 1 });
    const rot = await hentData(store, ctx, "");
    expect(rot.verdi).toEqual(SEED);
    expect(rot.versjon).toBe(versjonAv(SEED));
  });

  it("for stor: ingen verdi og ingen versjon", async () => {
    store.set(`families/${F}/stor`, "x".repeat(MAKS_HENT_BYTES + 1));
    const r = await hentData(store, ctx, "stor");
    expect(r).toMatchObject({ finnes: true, forStor: true });
    expect(r.versjon).toBeUndefined();
    expect(r.verdi).toBeUndefined();
  });

  it("ugyldig sti → invalid_path", async () => {
    expect((await feil(hentData(store, ctx, "../annen"))).code).toBe("invalid_path");
  });
});

describe("data_skriv mot in-memory-store", () => {
  it("committer, svarer med før/etter og skrivefri tilbakelesing, og logger uten verdier", async () => {
    const r = await skrivData(deps(), ctx, await endreTaco());
    expect(r.utfall).toBe("committed");
    expect(les("mealLibrary/m1")).toEqual({ navn: "Fisketaco" });
    expect(les("mealLibrary/m2")).toEqual({ navn: "Suppe" });
    expect(r.skrivinger).toEqual([
      {
        sti: "mealLibrary/m1",
        type: "set",
        foer: versjonAv({ navn: "Taco" }),
        etter: versjonAv({ navn: "Fisketaco" }),
        bevart: [],
      },
    ]);
    expect(r.tilbakelesing).toEqual({
      ok: true,
      skrivinger: [
        { sti: "mealLibrary/m1", versjon: versjonAv({ navn: "Fisketaco" }), senereEndret: false },
      ],
    });
    expect(JSON.stringify(logg)).not.toContain("Fisketaco");
    expect(logg.map((l) => l.event)).toEqual(["data_skriv_committed"]);
  });

  it("samme opId igjen → replay, ingen ny skriving", async () => {
    const inn = await endreTaco();
    await skrivData(deps(), ctx, inn);
    const etter = tilstand();
    const r = await skrivData(deps(), ctx, inn);
    expect(r.utfall).toBe("replay");
    expect(tilstand()).toBe(etter);
  });

  it("tapt svar etter commit: kvitteringen finnes → committed; retry → replay; én skriving", async () => {
    const inn = await endreTaco();
    store.failNextCommit("after");
    const r = await skrivData(deps(), ctx, inn);
    expect(r.utfall).toBe("committed");
    const etter = tilstand();
    expect((await skrivData(deps(), ctx, inn)).utfall).toBe("replay");
    expect(tilstand()).toBe(etter);
    expect(logg.map((l) => l.event)).toContain("data_skriv_ukjent");
  });

  it("feil før commit og kvitteringen mangler → ukjent_utfall (retryable); retry committer", async () => {
    const inn = await endreTaco();
    const foer = tilstand();
    store.failNextCommit("before");
    const e = await feil(skrivData(deps(), ctx, inn));
    expect(e).toMatchObject({ code: "ukjent_utfall", retryable: true });
    expect(tilstand()).toBe(foer);
    expect((await skrivData(deps(), ctx, inn)).utfall).toBe("committed");
  });

  it("samtidig appendring i et URØRT felt mellom lesing og commit: committer, appendringen bevares", async () => {
    const inn = await endreTaco();
    store.onTransactionAttempt = (forsok) => {
      if (forsok === 1) store.set(`families/${F}/mealLibrary/m2/navn`, "Suppe fra appen");
    };
    const r = await skrivData(deps(), ctx, inn);
    expect(r.utfall).toBe("committed");
    expect(store.lastTransactionAttempts).toBe(2);
    expect(les("mealLibrary")).toEqual({
      m1: { navn: "Fisketaco" },
      m2: { navn: "Suppe fra appen" },
    });
  });

  it("samtidig appendring i et BERØRT felt: konflikt med nåværende versjon, ingen skriving", async () => {
    const inn = await endreTaco();
    store.onTransactionAttempt = (forsok) => {
      if (forsok === 1) store.set(`families/${F}/mealLibrary/m1/navn`, "Taco fra appen");
    };
    const e = await feil(skrivData(deps(), ctx, inn));
    expect(e).toMatchObject({ code: "konflikt", retryable: false });
    expect((e as ToolError).detaljer).toEqual({
      avvik: [
        {
          sti: "mealLibrary/m1",
          forventet: versjonAv({ navn: "Taco" }),
          faktisk: versjonAv({ navn: "Taco fra appen" }),
        },
      ],
    });
    expect(les("mealLibrary/m1")).toEqual({ navn: "Taco fra appen" });
    expect(les("_mcp")).toBeNull();
  });

  it("endring mellom data_les og skriving: versjonen fra før endringen gir konflikt", async () => {
    const gammel = await hentData(store, ctx, "budget");
    store.set(`families/${F}/budget/mat`, 4500); // appen endrer
    const e = await feil(
      skrivData(deps(), ctx, {
        opId: "2026-10-30_budsjett1",
        ops: [{ sti: "budget", type: "set", verdi: { mat: 5000 }, forventet: gammel.versjon! }],
      }),
    );
    expect(e.code).toBe("konflikt");
    expect(les("budget")).toEqual({ mat: 4500 });
  });

  it("appendring etter commit, før tilbakelesingen: committed + senereEndret, ikke feil", async () => {
    const inn = await endreTaco();
    const s = Object.create(store) as MemoryStore;
    s.transactFamily = async (f: string, u: NodeUpdater) => {
      const r = await store.transactFamily(f, u);
      store.set(`families/${F}/mealLibrary/m1/navn`, "Endret etterpå");
      return r;
    };
    const r = await skrivData(deps(s), ctx, inn);
    expect(r.utfall).toBe("committed");
    expect(r.skrivinger[0]!.etter).toBe(versjonAv({ navn: "Fisketaco" }));
    expect(r.tilbakelesing).toEqual({
      ok: true,
      skrivinger: [
        {
          sti: "mealLibrary/m1",
          versjon: versjonAv({ navn: "Endret etterpå" }),
          senereEndret: true,
        },
      ],
    });
  });

  it("tilbakelesingen feiler: fortsatt committed (dataene ER lagret), tilbakelesing.ok=false", async () => {
    const inn = await endreTaco();
    store.failNextLesNode();
    const r = await skrivData(deps(), ctx, inn);
    expect(r.utfall).toBe("committed");
    expect(r.tilbakelesing).toEqual({ ok: false });
    expect(les("mealLibrary/m1")).toEqual({ navn: "Fisketaco" });
  });

  it("utdatert cache: en avvisning fra første updater-kall verifiseres og gir likevel commit", async () => {
    const inn = await endreTaco();
    const s = Object.create(store) as MemoryStore;
    let forsteKall = true;
    s.transactFamily = async (f: string, u: NodeUpdater) => {
      if (forsteKall) {
        forsteKall = false;
        // Kald cache: updateren ser `null` og avviser — ingenting sendes.
        return { committed: u(null) !== undefined && false };
      }
      return store.transactFamily(f, u);
    };
    const r = await skrivData(deps(s), ctx, inn);
    expect(r.utfall).toBe("committed");
    expect(les("mealLibrary/m1")).toEqual({ navn: "Fisketaco" });
  });

  it("medlemskap trukket tilbake mellom autorisasjon og transaksjon → not_member, ingen skriving", async () => {
    const inn = await endreTaco();
    store.removeMember(F, "uid-h");
    const foer = tilstand();
    const e = await feil(skrivData(deps(), ctx, inn));
    expect(e).toBeInstanceOf(AuthorizationError);
    expect(e.code).toBe("not_member");
    expect(tilstand()).toBe(foer);
  });

  it("samme opId med annen payload → idempotency_conflict; ugyldig/beskyttet → ingen I/O", async () => {
    const inn = await endreTaco();
    await skrivData(deps(), ctx, inn);
    const annen = { ...inn, ops: [{ ...inn.ops[0]!, verdi: { navn: "Annet" } }] };
    expect((await feil(skrivData(deps(), ctx, annen))).code).toBe("idempotency_conflict");

    const foer = tilstand();
    const beskyttet = await feil(
      skrivData(deps(), ctx, {
        opId: "2026-10-30_members1",
        ops: [{ sti: "members/inntrenger", type: "set", verdi: true, forventet: MANGLER }],
      }),
    );
    expect(beskyttet.code).toBe("beskyttet");
    expect(tilstand()).toBe(foer);
  });

  it("slett på familieroten bevarer members og markør; replay etterpå skriver ikke", async () => {
    const rot = await hentData(store, ctx, "");
    const inn: SkriveInn = {
      opId: "2026-10-30_rotslett1",
      ops: [{ sti: "", type: "slett", forventet: rot.versjon! }],
    };
    const r = await skrivData(deps(), ctx, inn);
    expect(r.skrivinger[0]!.bevart).toEqual(["members", "shopping/_skriver"]);
    expect(les("members")).toEqual(SEED.members);
    expect(les("shopping")).toEqual({ _skriver: SEED.shopping._skriver });
    expect(les("mealLibrary")).toBeNull();
    const etter = tilstand();
    expect((await skrivData(deps(), ctx, inn)).utfall).toBe("replay");
    expect(tilstand()).toBe(etter);
  });
});

describe("audit og logg (#85-review 5709352689 pkt. 1 og 2)", () => {
  const kastendeAudit = () => ({
    store,
    audit: {
      event: () => {
        throw new Error("audit-sink nede");
      },
    },
    now: () => NAA,
  });

  it("audit kaster etter kjent commit: fortsatt committed; retry → replay uten ny skriving", async () => {
    const inn = await endreTaco();
    const r = await skrivData(kastendeAudit(), ctx, inn);
    expect(r).toMatchObject({ utfall: "committed", tilbakelesing: { ok: true } });
    expect(les("mealLibrary/m1")).toEqual({ navn: "Fisketaco" });
    const etter = tilstand();
    expect((await skrivData(kastendeAudit(), ctx, inn)).utfall).toBe("replay");
    expect(tilstand()).toBe(etter);
  });

  it("audit kaster under gjenoppretting etter tapt svar: committed fra kvitteringen; retry → replay", async () => {
    const inn = await endreTaco();
    store.failNextCommit("after");
    const r = await skrivData(kastendeAudit(), ctx, inn);
    expect(r.utfall).toBe("committed");
    const etter = tilstand();
    expect((await skrivData(kastendeAudit(), ctx, inn)).utfall).toBe("replay");
    expect(tilstand()).toBe(etter);
  });

  it("audit kaster og tilbakelesingen feiler: committed med tilbakelesing.ok=false", async () => {
    const inn = await endreTaco();
    store.failNextLesNode();
    const r = await skrivData(kastendeAudit(), ctx, inn);
    expect(r).toMatchObject({ utfall: "committed", tilbakelesing: { ok: false } });
    expect(les("mealLibrary/m1")).toEqual({ navn: "Fisketaco" });
  });

  const CANARY = "synthetic-secret-in-sdk-error";

  it("canary i transaksjonsfeilen og i oppslaget etterpå havner ikke i loggen", async () => {
    const inn = await endreTaco();
    const s = Object.create(store) as MemoryStore;
    s.transactFamily = async () => {
      throw Object.assign(new Error(`${CANARY} verdi=Fisketaco`), {
        name: "PrivateCanary",
        code: CANARY,
      });
    };
    s.lesNode = async () => {
      throw Object.assign(new Error(`${CANARY} under oppslag`), {
        name: "PrivateCanary",
        code: CANARY,
      });
    };
    const e = await feil(skrivData(deps(s), ctx, inn));
    expect(e).toMatchObject({ code: "ukjent_utfall", retryable: true });
    expect(JSON.stringify(e)).not.toContain(CANARY);
    expect(JSON.stringify(logg)).not.toContain(CANARY);
    expect(JSON.stringify(logg)).not.toContain("PrivateCanary");
    expect(JSON.stringify(logg)).not.toContain("Fisketaco");
    expect(logg).toContainEqual({
      event: "data_skriv_ukjent",
      data: { opId: inn.opId, feilklasse: "Error" },
    });
  });

  it("et ukjent feilobjekt med kastende gettere kan ikke kaste seg ut av feilbehandlingen", async () => {
    const inn = await endreTaco();
    const s = Object.create(store) as MemoryStore;
    const fiendtlig = Object.defineProperties(
      {},
      {
        code: {
          get() {
            throw new Error(CANARY);
          },
        },
        name: {
          get() {
            throw new Error(CANARY);
          },
        },
      },
    );
    s.transactFamily = async () => {
      throw fiendtlig;
    };
    const e = await feil(skrivData(deps(s), ctx, inn));
    expect(e).toMatchObject({ code: "ukjent_utfall", retryable: true });
    expect(JSON.stringify(logg)).not.toContain(CANARY);
    expect(logg).toContainEqual({
      event: "data_skriv_ukjent",
      data: { opId: inn.opId, feilklasse: "object" },
    });
  });

  it("canary i tilbakelesingsfeilen havner ikke i loggen", async () => {
    const inn = await endreTaco();
    const s = Object.create(store) as MemoryStore;
    s.lesNode = async () => {
      throw Object.assign(
        new Error(`${CANARY} https://db.invalid/families/x.json?verdi=Fisketaco`),
        {
          name: "PrivateCanary",
          code: CANARY,
        },
      );
    };
    const r = await skrivData(deps(s), ctx, inn);
    expect(r).toMatchObject({ utfall: "committed", tilbakelesing: { ok: false } });
    expect(JSON.stringify(logg)).not.toContain(CANARY);
    expect(JSON.stringify(logg)).not.toContain("PrivateCanary");
    expect(JSON.stringify(logg)).not.toContain("Fisketaco");
    expect(logg.map((l) => l.event)).toEqual([
      "data_skriv_committed",
      "data_skriv_tilbakelesing_feilet",
    ]);
  });

  it("committed-loggen har opId og antall per type — ikke stier, verdier eller versjoner", async () => {
    const inn = await endreTaco();
    await skrivData(deps(), ctx, inn);
    expect(logg).toEqual([
      {
        event: "data_skriv_committed",
        data: { opId: inn.opId, antall: 1, set: 1, update: 0, slett: 0 },
      },
    ]);
  });
});

describe("transaksjonsfeil fra Firebase (første produksjonsskriving, #27 6525665315)", () => {
  /** Slik Firebase-SDK-et faktisk avbryter: grunnen i meldingen, ingen `code`. */
  const sdkAvbrudd = (grunn: string) => new Error(grunn);
  /** Serverstatus på SDK-formen (`errorForServerCode`): sti i meldingen, `code` i store bokstaver. */
  const serverStatus = (status: string) =>
    Object.assign(new Error(`${status} at /families/${F}: Client doesn't have permission`), {
      code: status.toUpperCase(),
    });
  const kastende = (err: unknown) => {
    const s = Object.create(store) as MemoryStore;
    s.transactFamily = async () => {
      throw err;
    };
    return s;
  };

  it.each([
    ["permission_denied", serverStatus("permission_denied"), true],
    ["too_big", serverStatus("too_big"), true],
    ["maxretry", sdkAvbrudd("maxretry"), false],
    ["set", sdkAvbrudd("set"), false],
    [
      "ugyldig_data",
      new Error("transaction failed: Data returned contains an invalid key (Fisketaco.x)"),
      true,
    ],
  ])(
    "%s, kvitteringen lest og mangler → skriving_feilet (samme opId); ingenting skrevet; logget uten melding",
    async (grunn, err, vedvarende) => {
      const inn = await endreTaco();
      const foer = tilstand();
      const e = await feil(skrivData(deps(kastende(err)), ctx, inn));
      expect(e).toMatchObject({
        code: "skriving_feilet",
        retryable: true,
        detaljer: { grunn, vedvarende },
      });
      expect(e.message).toContain("SAMME opId");
      expect(tilstand()).toBe(foer);
      const ukjent = logg.find((l) => l.event === "data_skriv_ukjent");
      expect(ukjent?.data).toMatchObject({
        opId: inn.opId,
        feilklasse: "Error",
        grunn,
        avbrudd: grunn,
      });
      expect(JSON.stringify(logg)).not.toContain("Fisketaco");
      expect(JSON.stringify(logg)).not.toContain(F);
    },
  );

  it("disconnect er IKKE sikkert: ukjent_utfall med grunn, og retry committer én gang", async () => {
    const inn = await endreTaco();
    const e = await feil(skrivData(deps(kastende(sdkAvbrudd("disconnect"))), ctx, inn));
    expect(e).toMatchObject({
      code: "ukjent_utfall",
      retryable: true,
      detaljer: { grunn: "disconnect" },
    });
    expect((await skrivData(deps(), ctx, inn)).utfall).toBe("committed");
  });

  it("en ukjent serverstatus gir annen_status, aldri statusteksten", async () => {
    const inn = await endreTaco();
    const e = await feil(
      skrivData(deps(kastende(sdkAvbrudd("Fisketaco at /families/x"))), ctx, inn),
    );
    expect(e).toMatchObject({ code: "ukjent_utfall", detaljer: { grunn: "annen_status" } });
    expect(JSON.stringify(logg)).not.toContain("Fisketaco");
  });

  it("kvitteringen vinner over feilen: avvisningsgrunn + lagret kvittering → committed", async () => {
    const inn = await endreTaco();
    store.failNextCommit("after");
    const s = Object.create(store) as MemoryStore;
    s.transactFamily = async (f: string, u: NodeUpdater) => {
      await store.transactFamily(f, u).catch(() => undefined);
      throw sdkAvbrudd("maxretry");
    };
    expect((await skrivData(deps(s), ctx, inn)).utfall).toBe("committed");
  });

  // #87-review 5714772068: et sikkert avvist forsøk beviser ikke operasjonens utfall.
  it("tidligere commit + retry avvist (permission_denied) + kvitteringslesingen feiler → ukjent_utfall, ikke «ingenting skrevet»", async () => {
    const inn = await endreTaco();
    expect((await skrivData(deps(), ctx, inn)).utfall).toBe("committed");
    const s = kastende(serverStatus("permission_denied"));
    s.lesNode = async () => {
      throw new Error("unavailable");
    };
    const e = await feil(skrivData(deps(s), ctx, inn));
    expect(e).toMatchObject({
      code: "ukjent_utfall",
      retryable: true,
      detaljer: { grunn: "permission_denied" },
    });
    expect(les("mealLibrary/m1")).toEqual({ navn: "Fisketaco" });
  });

  it("tidligere commit + retry avvist + kvitteringen lest → committed (kvitteringen vinner)", async () => {
    const inn = await endreTaco();
    await skrivData(deps(), ctx, inn);
    const etter = tilstand();
    const r = await skrivData(deps(kastende(serverStatus("permission_denied"))), ctx, inn);
    expect(r.utfall).toBe("committed");
    expect(tilstand()).toBe(etter);
  });

  it("samtidige identiske forsøk: ett avvises uten kvittering, det andre committer senere; samme opId gir replay, én skriving", async () => {
    const inn = await endreTaco();
    const e = await feil(skrivData(deps(kastende(sdkAvbrudd("maxretry"))), ctx, inn));
    expect(e).toMatchObject({ code: "skriving_feilet", retryable: true });
    // Det andre forsøket (samme opId) fullfører etter at det første svarte.
    expect((await skrivData(deps(), ctx, inn)).utfall).toBe("committed");
    const etter = tilstand();
    // Klienten bak det avviste forsøket beholder opId-et, slik feilen sier.
    expect((await skrivData(deps(), ctx, inn)).utfall).toBe("replay");
    expect(tilstand()).toBe(etter);
  });

  it("en kvittering med annet fingeravtrykk under samme opId er ikke et bekreftet fravær → ukjent_utfall", async () => {
    const inn = await endreTaco();
    await skrivData(deps(), ctx, inn);
    const annet = { ...inn, ops: [{ ...inn.ops[0]!, verdi: { navn: "Annet" } }] } as SkriveInn;
    const e = await feil(skrivData(deps(kastende(sdkAvbrudd("maxretry"))), ctx, annet));
    expect(e).toMatchObject({ code: "ukjent_utfall" });
  });

  it("feil i updateren (vår egen kode) → skriving_feilet grunn intern, ingenting skrevet", async () => {
    const inn = await endreTaco();
    const foer = tilstand();
    const s = Object.create(store) as MemoryStore;
    s.transactFamily = async (f: string, u: NodeUpdater) =>
      store.transactFamily(f, () =>
        u(
          Object.defineProperty({}, "members", {
            get() {
              throw new Error("Fisketaco");
            },
            enumerable: true,
          }),
        ),
      );
    const e = await feil(skrivData(deps(s), ctx, inn));
    expect(e).toMatchObject({
      code: "skriving_feilet",
      retryable: true,
      detaljer: { grunn: "intern", vedvarende: true },
    });
    expect(tilstand()).toBe(foer);
    expect(JSON.stringify(logg)).not.toContain("Fisketaco");
  });
});

describe("størrelsesvern mot store-en", () => {
  it("en skriving som ville krysset skrivegrensen avvises uten databaseendring", async () => {
    store.set(`families/${F}/stor`, "x".repeat(MAKS_FAMILIE_SKRIVE_BYTES - 2_000));
    const foer = tilstand();
    const e = await feil(
      skrivData(deps(), ctx, {
        opId: "2026-10-30_storrelse1",
        ops: [{ sti: "ny", type: "set", verdi: "y".repeat(5_000), forventet: MANGLER }],
      }),
    );
    expect(e).toMatchObject({ code: "for_stor", retryable: false });
    expect((e as ToolError).detaljer).toMatchObject({
      grunn: "skriving",
      grense: MAKS_FAMILIE_SKRIVE_BYTES,
    });
    expect(tilstand()).toBe(foer);
  });
});
