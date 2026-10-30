import { describe, expect, it } from "vitest";
import type { HendelseRecord, TransaksjonRecord } from "@app-types/forsoning";
import { beskrivTilstand } from "@domain/forsoning/transaksjonsoversikt";
import type { FamilyContext } from "../auth/authorize";
import { hentData } from "../data/dataSkriving";
import { versjonAv } from "../data/versjon";
import { ToolError } from "../handleliste/errors";
import { MemoryStore } from "../store/memoryStore";
import { hentOgSok, sokTransaksjoner, UgyldigSok } from "./transaksjonSok";

const tx = (o: Partial<TransaksjonRecord> & { id: string }): TransaksjonRecord => ({
  dato: "2026-09-01",
  tekst: "Tekst",
  belop: 100,
  retning: "ut",
  konto: "eivind",
  status: null,
  ...o,
});
const hendelse = (
  o: Partial<HendelseRecord> & { id: string; transaksjonId: string },
): HendelseRecord => ({
  status: "ferdig",
  paaVentAarsak: null,
  receiptId: null,
  fordelinger: [
    {
      plasseringId: "p",
      plasseringType: "budget",
      plasseringNavn: "Mat",
      belop: 100,
      eiere: [{ person: "Felles", prosent: 100 }],
    },
  ],
  dato: "2026-09-01",
  regelId: null,
  opprettet: "x",
  oppdatert: "x",
  ...o,
});

// Legacy-array-form for begge nodene, som i produksjon (ADR 0002).
const TRANSAKSJONER = [
  tx({ id: "t0", dato: "2026-09-15", tekst: "FELLESFORBUNDET kontingent", konto: "eivind" }),
  tx({ id: "t1", dato: "2026-09-20", tekst: "Skruvat AS", konto: "eivind" }),
  tx({ id: "t2", dato: "2026-09-20", tekst: "Rema 1000", konto: "helen" }),
  tx({ id: "t3", dato: "2026-08-02", tekst: "Skruvat AS", konto: null, importkilde: "DNB" }),
  tx({ id: "t4", dato: "2026-10-01", tekst: "Lønn", konto: "eivind", retning: "inn" }),
  tx({
    id: "t5",
    dato: "2026-09-05",
    tekst: "Overføring",
    konto: "eivind",
    behandlingstype: "intern_overforing",
  }),
  tx({ id: "t6", dato: "2026-09-06", tekst: "Dublett", konto: "eivind", status: "ignorert" }),
  tx({
    id: "t7",
    dato: "2026-09-07",
    tekst: "Forslag",
    konto: "eivind",
    status: "foresoatt_match",
  }),
];
const HENDELSER = [
  hendelse({ id: "h0", transaksjonId: "t0" }),
  hendelse({
    id: "h1",
    transaksjonId: "t1",
    fordelinger: [
      {
        plasseringId: "bil",
        plasseringType: "budget",
        plasseringNavn: "Bil",
        belop: 60,
        eiere: [{ person: "Eivind", prosent: 100 }],
      },
      {
        plasseringId: "hus",
        plasseringType: "budget",
        plasseringNavn: "Hus",
        belop: 40,
        eiere: [
          { person: "Felles", prosent: 50 },
          { person: "Helen", prosent: 50 },
        ],
      },
    ],
  }),
  hendelse({
    id: "h2",
    transaksjonId: "t2",
    fordelinger: [
      {
        plasseringId: "mat",
        plasseringType: "budget",
        plasseringNavn: "Mat",
        belop: 100,
        eiere: [
          { person: "Helen", prosent: 100 },
          { person: "Felles", prosent: 0 },
        ],
      },
    ],
  }),
  hendelse({ id: "h4", transaksjonId: "t4", status: "pa_vent", paaVentAarsak: "maa_avklares" }),
];
const RAA = { transaksjoner: TRANSAKSJONER, hendelser: HENDELSER };
const ider = (svar: { treff: { id: string | null }[] }) => svar.treff.map((t) => t.id);

describe("transaksjonssøk — filtre med appens semantikk", () => {
  it("uten filter: alle, nyest først, lik dato → nøkkel stigende", () => {
    const svar = sokTransaksjoner(RAA, {});
    expect(ider(svar)).toEqual(["t4", "t1", "t2", "t0", "t7", "t6", "t5", "t3"]);
    expect(svar).toMatchObject({ antallTreff: 8, neste: null });
  });

  it("konto følger normaliserKonto (også importkilde når konto mangler)", () => {
    expect(ider(sokTransaksjoner(RAA, { konto: "helen" }))).toEqual(["t2"]);
    expect(ider(sokTransaksjoner(RAA, { konto: "MC" }))).toEqual(["t3"]);
    expect(ider(sokTransaksjoner(RAA, { konto: "mc" }))).toEqual(["t3"]);
  });

  it("ansvar ligger på hendelsens fordelinger: andel > 0 i minst én fordeling; uten hendelse intet ansvar", () => {
    expect(ider(sokTransaksjoner(RAA, { ansvar: "Felles" }))).toEqual(["t4", "t1", "t0"]);
    expect(ider(sokTransaksjoner(RAA, { ansvar: "felles" }))).toEqual(["t4", "t1", "t0"]);
    // t2 har Felles 0 % — ikke ansvar.
    expect(ider(sokTransaksjoner(RAA, { ansvar: "Helen" }))).toEqual(["t1", "t2"]);
    expect(ider(sokTransaksjoner(RAA, { ansvar: "Eivind" }))).toEqual(["t1"]);
  });

  it("tekst er delstreng uten hensyn til store/små bokstaver, som kontrolloversikten", () => {
    expect(ider(sokTransaksjoner(RAA, { tekst: "fellesforbundet" }))).toEqual(["t0"]);
    expect(ider(sokTransaksjoner(RAA, { tekst: "  Skruvat " }))).toEqual(["t1", "t3"]);
  });

  it("dato er inklusiv i begge ender", () => {
    expect(ider(sokTransaksjoner(RAA, { fraDato: "2026-09-15", tilDato: "2026-09-20" }))).toEqual([
      "t1",
      "t2",
      "t0",
    ]);
  });

  it("status er kontrolloversiktens kategori (lik beskrivTilstand)", () => {
    const status = (k: Parameters<typeof sokTransaksjoner>[1]["status"]) =>
      ider(sokTransaksjoner(RAA, { status: k }));
    expect(status(["ferdig"])).toEqual(["t1", "t2", "t0"]);
    expect(status(["pa_vent"])).toEqual(["t4"]);
    expect(status(["intern", "ignorert"])).toEqual(["t6", "t5"]);
    expect(status(["forslag"])).toEqual(["t7"]);
    expect(status(["uferdig"])).toEqual(["t3"]);
    for (const t of sokTransaksjoner(RAA, {}).treff) {
      const rec = TRANSAKSJONER.find((x) => x.id === t.id)!;
      expect(t.status).toBe(
        beskrivTilstand(rec, HENDELSER, [], {
          budgetGroups: [],
          incomeGroups: [],
          sparingGroups: [],
        }).kategori,
      );
    }
  });

  it("kombinerte filtre: Eivinds konto + felles ansvar, maks fem", () => {
    const svar = sokTransaksjoner(RAA, { konto: "eivind", ansvar: "Felles", antall: 5 });
    expect(ider(svar)).toEqual(["t4", "t1", "t0"]);
    const kombinert = sokTransaksjoner(RAA, {
      konto: "eivind",
      ansvar: "Felles",
      tekst: "skruvat",
      fraDato: "2026-09-01",
      tilDato: "2026-09-30",
      status: ["ferdig"],
    });
    expect(ider(kombinert)).toEqual(["t1"]);
  });

  it("tomme treff: ingen treff, ingen markør", () => {
    expect(sokTransaksjoner(RAA, { tekst: "finnes ikke" })).toEqual({
      treff: [],
      antallTreff: 0,
      neste: null,
    });
    expect(sokTransaksjoner({ transaksjoner: null, hendelser: null }, {})).toEqual({
      treff: [],
      antallTreff: 0,
      neste: null,
    });
  });
});

describe("transaksjonssøk — treffet og grunnlaget for oppfølging", () => {
  it("gir sti og versjon for transaksjonen og hendelsen, og fordelingene med ansvar", () => {
    const [t1] = sokTransaksjoner(RAA, { tekst: "skruvat", konto: "eivind" }).treff;
    expect(t1).toEqual({
      sti: "transaksjoner/1",
      versjon: versjonAv(TRANSAKSJONER[1]),
      id: "t1",
      dato: "2026-09-20",
      tekst: "Skruvat AS",
      belop: 100,
      retning: "ut",
      konto: "eivind",
      status: "ferdig",
      hendelse: { sti: "hendelser/1", versjon: versjonAv(HENDELSER[1]) },
      fordelinger: [
        { post: "Bil", belop: 60, eiere: [{ person: "Eivind", prosent: 100 }] },
        {
          post: "Hus",
          belop: 40,
          eiere: [
            { person: "Felles", prosent: 50 },
            { person: "Helen", prosent: 50 },
          ],
        },
      ],
    });
    const [t3] = sokTransaksjoner(RAA, { konto: "MC" }).treff;
    expect(t3).toMatchObject({ sti: "transaksjoner/3", hendelse: null, fordelinger: [] });
  });

  it("objektform (ikke-array) gir nøkkelen som sti; ugyldige elementer hoppes over", () => {
    const raa = {
      transaksjoner: { abc: tx({ id: "ta" }), x: "ikke et objekt", n: null },
      hendelser: { hx: hendelse({ id: "hx", transaksjonId: "ta" }) },
    };
    expect(sokTransaksjoner(raa, {}).treff).toEqual([
      expect.objectContaining({
        sti: "transaksjoner/abc",
        hendelse: expect.objectContaining({ sti: "hendelser/hx" }),
      }),
    ]);
  });

  it("muterer ikke inndataene", () => {
    const kopi = structuredClone(RAA);
    sokTransaksjoner(RAA, { ansvar: "Felles", status: ["ferdig"] });
    expect(RAA).toEqual(kopi);
  });
});

describe("transaksjonssøk — paginering", () => {
  const mange = Array.from({ length: 12 }, (_, i) =>
    tx({ id: `m${i}`, dato: i < 6 ? "2026-09-10" : "2026-09-11" }),
  );

  it("sider dekker alle treff nøyaktig én gang; tallnøkler sorteres numerisk (2 før 10)", () => {
    const sett: string[] = [];
    let etter: string | undefined;
    for (let i = 0; i < 10; i++) {
      const s = sokTransaksjoner({ transaksjoner: mange, hendelser: [] }, { antall: 5, etter });
      sett.push(...s.treff.map((t) => t.sti));
      expect(s.antallTreff).toBe(12);
      if (!s.neste) break;
      etter = s.neste;
    }
    expect(sett).toEqual([
      ...[6, 7, 8, 9, 10, 11].map((i) => `transaksjoner/${i}`),
      ...[0, 1, 2, 3, 4, 5].map((i) => `transaksjoner/${i}`),
    ]);
  });

  // #89-review 5719520055: blandede tall-/tekstnøkler må ha total orden.
  it.each([1, 3])(
    "blandede nøkler (samme dato), antall=%i: RTDB-nøkkelorden, alle treff nøyaktig én gang, terminerer",
    (antall) => {
      const nokler = ["2", "10", "1a", "3a", "02", "9999999999", "-0", "00", "b"];
      const raa = {
        transaksjoner: Object.fromEntries(nokler.map((k) => [k, tx({ id: `id-${k}` })])),
        hendelser: [],
      };
      const sett: string[] = [];
      let etter: string | undefined;
      let sider = 0;
      for (; sider < 50; sider++) {
        const s = sokTransaksjoner(raa, { antall, etter });
        sett.push(...s.treff.map((t) => t.sti.slice("transaksjoner/".length)));
        if (!s.neste) break;
        etter = s.neste;
      }
      expect(sider).toBeLessThan(50);
      expect(sett).toEqual(["-0", "00", "2", "02", "10", "1a", "3a", "9999999999", "b"]);
    },
  );

  it("stabil når en nyere transaksjon kommer til mellom sidene: ingen dubletter, ingen hopp", () => {
    const side1 = sokTransaksjoner({ transaksjoner: mange, hendelser: [] }, { antall: 5 });
    const medNy = [...mange, tx({ id: "ny", dato: "2026-12-31" })];
    const side2 = sokTransaksjoner(
      { transaksjoner: medNy, hendelser: [] },
      { antall: 50, etter: side1.neste! },
    );
    const alle = [...side1.treff, ...side2.treff].map((t) => t.id);
    expect(new Set(alle).size).toBe(alle.length);
    expect(alle).toHaveLength(12);
    expect(alle).not.toContain("ny");
  });

  it("antall begrenses til 1–100", () => {
    const hundre = Array.from({ length: 150 }, (_, i) => tx({ id: `x${i}` }));
    expect(
      sokTransaksjoner({ transaksjoner: hundre, hendelser: [] }, { antall: 500 }).treff,
    ).toHaveLength(100);
    expect(
      sokTransaksjoner({ transaksjoner: hundre, hendelser: [] }, { antall: 0 }).treff,
    ).toHaveLength(1);
  });

  it("ugyldig markør eller dato gir UgyldigSok", () => {
    expect(() => sokTransaksjoner(RAA, { etter: "søppel" })).toThrow(UgyldigSok);
    expect(() =>
      sokTransaksjoner(RAA, { etter: Buffer.from('{"d":1}').toString("base64url") }),
    ).toThrow(UgyldigSok);
    expect(() => sokTransaksjoner(RAA, { fraDato: "15.09.2026" })).toThrow(UgyldigSok);
  });
});

describe("transaksjonssøk mot store-en", () => {
  const ctx: FamilyContext = {
    familyId: "f1",
    firebaseUid: "u1",
    idpSub: "s",
    clientId: "c",
  };

  it("leser bare egen familie, skriver ingenting, og versjonen er lik data_hent sin", async () => {
    const store = new MemoryStore();
    store.set("families/f1", {
      members: { u1: true },
      transaksjoner: TRANSAKSJONER,
      hendelser: HENDELSER,
    });
    store.set("families/f2", {
      members: { u2: true },
      transaksjoner: [tx({ id: "annen", tekst: "Skruvat" })],
    });
    const foer = JSON.stringify(store.get(""));
    const svar = await hentOgSok(store, ctx, { tekst: "skruvat" });
    expect(ider(svar)).toEqual(["t1", "t3"]);
    expect(JSON.stringify(store.get(""))).toBe(foer);
    for (const t of svar.treff) {
      expect((await hentData(store, ctx, t.sti)).versjon).toBe(t.versjon);
    }
    const hendelseSti = svar.treff[0]!.hendelse!.sti;
    expect((await hentData(store, ctx, hendelseSti)).versjon).toBe(
      svar.treff[0]!.hendelse!.versjon,
    );
  });

  it("ugyldig input blir ToolError ugyldig_sok (ikke internal_error)", async () => {
    const store = new MemoryStore();
    store.set("families/f1", { members: { u1: true } });
    await expect(hentOgSok(store, ctx, { tilDato: "i går" })).rejects.toMatchObject({
      code: "ugyldig_sok",
      retryable: false,
    });
    await expect(hentOgSok(store, ctx, { etter: "x" })).rejects.toBeInstanceOf(ToolError);
  });
});
