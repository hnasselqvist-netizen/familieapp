import { describe, expect, it } from "vitest";
import { byggSide, bytesAv, nokkelside } from "./side";
import { familieSti, parseSti, rtdbNokkelOrden, UgyldigSti } from "./sti";

describe("parseSti", () => {
  it("tom sti er familienoden; segmenter skilles med /", () => {
    expect(parseSti("")).toEqual([]);
    expect(parseSti("transaksjoner/12/fordelinger")).toEqual([
      "transaksjoner",
      "12",
      "fordelinger",
    ]);
    expect(familieSti("familie1", ["receipts", "r1"])).toBe("families/familie1/receipts/r1");
    expect(familieSti("familie1", [])).toBe("families/familie1");
  });

  it.each([
    ["/transaksjoner", "absolutt sti"],
    ["transaksjoner/", "avsluttende /"],
    ["a//b", "tomt segment"],
    ["..", "forelder"],
    ["../familie2", "annen familie"],
    ["a/../../mcp", "ut av familienoden"],
    ["mcp.principals", "punktum"],
    ["a#b", "#"],
    ["a$b", "$"],
    ["a[0]", "klammer"],
    ["a\u0000b", "kontrolltegn"],
    ["x".repeat(769), "for lang nøkkel"],
    [Array.from({ length: 33 }, () => "a").join("/"), "for dyp"],
  ])("avviser %j (%s)", (sti) => {
    expect(() => parseSti(sti)).toThrow(UgyldigSti);
  });
});

describe("rtdbNokkelOrden", () => {
  it("32-biters heltall først numerisk (likt tall: kortest først), så strenger", () => {
    const nokler = ["b", "10", "-3", "2", "a", "01", "2147483648", "0", "-0"];
    expect([...nokler].sort(rtdbNokkelOrden)).toEqual([
      "-3",
      "0",
      "-0",
      "01",
      "2",
      "10",
      "2147483648",
      "a",
      "b",
    ]);
  });
});

describe("byggSide", () => {
  const valg = { antall: 50, maksBytes: 1_000, fraTegn: 0 };

  it("manglende node og primitiv verdi", () => {
    expect(byggSide({ finnes: false, barn: [] }, valg)).toEqual({ type: "mangler" });
    expect(byggSide({ finnes: true, verdi: 7, barn: [] }, valg)).toEqual({
      type: "verdi",
      verdi: 7,
    });
    expect(byggSide({ finnes: true, verdi: false, barn: [] }, valg)).toEqual({
      type: "verdi",
      verdi: false,
    });
  });

  it("fulle verdier med alle nestede og ukjente felt", () => {
    const t = {
      id: "t1",
      belop: -12.5,
      ukjent: { dypt: [1, { x: "y" }] },
      korrigeringslogg: [{ a: 1 }],
    };
    expect(byggSide({ finnes: true, barn: [["0", t]] }, valg)).toEqual({
      type: "node",
      barn: [{ nokkel: "0", verdi: t }],
      neste: null,
    });
  });

  it("antall: henter antall+1 og gir markør når det finnes mer", () => {
    const barn: [string, unknown][] = [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ];
    expect(byggSide({ finnes: true, barn }, { ...valg, antall: 2 })).toEqual({
      type: "node",
      barn: [
        { nokkel: "a", verdi: 1 },
        { nokkel: "b", verdi: 2 },
      ],
      neste: "b",
    });
  });

  it("størrelsesgrensen stopper siden, men minst ett barn kommer alltid med", () => {
    const stor = "x".repeat(600);
    const s = byggSide(
      {
        finnes: true,
        barn: [
          ["a", stor],
          ["b", stor],
        ],
      },
      valg,
    );
    expect(s.barn).toEqual([{ nokkel: "a", verdi: stor }]);
    expect(s.neste).toBe("a");
  });

  it("et barn større enn grensen rapporteres som forStor og kan leses på egen sti", () => {
    const node = { a: "x".repeat(800), b: "y".repeat(800) };
    const tekst = "z".repeat(2_000);
    const s = byggSide(
      {
        finnes: true,
        barn: [
          ["n", node],
          ["t", tekst],
          ["v", 1],
        ],
      },
      valg,
    );
    expect(s.barn).toEqual([
      { nokkel: "n", forStor: { bytes: bytesAv(node), type: "node", antallBarn: 2 } },
      { nokkel: "t", forStor: { bytes: bytesAv(tekst), type: "tekst", lengde: 2_000 } },
      { nokkel: "v", verdi: 1 },
    ]);
    expect(s.neste).toBeNull();
  });

  it("lang tekst leses i deler uten tap og uten å splitte et surrogatpar", () => {
    const tekst = `${"a".repeat(999)}😀${"b".repeat(1_500)}`;
    const deler: string[] = [];
    let fraTegn = 0;
    for (;;) {
      const s = byggSide({ finnes: true, verdi: tekst, barn: [] }, { ...valg, fraTegn });
      expect(s.type).toBe("tekstdel");
      expect(s.lengde).toBe(tekst.length);
      deler.push(s.del!);
      if (s.nesteFraTegn === null) break;
      fraTegn = s.nesteFraTegn!;
    }
    expect(deler.join("")).toBe(tekst);
    expect(deler[0]).toBe("a".repeat(999));
  });
});

describe("nokkelside", () => {
  it("sorterer i RTDB-orden og sidedeler med markør", () => {
    const nokler = ["b", "10", "2", "a", "0"];
    expect(nokkelside(nokler, null, 2)).toEqual({ nokler: ["0", "2"], neste: "2", totalt: 5 });
    expect(nokkelside(nokler, "2", 2)).toEqual({ nokler: ["10", "a"], neste: "a", totalt: 5 });
    expect(nokkelside(nokler, "a", 2)).toEqual({ nokler: ["b"], neste: null, totalt: 5 });
    expect(nokkelside(nokler, "b", 2)).toEqual({ nokler: [], neste: null, totalt: 5 });
  });
});
