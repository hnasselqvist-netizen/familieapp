import { describe, expect, it } from "vitest";
import type {
  Fordeling,
  HendelseRecord,
  KvitteringRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import {
  STANDARD_SORTERING,
  TOMT_FILTER,
  UTEN_EIER,
  filterValg,
  filtrerKontrollrader,
  kontrollrader,
  sorterKontrollrader,
  summerUtvalg,
  tilOre,
} from "./kontrollrader";

/** Syntetiske data — aldri ekte transaksjoner. */
const t = (id: string, o: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "TEKST " + id,
  belop: 100,
  retning: "ut",
  konto: "felleskonto",
  status: "ny",
  ...o,
});
const f = (o: Partial<Fordeling>): Fordeling => ({
  plasseringId: "p-parkering",
  plasseringType: "budget",
  plasseringNavn: "Parkering",
  belop: 100,
  eiere: [{ person: "Felles", prosent: 100 }],
  ...o,
});
const h = (id: string, transaksjonId: string, o: Partial<HendelseRecord> = {}): HendelseRecord => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId,
  receiptId: null,
  fordelinger: [f({})],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "",
  oppdatert: "",
  ...o,
});
const grupper = {
  budgetGroups: [
    { id: "g", label: "Bil", items: [{ id: "p-parkering", name: "Parkering", months: [] }] },
  ],
  incomeGroups: [],
  sparingGroups: [],
} as unknown as Parameters<typeof kontrollrader>[4];

const transaksjoner = [
  // EasyPark på privatkonto, men kostnaden er felles: konto ≠ kostnadseier.
  t("ep1", { tekst: "EASYPARK", belop: 123.45, konto: "helen", dato: "2026-09-12" }),
  // EasyPark på felleskonto, splittet 50/50 Helen/Eivind på to poster.
  t("ep2", { tekst: "EasyPark AS", belop: 80, konto: "felleskonto", dato: "2026-09-12" }),
  // Inntekt, uten hendelse.
  t("lonn", { tekst: "LØNN", belop: 30000, retning: "inn", dato: "2026-08-25" }),
  t("ign", { tekst: "GEBYR", belop: 0.1, status: "ignorert", dato: "2026-09-01" }),
];
const hendelser = [
  h("h1", "ep1", { fordelinger: [f({ belop: 123.45 })] }),
  h("h2", "ep2", {
    fordelinger: [
      f({
        belop: 60,
        eiere: [
          { person: "Helen", prosent: 50 },
          { person: "Eivind", prosent: 50 },
        ],
      }),
      f({
        plasseringId: "p-annet",
        plasseringNavn: "Annet",
        belop: 20,
        eiere: [
          { person: "Eivind", prosent: 100 },
          { person: "Helen", prosent: 0 },
        ],
      }),
    ],
    receiptId: "k1",
  }),
];
const receipts = [{ id: "k1", total: 80 }] as unknown as KvitteringRecord[];
const rader = kontrollrader(transaksjoner, hendelser, receipts, [], grupper);
const r = (id: string) => rader.find((x) => x.id === id)!;

describe("kontrollrader", () => {
  it("eksakt beløp i øre med fortegn fra retning", () => {
    expect(r("ep1").belopOre).toBe(-12345);
    expect(r("lonn").belopOre).toBe(3000000);
    expect(r("ign").belopOre).toBe(-10);
    expect(tilOre(0.1 + 0.2)).toBe(30);
    expect(tilOre("12")).toBe(0);
  });

  it("konto er hvor pengene gikk; kostnadseier kommer fra hendelsens fordelinger", () => {
    expect(r("ep1")).toMatchObject({ konto: "helen", eiere: ["Felles"] });
    expect(r("ep1").fordelinger[0]).toMatchObject({
      postTekst: "Kostnad → Bil / Parkering",
      belopOre: 12345,
    });
  });

  it("splitt vises per fordeling; andel 0 regnes ikke som eier", () => {
    expect(r("ep2").fordelinger.map((x) => [x.belopOre, x.eiere])).toEqual([
      [
        6000,
        [
          { person: "Helen", prosent: 50 },
          { person: "Eivind", prosent: 50 },
        ],
      ],
      [2000, [{ person: "Eivind", prosent: 100 }]],
    ]);
    expect(r("ep2").eiere).toEqual(["Helen", "Eivind"]);
    expect(r("ep2").kvittering).toBe("koblet");
  });

  it("uten hendelse: ingen fordeling, ingen eier, ikke korrigerbar", () => {
    expect(r("lonn")).toMatchObject({
      fordelinger: [],
      eiere: [],
      hendelseId: null,
      kanKorrigeres: false,
    });
    expect(r("ep1")).toMatchObject({ hendelseId: "h1", kanKorrigeres: true, kategori: "ferdig" });
    expect(r("ign").kategori).toBe("ignorert");
  });
});

describe("filtrerKontrollrader", () => {
  const ids = (f2: Partial<typeof TOMT_FILTER>) =>
    filtrerKontrollrader(rader, { ...TOMT_FILTER, ...f2 })
      .map((x) => x.id)
      .sort();

  it("kombinerte filtre: EasyPark på tvers av konto og eier", () => {
    expect(ids({ sok: "easypark" })).toEqual(["ep1", "ep2"]);
    expect(ids({ sok: "easypark", eier: "eivind" })).toEqual(["ep2"]);
    expect(ids({ sok: "easypark", eier: "Felles" })).toEqual(["ep1"]);
    expect(ids({ sok: "easypark", konto: "helen" })).toEqual(["ep1"]);
    expect(ids({ post: "p-annet" })).toEqual(["ep2"]);
    expect(ids({ eier: UTEN_EIER })).toEqual(["ign", "lonn"]);
    expect(ids({ status: "ignorert" })).toEqual(["ign"]);
    expect(ids({ maaned: "2026-08" })).toEqual(["lonn"]);
    expect(ids({ sok: "  EASY ", maaned: "2026-08" })).toEqual([]);
  });
});

describe("sorterKontrollrader", () => {
  it("standard er nyeste først med id som entydig skille", () => {
    expect(sorterKontrollrader(rader, STANDARD_SORTERING).map((x) => x.id)).toEqual([
      "ep1",
      "ep2",
      "ign",
      "lonn",
    ]);
  });

  it("beløp stigende = største utgift først; ordenen er total og stabil", () => {
    const opp = sorterKontrollrader(rader, { kolonne: "belop", synkende: false }).map((x) => x.id);
    expect(opp).toEqual(["ep1", "ep2", "ign", "lonn"]);
    expect(
      sorterKontrollrader([...rader].reverse(), { kolonne: "belop", synkende: false }).map(
        (x) => x.id,
      ),
    ).toEqual(opp);
  });

  it("tomme verdier havner sist i begge retninger", () => {
    for (const synkende of [true, false]) {
      const ut = sorterKontrollrader(rader, { kolonne: "post", synkende }).map((x) => x.id);
      expect(ut.slice(-2).sort()).toEqual(["ign", "lonn"]);
    }
  });
});

describe("summerUtvalg og filterValg", () => {
  it("antall og inn/ut/netto i øre med riktig fortegn", () => {
    expect(summerUtvalg(rader)).toEqual({
      antall: 4,
      innOre: 3000000,
      utOre: 12345 + 8000 + 10,
      nettoOre: 3000000 - 20355,
    });
    expect(summerUtvalg([])).toEqual({ antall: 0, innOre: 0, utOre: 0, nettoOre: 0 });
  });

  it("valgene kommer fra dataene", () => {
    expect(filterValg(rader)).toEqual({
      eiere: ["Eivind", "Felles", "Helen"],
      poster: [
        { id: "p-annet", navn: "Kostnad → Annet" },
        { id: "p-parkering", navn: "Kostnad → Bil / Parkering" },
      ],
    });
  });
});

describe("kontrollrader — kvalitetssikret (#59, 6542594363)", () => {
  const grunnlag = (id: string) => rader.find((x) => x.id === id)!.kontroll.grunnlag;
  const kontroller = new Map([
    [
      "ep1",
      {
        transaksjonId: "ep1",
        gjeldende: { grunnlag: grunnlag("ep1"), versjon: 1, tid: "t", av: "u", avNavn: "Helen" },
        spor: {},
      },
    ],
    [
      "ep2",
      {
        transaksjonId: "ep2",
        gjeldende: {
          grunnlag: "et-eldre-grunnlag",
          versjon: 1,
          tid: "t",
          av: "u",
          avNavn: "Helen",
        },
        spor: {},
      },
    ],
  ]);
  const medKontroll = kontrollrader(transaksjoner, hendelser, receipts, [], grupper, kontroller);

  it("status avledes per stabil transaksjons-ID", () => {
    expect(Object.fromEntries(medKontroll.map((x) => [x.id, x.kontroll.status]))).toEqual({
      ep1: "kvalitetssikret",
      ep2: "endret_etter_kontroll",
      lonn: "ikke_kontrollert",
      ign: "ikke_kontrollert",
    });
  });

  it("filter på kontrollstatus kombineres med de andre filtrene", () => {
    const ids = (k: string, sok = "") =>
      filtrerKontrollrader(medKontroll, { ...TOMT_FILTER, kontroll: k, sok }).map((x) => x.id);
    expect(ids("ikke_kontrollert").sort()).toEqual(["ign", "lonn"]);
    expect(ids("kvalitetssikret", "easypark")).toEqual(["ep1"]);
    expect(ids("endret_etter_kontroll")).toEqual(["ep2"]);
  });

  it("kontroller påvirker verken økonomi, sum, fordeling eller behandlingsstatus", () => {
    const uten = (r: (typeof rader)[number]) => ({ ...r, kontroll: null });
    expect(medKontroll.map(uten)).toEqual(rader.map(uten));
    expect(summerUtvalg(medKontroll)).toEqual(summerUtvalg(rader));
    expect(medKontroll.find((x) => x.id === "ep1")!.kategori).toBe("ferdig");
  });
});
