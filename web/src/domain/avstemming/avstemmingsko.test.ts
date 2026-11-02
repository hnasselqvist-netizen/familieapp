/**
 * Felles avledet avstemmingsmodell (#59, AV-1). Rader, problemer og status
 * utledes av de eksisterende vurderingene; ingenting lagres.
 */
import { describe, expect, it } from "vitest";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { TransaksjonRecord } from "@app-types/forsoning";
import {
  type Avstemmingsmodell,
  avstemmingsmodell,
  maanedsstatus,
  nesteKonto,
  saldoSomMangler,
} from "./avstemmingsko";
import { avstemmingsoversikt, sisteDagIMaaned } from "./saldoavstemming";
import { kildeavtrykk, leggTilForventetMotpost } from "./saldokorrigering";

const IDAG = new Date(2026, 9, 8); // siste avsluttede måned: 2026-09
const NAA = "2026-10-08T12:00:00.000Z";
const KONFIGURERT = ["MC", "regningskonto", "felleskonto", "helen", "eivind", "krav"];

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
const kontroll = (
  konto: string,
  maaned: string,
  faktiskSaldo: number,
  grunnlag?: SaldoKontroll["grunnlag"],
): SaldoKontroll => ({
  konto,
  maaned,
  dato: sisteDagIMaaned(maaned),
  faktiskSaldo,
  registrert: NAA,
  oppdatert: NAA,
  ...(grunnlag ? { grunnlag } : {}),
});

function modell(
  t: TransaksjonRecord[],
  k: SaldoKontroll[],
  fra = "2026-07",
  konfigurerte: string[] = KONFIGURERT,
): Avstemmingsmodell {
  return avstemmingsmodell(avstemmingsoversikt(t, k, IDAG, { fra }), t, konfigurerte);
}
const rad = (m: Avstemmingsmodell, maaned: string, konto: string) =>
  m.rader[maaned]!.find((r) => r.konto === konto)!;
const typer = (m: Avstemmingsmodell, maaned: string, konto: string) =>
  rad(m, maaned, konto).problemer.map((p) => p.type);

describe("avstemmingsmodell: rader og tall", () => {
  it("bygger på vurderingen: inngående, inn, ut, beregnet, faktisk og differanse i øre", () => {
    const m = modell(
      [
        tx({ dato: "2026-09-05", belop: 42000.5, retning: "inn" }),
        tx({ dato: "2026-09-12", belop: 2000.25 }),
      ],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", 41000.25)],
    );
    expect(rad(m, "2026-09", "felleskonto")).toMatchObject({
      fase: "aktiv",
      status: "avstemt",
      inngaaendeOre: 100_000,
      innOre: 4_200_050,
      utOre: 200_025,
      avledetOre: 0,
      beregnetOre: 4_100_025,
      faktiskOre: 4_100_025,
      differanseOre: 0,
      problemer: [],
      ok: true,
    });
  });

  it("MC: gjeld er negativ saldo, kjøp øker gjelden og innbetaling reduserer den", () => {
    const m = modell(
      [
        tx({ konto: "MC", dato: "2026-09-14", belop: 3000 }),
        tx({ konto: "MC", dato: "2026-09-20", belop: 7000, retning: "inn" }),
      ],
      [kontroll("MC", "2026-08", -7000), kontroll("MC", "2026-09", -3100)],
    );
    const r = rad(m, "2026-09", "MC");
    expect(r).toMatchObject({
      inngaaendeOre: -700_000,
      innOre: 700_000,
      utOre: 300_000,
      beregnetOre: -300_000,
      faktiskOre: -310_000,
      // Mer gjeld enn beregnet = mindre i banken.
      differanseOre: -10_000,
      status: "avvik",
    });
    expect(r.problemer).toEqual([
      { type: "avvik", konto: "MC", maaned: "2026-09", belopOre: -10_000 },
    ]);
    expect(m.kontoer[0]).toBe("MC");
  });

  it("manglende verdier er null, aldri 0", () => {
    const m = modell([tx({ dato: "2026-09-05" })], [kontroll("felleskonto", "2026-09", 500)]);
    expect(rad(m, "2026-09", "felleskonto")).toMatchObject({
      fase: "start",
      status: "startpunkt",
      inngaaendeOre: null,
      beregnetOre: null,
      faktiskOre: 50_000,
      differanseOre: null,
    });
  });

  it("periode: bare avsluttede måneder; inneværende og fremtidige er aldri med", () => {
    const m = modell(
      [tx({ dato: "2026-10-02" }), tx({ dato: "2026-12-24" }), tx({ dato: "2026-09-02" })],
      [],
    );
    expect(m.maaneder).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(m.problemer.every((p) => p.maaned <= "2026-09")).toBe(true);
  });
});

describe("avstemmingsmodell: kontoer uten saldo eller bevegelser (6542342933)", () => {
  it("kjent konto uten saldo og startpunkt: mangler saldo fra første bevegelse, hver måned", () => {
    const m = modell([tx({ konto: "helen", dato: "2026-08-03" })], []);
    expect(rad(m, "2026-07", "helen").fase).toBe("foer_start");
    expect(typer(m, "2026-07", "helen")).toEqual([]);
    // Ingen bevegelser i september — fortsatt ikke ferdig.
    expect(rad(m, "2026-09", "helen")).toMatchObject({ fase: "aktiv", ok: false });
    expect(typer(m, "2026-08", "helen")).toEqual(["mangler_saldo"]);
    expect(typer(m, "2026-09", "helen")).toEqual(["mangler_saldo"]);
    expect(saldoSomMangler(rad(m, "2026-09", "helen"))).toBe("2026-09");
  });

  it("konto med startsaldo og en senere måned uten bevegelser: krever saldo, ikke ferdig", () => {
    const m = modell(
      [tx({ dato: "2026-08-03" })],
      [kontroll("felleskonto", "2026-06", 1000), kontroll("felleskonto", "2026-08", 900)],
    );
    expect(rad(m, "2026-08", "felleskonto").status).toBe("startpunkt");
    // Juli: ingen bevegelser, ingen saldo — men kontoen er i gang.
    expect(rad(m, "2026-07", "felleskonto")).toMatchObject({
      fase: "aktiv",
      status: "ingen_saldo",
      inngaaendeOre: 100_000,
    });
    expect(typer(m, "2026-07", "felleskonto")).toEqual(["mangler_saldo"]);
    expect(typer(m, "2026-08", "felleskonto")).toEqual(["startpunkt"]);
    expect(saldoSomMangler(rad(m, "2026-08", "felleskonto"))).toBe("2026-07");
    expect(typer(m, "2026-09", "felleskonto")).toEqual(["mangler_saldo"]);
  });

  it("første registrerte saldo i perioden er startsaldo: ikke avstemt, ikke et problem", () => {
    const m = modell(
      [tx({ dato: "2026-08-03" }), tx({ dato: "2026-09-03" })],
      [kontroll("felleskonto", "2026-07", 1000), kontroll("felleskonto", "2026-08", 900)],
      "2026-07",
      [],
    );
    expect(rad(m, "2026-07", "felleskonto")).toMatchObject({
      fase: "start",
      status: "startpunkt",
      ok: false,
      problemer: [],
    });
    expect(rad(m, "2026-08", "felleskonto").ok).toBe(true);
    expect(typer(m, "2026-09", "felleskonto")).toEqual(["mangler_saldo"]);
    expect(maanedsstatus(m, "2026-07")).toMatchObject({ aktive: 0, startsaldo: 1 });
    // Et senere hull er derimot et problem: saldo igjen etter en måned uten.
    const hull = modell(
      [tx({ dato: "2026-08-03" })],
      [kontroll("felleskonto", "2026-07", 1000), kontroll("felleskonto", "2026-09", 900)],
      "2026-07",
      [],
    );
    expect(typer(hull, "2026-08", "felleskonto")).toEqual(["mangler_saldo"]);
    expect(typer(hull, "2026-09", "felleskonto")).toEqual(["startpunkt"]);
  });

  it("måneder før første registrerte saldo er «før start» og lager ingen problemer", () => {
    const m = modell(
      [tx({ dato: "2026-07-03", status: "ignorert" }), tx({ dato: "2026-09-03", belop: 100 })],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", 900)],
    );
    expect(rad(m, "2026-07", "felleskonto").fase).toBe("foer_start");
    expect(typer(m, "2026-07", "felleskonto")).toEqual([]);
    expect(rad(m, "2026-09", "felleskonto").ok).toBe(true);
  });

  it("konfigurert konto uten data vises som rad, men lager ingen problemer", () => {
    const m = modell([tx({ dato: "2026-09-03" })], [kontroll("felleskonto", "2026-08", 0)]);
    expect(m.kontoer).toEqual(["MC", "eivind", "felleskonto", "helen", "krav", "regningskonto"]);
    expect(rad(m, "2026-09", "krav")).toMatchObject({
      fase: "ingen_data",
      vurdering: null,
      faktiskOre: null,
      problemer: [],
      ok: false,
    });
    expect(m.problemer.filter((p) => p.konto === "krav")).toEqual([]);
  });

  it("ukjent konto er et problem i måneden, også uten noen kontorad", () => {
    const m = modell([tx({ konto: "", importkilde: "", dato: "2026-09-03" })], [], "2026-09", []);
    expect(m.kontoer).toEqual([]);
    expect(m.rader["2026-09"]).toEqual([]);
    expect(m.ukjent["2026-09"]).toEqual({
      type: "ukjent_konto",
      konto: "?",
      maaned: "2026-09",
      antall: 1,
    });
    expect(maanedsstatus(m, "2026-09")).toMatchObject({ ukjentKonto: 1, apneProblemer: 1 });
  });
});

describe("avstemmingsmodell: problemer og delvis løsning", () => {
  it("uavklart ignorert gjør måneden usikker; avklart som dublett blir den avstemt", () => {
    const grunn = [
      tx({ id: "lonn", dato: "2026-09-05", belop: 1000, retning: "inn" }),
      tx({ id: "ign", dato: "2026-09-06", belop: 200, status: "ignorert" }),
    ];
    const k = [kontroll("felleskonto", "2026-08", 0), kontroll("felleskonto", "2026-09", 1000)];
    const foer = modell(grunn, k);
    expect(rad(foer, "2026-09", "felleskonto").status).toBe("usikker");
    expect(rad(foer, "2026-09", "felleskonto").problemer).toEqual([
      {
        type: "uavklart_ignorert",
        konto: "felleskonto",
        maaned: "2026-09",
        antall: 1,
        belopOre: -20_000,
      },
    ]);
    const etter = modell(
      grunn.map((t) => (t.id === "ign" ? { ...t, ignorertSom: "dublett" as const } : t)),
      k,
    );
    expect(rad(etter, "2026-09", "felleskonto").ok).toBe(true);
  });

  it("delvis løst er ikke OK: ett av to problemer borte, raden står", () => {
    // Avvik etter etterimport + endret grunnlag.
    const k = [
      kontroll("felleskonto", "2026-08", 1000),
      kontroll("felleskonto", "2026-09", 900, { antall: 1, nettoOre: -10_000 }),
    ];
    const t1 = tx({ id: "a", dato: "2026-09-03", belop: 100 });
    const etterimport = modell([t1, tx({ id: "b", dato: "2026-09-28", belop: 250 })], k);
    expect(typer(etterimport, "2026-09", "felleskonto")).toEqual(["avvik", "grunnlag_endret"]);
    expect(rad(etterimport, "2026-09", "felleskonto").problemer[1]).toMatchObject({ antall: 1 });
    // Helen registrerer bankens nye saldo (nytt øyeblikksbilde): avviket og
    // det endrede grunnlaget er borte — først når ny vurdering sier det.
    const ny = [k[0]!, kontroll("felleskonto", "2026-09", 650, { antall: 2, nettoOre: -35_000 })];
    const loest = modell([t1, tx({ id: "b", dato: "2026-09-28", belop: 250 })], ny);
    expect(rad(loest, "2026-09", "felleskonto").ok).toBe(true);
    // Riktig saldo, men gammelt øyeblikksbilde: avviket borte, endret grunnlag står.
    const delvis = modell(
      [t1, tx({ id: "b", dato: "2026-09-28", belop: 250 })],
      [k[0]!, kontroll("felleskonto", "2026-09", 650, { antall: 1, nettoOre: -10_000 })],
    );
    expect(rad(delvis, "2026-09", "felleskonto")).toMatchObject({ status: "avstemt", ok: false });
    expect(typer(delvis, "2026-09", "felleskonto")).toEqual(["grunnlag_endret"]);
    expect(maanedsstatus(delvis, "2026-09")).toMatchObject({ bankavstemt: 0, andreApne: 1 });
  });

  it("avledet motpost: ikke bankverifisert, egen status og eget problem", () => {
    const kilde = tx({
      id: "r1",
      dato: "2026-09-20",
      tekst: "DNB BANK ASA",
      belop: 25000,
      konto: "regningskonto",
      status: "ignorert",
      ignorertSom: "dublett",
    });
    const l = leggTilForventetMotpost("r1", "MC", "2026-09-20", NAA, kildeavtrykk(kilde))([kilde]);
    const m = modell(l, [
      kontroll("regningskonto", "2026-08", 60000),
      kontroll("regningskonto", "2026-09", 35000),
      kontroll("MC", "2026-08", -40000),
      kontroll("MC", "2026-09", -15000),
    ]);
    const mc = rad(m, "2026-09", "MC");
    expect(mc).toMatchObject({
      status: "avstemt_avledet",
      avledetOre: 2_500_000,
      innOre: 0,
      ok: false,
    });
    expect(mc.problemer).toEqual([
      { type: "avledet", konto: "MC", maaned: "2026-09", antall: 1, belopOre: 2_500_000 },
    ]);
    expect(maanedsstatus(m, "2026-09")).toMatchObject({ avledet: 1, bankavstemt: 1 });
  });

  it("avvik med en intern overføring uten motpost på en annen konto: «manglende motpost»", () => {
    const m = modell(
      [
        tx({
          dato: "2026-09-10",
          belop: 500,
          konto: "regningskonto",
          behandlingstype: "intern_overforing",
        }),
      ],
      [kontroll("felleskonto", "2026-08", 0), kontroll("felleskonto", "2026-09", 500)],
    );
    expect(rad(m, "2026-09", "felleskonto").problemer).toEqual([
      { type: "avvik", konto: "felleskonto", maaned: "2026-09", belopOre: 50_000 },
      { type: "manglende_motpost", konto: "felleskonto", maaned: "2026-09", antall: 1 },
    ]);
  });
});

describe("maanedsstatus", () => {
  it("valgt OK-måned skjuler ikke eldre åpne avvik", () => {
    const m = modell(
      [tx({ dato: "2026-08-10", belop: 100 })],
      [
        kontroll("felleskonto", "2026-06", 1000),
        kontroll("felleskonto", "2026-07", 1000),
        kontroll("felleskonto", "2026-08", 950), // 50 kr avvik
        kontroll("felleskonto", "2026-09", 950),
      ],
      "2026-07",
      [],
    );
    const s = maanedsstatus(m, "2026-09");
    expect(s).toMatchObject({ aktive: 1, bankavstemt: 1, apneProblemer: 0 });
    expect(s.andreMaaneder).toEqual([{ maaned: "2026-08", antall: 1 }]);
    expect(maanedsstatus(m, "2026-08")).toMatchObject({ avvikEllerUsikker: 1, apneProblemer: 1 });
  });

  it("teller bare aktive rader", () => {
    const m = modell([tx({ konto: "helen", dato: "2026-09-03" })], []);
    expect(maanedsstatus(m, "2026-09")).toMatchObject({
      aktive: 1,
      manglerGrunnlag: 1,
      bankavstemt: 0,
    });
  });
});

describe("nesteKonto", () => {
  it("går til neste konto som mangler saldo, rundt, og hopper over «før start»", () => {
    const m = modell(
      [
        tx({ konto: "MC", dato: "2026-09-03" }),
        tx({ konto: "helen", dato: "2026-09-03" }),
        tx({ konto: "eivind", dato: "2026-09-03" }),
      ],
      [kontroll("eivind", "2026-08", 0), kontroll("eivind", "2026-09", -100)],
      "2026-09",
      [],
    );
    // Rekkefølge: MC, eivind (avstemt), helen.
    expect(nesteKonto(m, "2026-09", "MC")).toBe("helen");
    expect(nesteKonto(m, "2026-09", "helen")).toBe("MC");
    expect(nesteKonto(m, "2026-09", "eivind")).toBe("helen");
  });
});
