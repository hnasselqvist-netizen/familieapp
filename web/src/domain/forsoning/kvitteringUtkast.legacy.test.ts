/**
 * Differensiell karakterisering av kvitteringens splitt-redigering
 * (§Issue #34 R3b-3): closurene i legacy `KvitteringDetalj` og i
 * registreringsskjemaet trekkes ut ORDRETT fra `index.html` (kun lesing)
 * og kjøres side om side med portene i `kvitteringUtkast.ts`.
 */
import { describe, expect, it } from "vitest";
import type { Eierandel, KvitteringRecord, KvitteringSplit, MalPost } from "@app-types/forsoning";
import { extractConstArrow, extractInlineExpression, loadLegacy } from "../../test/legacy";
import {
  byttSplitMaal,
  fjernSplit,
  leggTilSplit,
  oppdaterSplit,
  settSplitEiere,
  sokMalPoster,
} from "./kvitteringUtkast";

type AnyFn = (...args: unknown[]) => unknown;
const motorer = loadLegacy<Record<string, AnyFn>>({
  functions: ["jevnFordelEiere", "beregnRestPaaSisteLinje"],
});

const dagligvarer: MalPost = {
  id: "dagligvarer",
  name: "Dagligvarer",
  gruppe: "Mat",
  targetType: "budget",
  eier: "Felles",
};
const lonn: MalPost = {
  id: "lonnHelen",
  name: "Lønn Helen",
  gruppe: "Lønn",
  targetType: "income",
  eier: "Helen",
};
const utenEier: MalPost = { id: "kantine", name: "Kantine", gruppe: "Mat", targetType: "budget" };
const poster = [dagligvarer, lonn, utenEier];

const sp = (amount: number, o: Partial<KvitteringSplit> = {}): KvitteringSplit => ({
  targetType: "budget",
  targetId: "dagligvarer",
  targetName: "Dagligvarer",
  amount,
  description: "brød",
  ocrDescription: "BROD",
  learning: { approved: true, source: "ocr" },
  eiere: [{ person: "Helen", prosent: 100 }],
  ...o,
});
const lister: KvitteringSplit[][] = [
  [],
  [sp(250)],
  [sp(100), sp(150, { targetId: "kantine", targetName: "Kantine" })],
  [sp(50), sp(60, { targetType: "income", targetId: "lonnHelen" }), sp(140)],
];
const totaler = [250, 0, 199.5];

/**
 * Legacy `KvitteringDetalj`-closurene med `r` og en fanget
 * `onOppdaterKvittering` — returnerer `splits` den ville skrevet.
 */
function detalj(navn: string, r: Partial<KvitteringRecord>) {
  let skrevet: Partial<KvitteringRecord> | null = null;
  const env = {
    ...motorer,
    r,
    onOppdaterKvittering: (_id: string, felter: Partial<KvitteringRecord>) => {
      skrevet = felter;
    },
    setSokTekst: () => {},
    setRedigererMaal: () => {},
  };
  const fn = new Function(
    ...Object.keys(env),
    `"use strict";\n${extractConstArrow(navn)}\nreturn ${navn};`,
  )(...Object.values(env)) as AnyFn;
  return (...args: unknown[]) => {
    fn(...args);
    return skrevet as Partial<KvitteringRecord> | null;
  };
}

/** Legacy-skjemaets closurer med `nyTotalTall` og en fanget `setNySplits`. */
function skjema(navn: string, nySplits: KvitteringSplit[], nyTotalTall: number) {
  let splits = nySplits;
  const env = {
    ...motorer,
    nyTotalTall,
    setNySplits: (u: (p: KvitteringSplit[]) => KvitteringSplit[]) => {
      splits = u(splits);
    },
    setNySokTekst: () => {},
  };
  const fn = new Function(
    ...Object.keys(env),
    `"use strict";\n${extractConstArrow(navn)}\nreturn ${navn};`,
  )(...Object.values(env)) as AnyFn;
  return (...args: unknown[]) => {
    fn(...args);
    return splits;
  };
}

describe("kvitteringens splitt-redigering ≡ legacy (detalj og nytt skjema)", () => {
  it("leggTilSplit", () => {
    for (const splits of lister)
      for (const total of totaler)
        for (const post of poster) {
          const port = leggTilSplit(splits, post, total);
          expect(port).toEqual(detalj("leggTilSplit", { id: "k", splits, total })(post)!.splits);
          expect(port).toEqual(skjema("nyLeggTilSplit", splits, total)(post));
        }
  });

  it("byttSplitMaal bevarer beskrivelse, eiere, beløp og læring", () => {
    for (const splits of lister.slice(1))
      for (const post of poster)
        expect(byttSplitMaal(splits, 0, post)).toEqual(
          detalj("byttSplitTarget", { id: "k", splits })(0, post)!.splits,
        );
  });

  it("oppdaterSplit (beløp med komma, ugyldig, beskrivelse)", () => {
    const verdier: [string, string | number][] = [
      ["amount", "12,5"],
      ["amount", 80],
      ["amount", "abc"],
      ["amount", ""],
      ["description", "Melk og brød"],
    ];
    for (const splits of lister.slice(1))
      for (const total of totaler)
        for (const [felt, verdi] of verdier)
          for (let idx = 0; idx < splits.length; idx++) {
            const port = oppdaterSplit(splits, idx, felt as "amount", verdi, total);
            expect(port).toEqual(
              detalj("oppdaterSplit", { id: "k", splits, total })(idx, felt, verdi)!.splits,
            );
            expect(port).toEqual(skjema("nyOppdaterSplit", splits, total)(idx, felt, verdi));
          }
  });

  it("settSplitEiere", () => {
    const eiere: Eierandel[] = [
      { person: "Felles", prosent: 50 },
      { person: "Helen", prosent: 50 },
    ];
    for (const splits of lister.slice(1))
      expect(settSplitEiere(splits, splits.length - 1, eiere)).toEqual(
        detalj("oppdaterSplitEiere", { id: "k", splits })(splits.length - 1, eiere)!.splits,
      );
  });

  it("fjernSplit (rest til ny siste linje, tom forblir tom)", () => {
    for (const splits of lister.slice(1))
      for (const total of totaler)
        for (let idx = 0; idx < splits.length; idx++) {
          const port = fjernSplit(splits, idx, total);
          expect(port).toEqual(detalj("fjernSplit", { id: "k", splits, total })(idx)!.splits);
          expect(port).toEqual(skjema("nyFjernSplit", splits, total)(idx));
        }
  });

  it("postsøket: navnet inneholder søket, maks 15", () => {
    const mange = Array.from({ length: 20 }, (_, i) => ({ ...dagligvarer, id: `d${i}` }));
    const filter = extractInlineExpression("? alleMalPoster.filter(");
    for (const sok of ["", "  ", "dag", "LØNN", " kan ", "x"]) {
      const sokTekst = sok;
      const legacy = new Function(
        "alleMalPoster",
        "sokTekst",
        `return alleMalPoster.filter(${filter});`,
      )([...poster, ...mange], sokTekst) as MalPost[];
      const forventet = sok.trim().length > 0 ? legacy.slice(0, 15) : [];
      expect(sokMalPoster([...poster, ...mange], sok)).toEqual(forventet);
    }
  });
});
