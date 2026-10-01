import { describe, expect, it } from "vitest";
import { extractFunction, loadLegacy, matchBlock } from "./legacy";

describe("legacy-uttrekk", () => {
  it("matchBlock hopper over strenger, kommentarer og regex med anførselstegn/klammer", () => {
    const src = `{ const a = "}"; // }\n const b = /"{/g; const c = \`\${ {x:1} }\`; /* } */ return a; } tail`;
    expect(src.slice(0, matchBlock(src, 0)).endsWith("return a; }")).toBe(true);
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
