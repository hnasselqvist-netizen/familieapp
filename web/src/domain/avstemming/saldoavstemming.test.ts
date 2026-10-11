/**
 * Saldoavstemming (#59): Helens logikk per konto og kalendermåned —
 * saldo 31.08 + septembertransaksjoner = beregnet 30.09, mot faktisk 30.09.
 */
import { describe, expect, it } from "vitest";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { TransaksjonRecord } from "@app-types/forsoning";
import {
  avstemmingsmaaneder,
  avstemmingsoversikt,
  byggSaldoKontroll,
  foersteAvstemmingsmaaned,
  forrigeMaaned,
  fraVisningsSaldo,
  inngaarISaldo,
  kontoerIAvstemming,
  MAKS_MAANEDER,
  maanederFra,
  maanedskontroll,
  maanedsgrunnlag,
  nesteMaaned,
  saldoRolle,
  sisteAvsluttedeMaaned,
  sisteDagIMaaned,
  tilVisningsSaldo,
  vurderKontoMaaned,
} from "./saldoavstemming";

const NAA = "2026-10-08T12:00:00.000Z";

let n = 0;
const tx = (o: Partial<TransaksjonRecord>): TransaksjonRecord => ({
  id: `t${++n}`,
  dato: "2026-09-15",
  tekst: "REMA 1000",
  belop: 100,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...o,
});

const kontroll = (konto: string, maaned: string, faktiskSaldo: number): SaldoKontroll => ({
  konto,
  maaned,
  dato: sisteDagIMaaned(maaned),
  faktiskSaldo,
  registrert: NAA,
  oppdatert: NAA,
});

describe("datoer og måneder", () => {
  it("forrige måned, siste dag og siste avsluttede måned", () => {
    expect(forrigeMaaned("2026-01")).toBe("2025-12");
    expect(forrigeMaaned("2026-10")).toBe("2026-09");
    expect(sisteDagIMaaned("2026-09")).toBe("2026-09-30");
    expect(sisteDagIMaaned("2026-02")).toBe("2026-02-28");
    expect(sisteDagIMaaned("2028-02")).toBe("2028-02-29");
    expect(sisteAvsluttedeMaaned(new Date(2026, 9, 8))).toBe("2026-09");
    expect(sisteAvsluttedeMaaned(new Date(2026, 0, 3))).toBe("2025-12");
    expect(avstemmingsmaaneder(new Date(2026, 9, 8), 3)).toEqual(["2026-09", "2026-08", "2026-07"]);
  });
});

describe("månedsgrunnlaget: fortegn, konto og hva som teller", () => {
  it("netto = inn − ut i hele øre, bare for kontoen og måneden", () => {
    const trans = [
      tx({ belop: 100.1, retning: "ut" }),
      tx({ belop: 0.2, retning: "ut" }),
      tx({ belop: 42000, retning: "inn", tekst: "LØNN" }),
      tx({ belop: 999, konto: "Helen" }),
      tx({ belop: 999, dato: "2026-10-01" }),
      tx({ belop: 999, dato: "2026-08-31" }),
    ];
    const g = maanedsgrunnlag(trans, "felleskonto", "2026-09");
    expect(g.antall).toBe(3);
    expect(g.innOre).toBe(4_200_000);
    expect(g.utOre).toBe(10_030); // 100,10 + 0,20 uten flyttallsfeil
    expect(g.nettoOre).toBe(4_189_970);
  });

  it("interne overføringer teller i saldo", () => {
    const g = maanedsgrunnlag(
      [tx({ belop: 5000, retning: "ut", behandlingstype: "intern_overforing" })],
      "felleskonto",
      "2026-09",
    );
    expect(g.nettoOre).toBe(-500_000);
    expect(inngaarISaldo({ dato: "" })).toBe(false);
  });

  it("ignorerte (6062856860): bankbevegelse teller, dublett teller ikke, uavklart holdes utenfor og flagges", () => {
    expect(saldoRolle({ status: "ny" })).toBe("teller");
    expect(saldoRolle({ status: "ignorert", ignorertSom: "bankbevegelse" })).toBe("teller");
    expect(saldoRolle({ status: "ignorert", ignorertSom: "dublett" })).toBe("dublett");
    expect(saldoRolle({ status: "ignorert" })).toBe("uavklart");
    // ignorertSom på en ikke-ignorert transaksjon endrer ingenting.
    expect(saldoRolle({ status: "ny", ignorertSom: "dublett" })).toBe("teller");

    const g = maanedsgrunnlag(
      [
        tx({ belop: 100 }),
        tx({ belop: 200, status: "ignorert", ignorertSom: "bankbevegelse" }),
        tx({ belop: 300, status: "ignorert", ignorertSom: "dublett" }),
        tx({ belop: 400, status: "ignorert" }),
      ],
      "felleskonto",
      "2026-09",
    );
    expect(g.antall).toBe(4);
    expect(g.nettoOre).toBe(-30_000);
    expect(g.dubletter).toEqual({ antall: 1, nettoOre: -30_000 });
    expect(g.uavklarte).toMatchObject({ antall: 1, nettoOre: -40_000 });
  });

  it("flagger mulige dubletter og bevegelser ved månedsskiftet som forklaringer", () => {
    const trans = [
      tx({ dato: "2026-09-10", belop: 49, tekst: "KAFFE" }),
      tx({ dato: "2026-09-10", belop: 49, tekst: "KAFFE OSLO" }),
      tx({ dato: "2026-09-01", belop: 10 }),
      tx({ dato: "2026-09-29", belop: 10 }),
      tx({ dato: "2026-09-15", belop: 10 }),
    ];
    const g = maanedsgrunnlag(trans, "felleskonto", "2026-09");
    expect(g.muligeDubletter).toHaveLength(1);
    expect(g.muligeDubletter[0]).toHaveLength(2);
    expect(g.vedMaanedsskiftet.map((t) => t.dato)).toEqual(["2026-09-01", "2026-09-29"]);
  });
});

describe("Helens regnestykke: 31.08 + september = beregnet 30.09 mot faktisk 30.09", () => {
  const sept = [
    tx({ belop: 42000, retning: "inn" }),
    tx({ belop: 12500.5, retning: "ut" }),
    tx({ belop: 499.5, retning: "ut" }),
  ];

  it("avstemt når differansen er 0 i øre", () => {
    const v = vurderKontoMaaned(
      sept,
      [kontroll("felleskonto", "2026-08", 10000), kontroll("felleskonto", "2026-09", 39000)],
      "felleskonto",
      "2026-09",
    );
    expect(v.forrigeSaldoOre).toBe(1_000_000);
    expect(v.grunnlag.nettoOre).toBe(2_900_000);
    expect(v.beregnetOre).toBe(3_900_000);
    expect(v.differanseOre).toBe(0);
    expect(v.status).toBe("avstemt");
  });

  it("avvik i begge retninger vises med fortegn", () => {
    const mer = vurderKontoMaaned(
      sept,
      [kontroll("felleskonto", "2026-08", 10000), kontroll("felleskonto", "2026-09", 40240)],
      "felleskonto",
      "2026-09",
    );
    expect(mer).toMatchObject({ status: "avvik", differanseOre: 124_000 });
    const mindre = vurderKontoMaaned(
      sept,
      [kontroll("felleskonto", "2026-08", 10000), kontroll("felleskonto", "2026-09", 38999.99)],
      "felleskonto",
      "2026-09",
    );
    expect(mindre).toMatchObject({ status: "avvik", differanseOre: -1 });
  });

  it("første saldo er et startpunkt — å registrere saldo gir aldri «avstemt»", () => {
    const v = vurderKontoMaaned(
      sept,
      [kontroll("felleskonto", "2026-09", 39000)],
      "felleskonto",
      "2026-09",
    );
    expect(v).toMatchObject({
      status: "startpunkt",
      beregnetOre: null,
      differanseOre: null,
    });
    expect(vurderKontoMaaned(sept, [], "felleskonto", "2026-09").status).toBe("ingen_saldo");
  });

  it("neste måned bygger på forrige måneds FAKTISKE saldo, så et avvik forplanter seg ikke", () => {
    const okt = [tx({ dato: "2026-10-05", belop: 1000, retning: "ut" })];
    const kontroller = [
      kontroll("felleskonto", "2026-08", 10000),
      kontroll("felleskonto", "2026-09", 40240), // avvik på +1 240 i september
      kontroll("felleskonto", "2026-10", 39240),
    ];
    expect(vurderKontoMaaned(sept, kontroller, "felleskonto", "2026-09").status).toBe("avvik");
    expect(
      vurderKontoMaaned([...sept, ...okt], kontroller, "felleskonto", "2026-10"),
    ).toMatchObject({ status: "avstemt", differanseOre: 0 });
  });

  it("et hull i kjeden gjør neste registrerte måned til et nytt startpunkt", () => {
    const v = vurderKontoMaaned(
      sept,
      [kontroll("felleskonto", "2026-07", 1), kontroll("felleskonto", "2026-09", 39000)],
      "felleskonto",
      "2026-09",
    );
    expect(v.status).toBe("startpunkt");
  });
});

describe("ignorerte uten avklaring gjør måneden usikker (6062856860)", () => {
  const kontroller = [
    kontroll("felleskonto", "2026-08", 1000),
    kontroll("felleskonto", "2026-09", 900),
  ];

  it("en 0-differanse er ikke et bevis når en ignorert linje er uavklart", () => {
    // 1000 − 100 = 900 stemmer HVIS den ignorerte 49-kroneren er en dublett.
    const trans = [tx({ belop: 100 }), tx({ belop: 49, status: "ignorert" })];
    const v = vurderKontoMaaned(trans, kontroller, "felleskonto", "2026-09");
    expect(v).toMatchObject({
      status: "usikker",
      differanseOre: 0,
      differanseMedUavklarteOre: 4_900,
    });
  });

  it("heller ikke et sikkert avvik — begge tolkninger vises", () => {
    const trans = [tx({ belop: 51 }), tx({ belop: 49, status: "ignorert" })];
    const v = vurderKontoMaaned(trans, kontroller, "felleskonto", "2026-09");
    expect(v).toMatchObject({
      status: "usikker",
      differanseOre: -4_900,
      differanseMedUavklarteOre: 0,
    });
  });

  it("Helens avklaring avgjør: dublett gir avstemt, ekte bevegelse gir avvik", () => {
    const som = (ignorertSom: "dublett" | "bankbevegelse") => [
      tx({ belop: 100 }),
      tx({ belop: 49, status: "ignorert", ignorertSom }),
    ];
    expect(vurderKontoMaaned(som("dublett"), kontroller, "felleskonto", "2026-09")).toMatchObject({
      status: "avstemt",
      differanseMedUavklarteOre: null,
    });
    expect(
      vurderKontoMaaned(som("bankbevegelse"), kontroller, "felleskonto", "2026-09"),
    ).toMatchObject({ status: "avvik", differanseOre: 4_900 });
  });

  it("startpunkt og manglende saldo påvirkes ikke av uavklarte", () => {
    const trans = [tx({ belop: 49, status: "ignorert" })];
    expect(
      vurderKontoMaaned(trans, [kontroll("felleskonto", "2026-09", 1)], "felleskonto", "2026-09")
        .status,
    ).toBe("startpunkt");
    expect(vurderKontoMaaned(trans, [], "felleskonto", "2026-09").status).toBe("ingen_saldo");
  });

  it("månedskontrollen teller usikre separat, aldri som avstemte", () => {
    const trans = [tx({ belop: 100 }), tx({ belop: 49, status: "ignorert" })];
    const o = avstemmingsoversikt(trans, kontroller, new Date(2026, 9, 8), 2);
    expect(maanedskontroll(o, "2026-09")).toEqual({
      maaned: "2026-09",
      avstemte: 0,
      totalt: 1,
      avvik: 0,
      usikre: 1,
    });
  });
});

describe("etterimport revurderer statusen", () => {
  it("en etterimportert septembertransaksjon snur «avstemt» til «avvik», og viser at grunnlaget er endret", () => {
    const sept = [tx({ belop: 1000, retning: "ut" })];
    const aug = kontroll("felleskonto", "2026-08", 5000);
    const lagret = byggSaldoKontroll(sept, null, "felleskonto", "2026-09", 4000, NAA);
    expect(lagret).toMatchObject({
      dato: "2026-09-30",
      faktiskSaldo: 4000,
      grunnlag: { antall: 1, nettoOre: -100_000 },
    });
    const for_ = vurderKontoMaaned(sept, [aug, lagret], "felleskonto", "2026-09");
    expect(for_).toMatchObject({ status: "avstemt", grunnlagEndret: false });

    const etter = [...sept, tx({ belop: 250, retning: "ut", dato: "2026-09-20" })];
    const v = vurderKontoMaaned(etter, [aug, lagret], "felleskonto", "2026-09");
    expect(v).toMatchObject({
      status: "avvik",
      differanseOre: 25_000,
      grunnlagEndret: true,
      endringAntall: 1,
    });
  });

  it("en etterimport som fyller et hull, kan gjøre et avvik avstemt", () => {
    const sept = [tx({ belop: 1000, retning: "ut" })];
    const kontroller = [
      kontroll("felleskonto", "2026-08", 5000),
      kontroll("felleskonto", "2026-09", 3750),
    ];
    expect(vurderKontoMaaned(sept, kontroller, "felleskonto", "2026-09").status).toBe("avvik");
    const etter = [...sept, tx({ belop: 250, retning: "ut", dato: "2026-09-29" })];
    expect(vurderKontoMaaned(etter, kontroller, "felleskonto", "2026-09").status).toBe("avstemt");
  });

  it("å lagre på nytt beholder første registreringstidspunkt", () => {
    const forste = byggSaldoKontroll([], null, "felleskonto", "2026-09", 1, "2026-10-01T00:00:00Z");
    const ny = byggSaldoKontroll([], forste, "felleskonto", "2026-09", 2, NAA);
    expect(ny).toMatchObject({
      registrert: "2026-10-01T00:00:00Z",
      oppdatert: NAA,
      faktiskSaldo: 2,
    });
  });
});

describe("MC: kredittkortsaldo som gjeld", () => {
  it("kjøp øker gjelden, «Innbetaling» reduserer den — samme regnestykke", () => {
    const mc = [
      tx({ konto: "MC", importkilde: "dnb", belop: 3000, retning: "ut", tekst: "KIWI" }),
      tx({ konto: "MC", importkilde: "dnb", belop: 7000, retning: "inn", tekst: "Innbetaling" }),
    ];
    // Skyldig 7 000 per 31.08 → −7 000; +3 000 kjøp, −7 000 innbetalt → skyldig 3 000 per 30.09.
    const v = vurderKontoMaaned(
      mc,
      [
        kontroll("MC", "2026-08", fraVisningsSaldo("MC", 7000)),
        kontroll("MC", "2026-09", fraVisningsSaldo("MC", 3000)),
      ],
      "MC",
      "2026-09",
    );
    expect(v).toMatchObject({ status: "avstemt", beregnetOre: -300_000 });
    expect(tilVisningsSaldo("MC", -3000)).toBe(3000);
    expect(fraVisningsSaldo("felleskonto", 3000)).toBe(3000);
  });

  it("DNB-transaksjoner uten kontofelt henføres til MC via importkilden", () => {
    const g = maanedsgrunnlag(
      [tx({ konto: null, importkilde: "dnb", belop: 10 })],
      "MC",
      "2026-09",
    );
    expect(g.antall).toBe(1);
  });
});

describe("oversikten: kontoer og måneder som er klare", () => {
  it("viser kontoer med bevegelser eller kontrollpunkter, og teller ukjent konto separat", () => {
    const trans = [
      tx({ konto: "Helen" }),
      tx({ konto: "MC" }),
      tx({ konto: null }), // eldre transaksjon uten konto
      tx({ dato: "2026-08-10" }),
    ];
    expect(kontoerIAvstemming(trans, [kontroll("eivind", "2026-09", 1)])).toEqual([
      "MC",
      "eivind",
      "felleskonto",
      "helen",
    ]);
    const o = avstemmingsoversikt(trans, [], new Date(2026, 9, 8), 2);
    expect(o.maaneder).toEqual(["2026-09", "2026-08"]);
    expect(o.ukjentKonto).toEqual({ "2026-09": 1, "2026-08": 0 });
    expect(o.celler.helen!["2026-09"]!.status).toBe("ingen_saldo");
  });

  it("månedskontrollen teller avstemte av kontoene som er i bruk i måneden", () => {
    const trans = [tx({ konto: "Felleskonto" }), tx({ konto: "Helen" })];
    const kontroller = [
      kontroll("felleskonto", "2026-08", 1000),
      kontroll("felleskonto", "2026-09", 900),
      kontroll("helen", "2026-08", 1000),
      kontroll("helen", "2026-09", 1),
      kontroll("eivind", "2026-07", 5), // ingen bevegelse og ingen saldo i september
    ];
    const o = avstemmingsoversikt(trans, kontroller, new Date(2026, 9, 8), 3);
    expect(maanedskontroll(o, "2026-09")).toEqual({
      maaned: "2026-09",
      avstemte: 1,
      totalt: 2,
      avvik: 1,
      usikre: 0,
    });
  });
});

describe("historiske måneder (6097132388)", () => {
  const IDAG = new Date(2026, 9, 10);

  it("nesteMaaned krysser årsskiftet", () => {
    expect(nesteMaaned("2025-12")).toBe("2026-01");
    expect(nesteMaaned("2026-01")).toBe("2026-02");
  });

  it("starter minst i januar inneværende år, selv uten data", () => {
    expect(foersteAvstemmingsmaaned([], [], IDAG)).toBe("2026-01");
    expect(maanederFra("2026-01", IDAG)).toHaveLength(9);
  });

  it("startsaldo 31.12.2025 gir januar 2026; eldre transaksjoner trekker visningen bakover", () => {
    expect(foersteAvstemmingsmaaned([], [kontroll("felleskonto", "2025-12", 8000)], IDAG)).toBe(
      "2026-01",
    );
    expect(foersteAvstemmingsmaaned([], [kontroll("felleskonto", "2025-06", 8000)], IDAG)).toBe(
      "2025-07",
    );
    expect(foersteAvstemmingsmaaned([tx({ dato: "2025-03-04" })], [], IDAG)).toBe("2025-03");
  });

  it("januar 2026 bygger på kontrollpunktet for desember 2025, over årsskiftet", () => {
    const trans = [tx({ dato: "2026-01-10", belop: 500 })];
    const kontroller = [
      kontroll("felleskonto", "2025-12", 8000),
      kontroll("felleskonto", "2026-01", 7500),
    ];
    const o = avstemmingsoversikt(trans, kontroller, IDAG);
    expect(o.maaneder[o.maaneder.length - 1]).toBe("2026-01");
    expect(o.celler.felleskonto!["2026-01"]).toMatchObject({
      status: "avstemt",
      forrigeSaldoOre: 800_000,
    });
    // Senere måneder er fortsatt med, nyeste først.
    expect(o.maaneder[0]).toBe("2026-09");
  });

  it("feildaterte rader kan ikke gi en uendelig liste", () => {
    expect(maanederFra("1900-01", IDAG)).toHaveLength(MAKS_MAANEDER);
  });
});
