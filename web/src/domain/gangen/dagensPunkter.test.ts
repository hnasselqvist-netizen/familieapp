import { describe, expect, it } from "vitest";
import {
  type GangenGrunnlag,
  MAKS_PUNKTER,
  dagensPunkter,
  middagsvarerIFryseren,
  middagsvarerPaHandlelisten,
  viOrdner,
} from "./dagensPunkter";

const taco = {
  navn: "Taco",
  ingredienser: [
    { itemId: "kjottdeig", name: "Kjøttdeig" },
    { itemId: "lefser", name: "Tortilla" },
    { itemId: null, name: "Rømme" },
  ],
};

function grunnlag(overrides: Partial<GangenGrunnlag> = {}): GangenGrunnlag {
  return {
    trengerVurdering: 0,
    forslagTilMatch: 0,
    kvitteringerKlareForKobling: 0,
    middagIDag: taco,
    middagIMorgen: null,
    handleliste: [],
    fryser: [],
    ...overrides,
  };
}

describe("dagensPunkter", () => {
  it("ingenting venter → ingen punkter", () => {
    expect(dagensPunkter(grunnlag())).toEqual([]);
  });

  it("middag ikke planlagt i dag kommer først — den kan ikke vente, køene kan", () => {
    const punkter = dagensPunkter(
      grunnlag({ middagIDag: null, trengerVurdering: 2, kvitteringerKlareForKobling: 1 }),
    );
    expect(punkter.map((p) => p.art)).toEqual([
      "middag-uplanlagt",
      "transaksjoner",
      "kvitteringer",
    ]);
  });

  it("varer til dagens middag som ikke er kjøpt gir ett handlepunkt med antall", () => {
    const punkter = dagensPunkter(
      grunnlag({
        handleliste: [
          { itemId: "kjottdeig", name: "Kjøttdeig", done: false },
          { itemId: "lefser", name: "Tortilla", done: true },
          { itemId: null, name: "rømme ", done: false },
          { itemId: "melk", name: "Melk", done: false },
        ],
      }),
    );
    expect(punkter).toEqual([{ art: "middag-handle", middag: "Taco", antall: 2 }]);
  });

  it("transaksjonspunktet åpner «vurdering» når noe der venter, ellers «forslag»", () => {
    expect(dagensPunkter(grunnlag({ trengerVurdering: 3, forslagTilMatch: 1 }))).toEqual([
      { art: "transaksjoner", antall: 3, ko: "vurdering" },
    ]);
    expect(dagensPunkter(grunnlag({ trengerVurdering: 2, forslagTilMatch: 2 }))).toEqual([
      { art: "transaksjoner", antall: 2, ko: "forslag" },
    ]);
  });

  it(`viser aldri mer enn ${MAKS_PUNKTER} punkter`, () => {
    const punkter = dagensPunkter(
      grunnlag({
        middagIDag: null,
        trengerVurdering: 5,
        kvitteringerKlareForKobling: 4,
      }),
    );
    expect(punkter.length).toBeLessThanOrEqual(MAKS_PUNKTER);
  });

  it("produktvalg C: grunnlaget har ingen økonomi utover køene — ingen saldo, ingen Spillerom", () => {
    const nokler = Object.keys(grunnlag()).sort();
    expect(nokler).toEqual(
      [
        "fryser",
        "handleliste",
        "kvitteringerKlareForKobling",
        "middagIDag",
        "middagIMorgen",
        "forslagTilMatch",
        "trengerVurdering",
      ].sort(),
    );
  });
});

describe("middagsvarerPaHandlelisten", () => {
  it("kobler på vare-ID, og på navn bare når en av sidene mangler ID", () => {
    const liste = [
      { itemId: "kjottdeig", name: "Noe annet navn", done: false },
      { itemId: "annen-id", name: "Tortilla", done: false },
      { itemId: null, name: "RØMME", done: false },
    ];
    expect(middagsvarerPaHandlelisten(taco, liste).map((v) => v.name)).toEqual([
      "Noe annet navn",
      "RØMME",
    ]);
  });

  it("en hendelse uten ingredienser gir ingen varer", () => {
    const hendelse = { navn: "Middag hos svigermor", ingredienser: [] };
    expect(
      middagsvarerPaHandlelisten(hendelse, [{ itemId: null, name: "Melk", done: false }]),
    ).toEqual([]);
  });
});

describe("middagsvarerIFryseren", () => {
  it("finner ingredienser med noe igjen, og hele retter med samme navn", () => {
    const fryser = [
      { itemId: "kjottdeig", name: "Kjøttdeig", antall: 2 },
      { itemId: "lefser", name: "Tortilla", antall: 0 },
      { itemId: "taco-rest", name: "taco", antall: 1 },
    ];
    expect(middagsvarerIFryseren(taco, fryser).map((f) => f.itemId)).toEqual([
      "kjottdeig",
      "taco-rest",
    ]);
  });
});

describe("viOrdner", () => {
  it("gjør dagens middag konkret", () => {
    expect(viOrdner(grunnlag())).toContain("I dag: Taco.");
  });

  it("nevner morgendagens middag bare når noe av den ligger i fryseren", () => {
    const lasagne = { navn: "Lasagne", ingredienser: [{ itemId: "kjottdeig", name: "kjøttdeig" }] };
    expect(viOrdner(grunnlag({ middagIMorgen: lasagne })).join(" ")).not.toContain("I morgen");
    expect(
      viOrdner(
        grunnlag({
          middagIMorgen: lasagne,
          fryser: [{ itemId: "kjottdeig", name: "kjøttdeig", antall: 1 }],
        }),
      ),
    ).toContain("I morgen: Lasagne. Kjøttdeig ligger i fryseren.");
  });

  it("en hel frossen rett sies som «Den ligger i fryseren»", () => {
    expect(
      viOrdner(
        grunnlag({
          middagIMorgen: { navn: "Lasagne", ingredienser: [] },
          fryser: [{ itemId: "lasagne", name: "Lasagne", antall: 1 }],
        }),
      ),
    ).toContain("I morgen: Lasagne. Den ligger i fryseren.");
  });

  it("flere frosne varer listes naturlig", () => {
    expect(
      viOrdner(
        grunnlag({
          middagIMorgen: taco,
          fryser: [
            { itemId: "kjottdeig", name: "kjøttdeig", antall: 1 },
            { itemId: "lefser", name: "tortilla", antall: 3 },
          ],
        }),
      ),
    ).toContain("I morgen: Taco. Kjøttdeig og tortilla ligger i fryseren.");
  });

  it("beholder de eksisterende linjene for handleliste og vurderinger", () => {
    const linjer = viOrdner(
      grunnlag({ middagIDag: null, handleliste: [{ itemId: null, name: "Melk", done: true }] }),
    );
    expect(linjer).toEqual(["Handlelisten er klar.", "Ingen nye vurderinger venter."]);
  });
});
