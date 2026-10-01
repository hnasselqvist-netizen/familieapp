import { describe, expect, it } from "vitest";
import { extractFunction, loadLegacy, matchBlock } from "./legacy";

describe("legacy-uttrekk", () => {
  it("matchBlock hopper over strenger, kommentarer og regex med anførselstegn/klammer", () => {
    const src = `{ const a = "}"; // }\n const b = /"{/g; const c = \`\${ {x:1} }\`; /* } */ return a; } tail`;
    expect(src.slice(0, matchBlock(src, 0)).endsWith("return a; }")).toBe(true);
  });

  describe("syntetisk: template literals og regex (Kontrolltårn-review PR #41)", () => {
    /**
     * Hver blokk er en funksjonskropp etterfulgt av et `}`-rikt hale-
     * fragment. Testen beviser (1) at matchBlock slutter NØYAKTIG på
     * blokkens avsluttende `}` og (2) at utsnittet er gyldig JS som
     * evaluerer til forventet verdi — ikke bare at tellingen tilfeldigvis
     * balanserer.
     */
    const TAIL = " } } ) ` ' \" /* tail */";
    const tilfeller: [string, string, unknown][] = [
      ["template literal med ${...}", "{ const b = 2; return `a ${b} c`; }", "a 2 c"],
      [
        "klammer i template-TEKST (utenfor ${}) telles ikke",
        "{ return `{ ikke en blokk } ${'}'} {`; }",
        "{ ikke en blokk } } {",
      ],
      [
        'nested template literal inne i uttrykket, med "}" i en streng',
        '{ const y = 1; return `ytre ${ `indre ${ y + "}" } slutt` } ferdig`; }',
        "ytre indre 1} slutt ferdig",
      ],
      [
        "objektliteral, regex med klammer/anførsel og kommentarer inne i ${}",
        '{ const x = "}\\""; return `v=${ /* } */ (/[}{]"/.test(x) ? {a: 1} : {a: 2}).a // }\n } !`; }',
        "v=1 !",
      ],
      ["regex rett etter return (ikke divisjon)", '{ return /"}/.test("x\\"}"); }', true],
      [
        "regex med } rett etter return / typeof-lignende nøkkelord",
        '{ if (false) return 0; else return /}/.test("}"); }',
        true,
      ],
      ["regex med } rett etter return", '{ return /}/.test("}"); }', true],
      ["divisjon etter ) og identifikator", "{ const a = 6, b = 3; return (a) / b / 1; }", 2],
      ["dypt nestet ${} i ${}", "{ const n = 3; return `${`${`${n}`}`}`; }", "3"],
    ];

    it.each(tilfeller)("%s", (_navn, blokk, forventet) => {
      const src = blokk + TAIL;
      const slutt = matchBlock(src, 0);
      expect(src.slice(0, slutt)).toBe(blokk);
      expect(new Function(blokk.slice(1, -1))()).toEqual(forventet);
    });

    it("feiler høyt på en uavsluttet template literal i stedet for å gjette", () => {
      expect(() => matchBlock("{ return `aldri slutt ${ 1 }", 0)).toThrow(/Uavsluttet|Ubalansert/);
    });
  });

  it("feiler tydelig for en funksjon som ikke finnes", () => {
    expect(() => extractFunction("finnesIkkeILegacy")).toThrow(/Fant ikke/);
  });

  it("trekker ut og evaluerer alle R0-funksjonene", () => {
    const legacy = loadLegacy({
      functions: [
        "normaliserTransaksjonstekst",
        "normalizeMerchant",
        "belopMatcherIOre",
        "dagerMellom",
        "fellesPrefiks",
        "regelMatcherTekst",
        "findMatchingRule",
        "finnMalpostForRegel",
        "evaluerReglerMotUavklarteTransaksjoner",
        "byggKjorReglerEndringsplan",
        "erEndringsplanUendret",
        "skrivEndringsplan",
        "oppdaterReglerVedLaering",
        "finnHendelseForTransaksjon",
        "finnHendelseForKvittering",
        "byggFordelingFraPost",
        "byggManuellHendelse",
        "byggKorrigertHendelse",
        "calculateSplitTotal",
        "erKvitteringKlarForLukking",
        "vurderKvitteringKobling",
        "finnKvitteringTransaksjonKandidater",
        "fordelingerFraKvitteringSplits",
        "byggSynkronisertKvitteringOgHendelse",
        "findReceipt",
        "kontoUlik",
        "retningMotsatt",
        "finnInterneOverforingsKandidater",
        "bekreftInternOverforing",
        "jevnFordelEiere",
        "beregnRestPaaSisteLinje",
        "byggAlleMalPoster",
        "byggAlleSparingPoster",
      ],
      constValues: ["BELOPSTOLERANSE_KOBLING", "KVITTERING_TIDSVINDU_DAGER"],
      constArrows: ["parseCSV", "mapRad", "dupKey", "normaliserKonto"],
      globals: { uid: () => "x" },
    });
    expect(Object.keys(legacy)).toHaveLength(39);
    expect(legacy.normaliserTransaksjonstekst!("REMA 1000 12.03 #44")).toBe("rema 1000");
  });
});
