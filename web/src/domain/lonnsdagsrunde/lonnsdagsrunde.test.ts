import { describe, expect, it } from "vitest";
import {
  type RundeGrunnlag,
  beregnRunde,
  lonnsperiode,
  saldoOppdatertIPerioden,
  sisteImportDato,
} from "./lonnsdagsrunde";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 7. oktober 2026, lønn den 20. → perioden startet 20. september.
const IDAG = new Date(2026, 9, 7, 12);

function grunnlag(o: Partial<RundeGrunnlag> = {}): RundeGrunnlag {
  return {
    lonnDay: 20,
    sisteImport: "2026-09-22",
    aVurdere: 0,
    kvitteringer: 0,
    saldoOppdatert: new Date(2026, 8, 21).getTime(),
    prognosedatoPassert: false,
    trengerAvklaring: 0,
    ...o,
  };
}

describe("lonnsperiode", () => {
  it("før lønningsdagen: perioden startet forrige måned", () => {
    const { start, neste } = lonnsperiode(IDAG, 20);
    expect([iso(start), iso(neste)]).toEqual(["2026-09-20", "2026-10-20"]);
  });

  it("på lønningsdagen: ny periode starter i dag", () => {
    const { start, neste } = lonnsperiode(new Date(2026, 9, 20, 8), 20);
    expect([iso(start), iso(neste)]).toEqual(["2026-10-20", "2026-11-20"]);
  });

  it("over årsskiftet", () => {
    const { start, neste } = lonnsperiode(new Date(2027, 0, 5), 20);
    expect([iso(start), iso(neste)]).toEqual(["2026-12-20", "2027-01-20"]);
  });

  it("lønningsdag 31 kuttes til månedens siste dag", () => {
    const { start, neste } = lonnsperiode(new Date(2027, 2, 10), 31);
    expect([iso(start), iso(neste)]).toEqual(["2027-02-28", "2027-03-31"]);
  });

  it("ugyldig lønningsdag faller tilbake til 20, som likviditetsnoden", () => {
    expect(iso(lonnsperiode(IDAG, 0).start)).toBe("2026-09-20");
  });
});

describe("beregnRunde", () => {
  it("alt gjort i perioden → ferdig, ingen aktivt steg, neste runde på lønningsdagen", () => {
    const r = beregnRunde(grunnlag(), IDAG);
    expect(r).toMatchObject({
      periodeStart: "2026-09-20",
      nesteLonnsdag: "2026-10-20",
      ferdig: true,
      aktivt: null,
      gjenstar: 0,
    });
  });

  it("import fra før lønn teller ikke — runden starter på import", () => {
    const r = beregnRunde(grunnlag({ sisteImport: "2026-09-19" }), IDAG);
    expect(r.aktivt).toBe("import");
    expect(r.steg[0]).toEqual({ id: "import", ferdig: false, sisteImport: "2026-09-19" });
  });

  it("aldri importert", () => {
    expect(beregnRunde(grunnlag({ sisteImport: null }), IDAG).steg[0]!.ferdig).toBe(false);
  });

  it("aktivt steg er det første som ikke er gjort, selv om senere steg også gjenstår", () => {
    const r = beregnRunde(grunnlag({ aVurdere: 3, kvitteringer: 2 }), IDAG);
    expect(r.aktivt).toBe("vurdering");
    expect(r.gjenstar).toBe(2);
    expect(r.steg.map((s) => s.ferdig)).toEqual([true, false, false, true]);
  });

  it("Spillerom krever saldo i perioden, gyldig prognosedato og ingen poster til avklaring", () => {
    const steg = (o: Partial<RundeGrunnlag>) => beregnRunde(grunnlag(o), IDAG).steg[3]!;
    expect(steg({}).ferdig).toBe(true);
    expect(steg({ saldoOppdatert: new Date(2026, 8, 19).getTime() })).toMatchObject({
      ferdig: false,
      saldoOppdatert: false,
    });
    expect(steg({ saldoOppdatert: null }).ferdig).toBe(false);
    expect(steg({ prognosedatoPassert: true }).ferdig).toBe(false);
    expect(steg({ trengerAvklaring: 1 })).toMatchObject({ ferdig: false, trengerAvklaring: 1 });
  });

  it("rekkefølgen er låst: import → vurdering → kvitteringer → Spillerom", () => {
    expect(beregnRunde(grunnlag(), IDAG).steg.map((s) => s.id)).toEqual([
      "import",
      "vurdering",
      "kvitteringer",
      "spillerom",
    ]);
  });
});

describe("saldoOppdatertIPerioden", () => {
  it("saldo satt på selve lønningsdagen teller", () => {
    expect(saldoOppdatertIPerioden(new Date(2026, 8, 20, 0, 0).getTime(), 20, IDAG)).toBe(true);
  });
});

describe("sisteImportDato", () => {
  it("finner seneste importdato og ignorerer manuelle transaksjoner uten dato", () => {
    expect(
      sisteImportDato([
        { importertDato: "2026-09-02" },
        {},
        { importertDato: "2026-10-01" },
        { importertDato: "2026-09-30" },
      ]),
    ).toBe("2026-10-01");
    expect(sisteImportDato([{}])).toBeNull();
  });
});
