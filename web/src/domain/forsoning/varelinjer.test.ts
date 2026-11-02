/**
 * Beskrivende varelinjer (#59, kvitteringer C). Syntetiske kvitteringer.
 */
import { describe, expect, it } from "vitest";
import type {
  HendelseRecord,
  KvitteringRecord,
  TransaksjonRecord,
  Varelinje,
} from "@app-types/forsoning";
import { kontrollgrunnlagTekst } from "./kvalitetssikring";
import { oppdaterKvittering } from "./kvitteringSkriving";
import {
  advarsler,
  lagreVarelinjer,
  medFerskeVarelinjer,
  mengdeFelt,
  nettoOre,
  oreFelt,
  parseVarelinjer,
  summer,
  tolkMengde,
  tolkOre,
  varelinjerSkrivId,
} from "./varelinjer";

const T = "2026-11-02T10:00:00.000Z";
const linje = (id: string, over: Partial<Varelinje> = {}): Varelinje => ({
  id,
  art: "vare",
  tekst: id,
  ...over,
});

const kvittering = (over: Partial<KvitteringRecord> = {}): KvitteringRecord => ({
  id: "r1",
  merchant: "Butikk",
  purchaseDate: "2026-11-01",
  total: 123.4,
  allocationMode: "single",
  splits: [
    {
      targetType: "budget",
      targetId: "mat",
      targetName: "Mat",
      amount: 123.4,
      eiere: [{ person: "Felles", prosent: 100 }],
    } as never,
  ],
  matchingStatus: "matched",
  hendelseId: "h1",
  imageUrl: "data:image/png;base64,AAAA",
  driveFileId: "drive1",
  vedlegg: [
    {
      sha256: "a".repeat(64),
      type: "image/png",
      storrelse: 10,
      filnavn: "k.png",
      lastetOpp: T,
      av: "Syntetisk",
    },
  ],
  ...over,
});

describe("rabatt, netto og summer", () => {
  it("rabatt trekkes nøyaktig én gang fra linjebeløpet før rabatt", () => {
    const l = linje("a", { belopOre: 4990, rabattOre: 1000 });
    expect(nettoOre(l)).toBe(3990);
    const s = summer([l], 39.9);
    expect(s).toMatchObject({ sumOre: 3990, rabattOre: 1000, differanseOre: 0 });
  });

  it("manglende beløp er ikke 0: linjen er ufullstendig og telles ikke", () => {
    const s = summer([linje("a", { belopOre: 1000 }), linje("b")], 20);
    expect(s).toMatchObject({ sumOre: 1000, utenBelop: 1, differanseOre: 1000 });
    expect(advarsler([linje("a", { belopOre: 1000 }), linje("b")], 20)).toEqual([
      { type: "uten_belop", antall: 1 },
      { type: "avvik_total", differanseOre: 1000, ufullstendig: true },
    ]);
  });

  it("ekte 0 er et beløp (gratis vare)", () => {
    const s = summer([linje("a", { belopOre: 0 })], 0);
    expect(s).toMatchObject({ sumOre: 0, utenBelop: 0, differanseOre: 0 });
    expect(advarsler([linje("a", { belopOre: 0 })], 0)).toEqual([]);
  });

  it("pant og retur holdes utenfor varer; negative trekk er ikke forbruk", () => {
    const s = summer(
      [
        linje("melk", { belopOre: 2490 }),
        linje("pant", { art: "pant", belopOre: 300 }),
        linje("lapp", { art: "pant", belopOre: -1500 }),
        linje("retur", { art: "retur", belopOre: -999 }),
      ],
      2.91,
    );
    expect(s.vareOre).toBe(2490);
    expect(s.pantReturOre).toBe(300 - 1500 - 999);
    expect(s.sumOre).toBe(291);
    expect(s.differanseOre).toBe(0);
  });

  it("mengde × enhetspris som ikke stemmer gir advarsel, ikke stopp", () => {
    const a = advarsler(
      [linje("epler", { mengde: 0.452, enhetsprisOre: 3990, belopOre: 1803 })],
      undefined,
    );
    expect(a).toEqual([]);
    const b = advarsler(
      [linje("x", { mengde: 2, enhetsprisOre: 1000, belopOre: 2500 })],
      undefined,
    );
    expect(b).toEqual([{ type: "mengde_pris", linjeId: "x", forventetOre: 2000 }]);
  });

  it("ingen linjer gir ingen advarsler (gamle kvitteringer trenger ikke linjer)", () => {
    expect(advarsler([], 100)).toEqual([]);
  });
});

describe("inndata med norske desimaler", () => {
  it("tolkOre", () => {
    expect(tolkOre("12,90", false)).toBe(1290);
    expect(tolkOre("1 299", false)).toBe(129900);
    expect(tolkOre("0", false)).toBe(0);
    expect(tolkOre("", false)).toBeUndefined();
    expect(tolkOre("-30", false)).toBeNull();
    expect(tolkOre("-30", true)).toBe(-3000);
    expect(tolkOre("−15,50", true)).toBe(-1550);
    expect(tolkOre("-0", true)).toBe(0);
    expect(tolkOre("1,234", true)).toBeNull();
    expect(oreFelt(-1550)).toBe("−15,50");
    expect(oreFelt(0)).toBe("0");
  });

  it("tolkMengde", () => {
    expect(tolkMengde("0,452")).toBe(0.452);
    expect(tolkMengde("2")).toBe(2);
    expect(tolkMengde("0")).toBe(0);
    expect(tolkMengde("")).toBeUndefined();
    expect(tolkMengde("-1")).toBeNull();
    expect(mengdeFelt(0.452)).toBe("0,452");
  });
});

describe("parseVarelinjer", () => {
  it("leser RTDB-objekt med indeksnøkler i rekkefølge og hopper over ugyldige/duplikate id-er", () => {
    const l = parseVarelinjer({
      "1": { id: "b", art: "vare", tekst: "B", belopOre: 100 },
      "0": { id: "a", art: "ukjent", tekst: "A", mengde: -1, rabattOre: -5, fremtidig: 1 },
      "2": { id: "a", tekst: "dup" },
      "3": { tekst: "uten id" },
    });
    expect(l).toEqual([
      { id: "a", art: "vare", tekst: "A" },
      { id: "b", art: "vare", tekst: "B", belopOre: 100 },
    ]);
  });
});

describe("lagreVarelinjer — bare egne felt, mot fersk verdi", () => {
  const andre = kvittering({ id: "r2", merchant: "Annen" });

  it("patcher bare varelinjefeltene; splits, matching, bilde/Drive/vedlegg og andre kvitteringer står", () => {
    const r1 = { ...kvittering(), ukjentFelt: { x: 1 } } as KvitteringRecord;
    const { neste, utfall } = lagreVarelinjer(
      [r1, andre],
      "r1",
      [linje("a", { belopOre: 100 })],
      0,
      T,
    );
    expect(utfall).toBe("lagret");
    const { varelinjer, varelinjerVersjon, varelinjerSkrivId, varelinjerOppdatert, ...resten } =
      neste[0]!;
    expect(resten).toEqual(r1);
    expect(varelinjer).toEqual([{ id: "a", art: "vare", tekst: "a", belopOre: 100 }]);
    expect(varelinjerVersjon).toBe(1);
    expect(varelinjerSkrivId).toBeTruthy();
    expect(varelinjerOppdatert).toBe(T);
    expect(neste[1]).toBe(andre);
  });

  it("konflikt når versjonen er endret av en annen enhet; ingenting endres", () => {
    const fersk = kvittering({ varelinjer: [linje("b")], varelinjerVersjon: 2 });
    const r = lagreVarelinjer([fersk], "r1", [linje("a")], 1, T);
    expect(r.utfall).toBe("konflikt");
    expect(r.neste[0]).toEqual(fersk);
  });

  it("identisk retry gir «allerede»; endret utkast på samme grunnlag gir konflikt", () => {
    const linjer = [linje("a", { belopOre: 100 })];
    const forste = lagreVarelinjer([kvittering()], "r1", linjer, 0, T);
    expect(lagreVarelinjer(forste.neste, "r1", linjer, 0, "senere").utfall).toBe("allerede");
    expect(lagreVarelinjer(forste.neste, "r1", [linje("a", { belopOre: 200 })], 0, T).utfall).toBe(
      "konflikt",
    );
  });

  it("ukjente felt på en eksisterende linje bevares; fjernede kjente felt slettes", () => {
    const fersk = kvittering({
      varelinjer: [
        { ...linje("a", { mengde: 2, belopOre: 100 }), fremtidig: "behold" } as Varelinje,
      ],
      varelinjerVersjon: 1,
    });
    const r = lagreVarelinjer([fersk], "r1", [linje("a", { belopOre: 150 })], 1, T);
    expect(r.neste[0]!.varelinjer).toEqual([
      { id: "a", art: "vare", tekst: "a", belopOre: 150, fremtidig: "behold" },
    ]);
  });

  it("stabile id-er gjennom omorganisering", () => {
    const fersk = kvittering({
      varelinjer: [linje("a"), { ...linje("b"), x: 1 } as Varelinje],
      varelinjerVersjon: 1,
    });
    const r = lagreVarelinjer([fersk], "r1", [linje("b"), linje("a")], 1, T);
    expect(r.neste[0]!.varelinjer!.map((l) => l.id)).toEqual(["b", "a"]);
    expect(r.neste[0]!.varelinjer![0]).toMatchObject({ x: 1 });
  });

  it("fjerne alle linjer sletter feltet, men versjonen øker", () => {
    const fersk = kvittering({ varelinjer: [linje("a")], varelinjerVersjon: 1 });
    const r = lagreVarelinjer([fersk], "r1", [], 1, T);
    expect(r.neste[0]!.varelinjer).toBeUndefined();
    expect(r.neste[0]!.varelinjerVersjon).toBe(2);
  });

  it("ukjent kvittering gir «mangler»", () => {
    expect(lagreVarelinjer([kvittering()], "x", [], 0, T).utfall).toBe("mangler");
  });

  it("null, NaN, negativ rabatt og duplikat-id avvises før noe endres", () => {
    expect(() =>
      lagreVarelinjer([kvittering()], "r1", [{ ...linje("a"), mengde: null } as never], 0, T),
    ).toThrow("varelinjer/0/mengde");
    expect(() =>
      lagreVarelinjer([kvittering()], "r1", [linje("a", { belopOre: NaN })], 0, T),
    ).toThrow("belopOre");
    expect(() =>
      lagreVarelinjer([kvittering()], "r1", [linje("a", { rabattOre: -1 })], 0, T),
    ).toThrow("Rabatt");
    expect(() => lagreVarelinjer([kvittering()], "r1", [linje("a"), linje("a")], 0, T)).toThrow(
      "samme id",
    );
  });

  it("skrive-id er innholdsbasert og uavhengig av nøkkelrekkefølge", () => {
    const a = varelinjerSkrivId("r1", 0, [{ id: "a", art: "vare", tekst: "x", belopOre: 1 }]);
    const b = varelinjerSkrivId("r1", 0, [{ belopOre: 1, tekst: "x", art: "vare", id: "a" }]);
    expect(a).toBe(b);
    expect(varelinjerSkrivId("r1", 1, [linje("a")])).not.toBe(
      varelinjerSkrivId("r1", 0, [linje("a")]),
    );
  });
});

describe("annen editor etter varelinjelagring sletter ikke linjene", () => {
  it("oppdaterKvittering fra et eldre øyeblikksbilde bevarer ferske varelinjer", () => {
    const gammel = kvittering({ hendelseId: null });
    // Varelinjer lagres etter at redigeringen ble forberedt.
    const fersk = lagreVarelinjer([gammel], "r1", [linje("a", { belopOre: 100 })], 0, T).neste;
    const utfall = oppdaterKvittering(
      { receipts: [gammel], hendelser: [] },
      "r1",
      { merchant: "Ny butikk" },
      T,
    );
    const etter = utfall!.endring!.receipts!(fersk);
    expect(etter[0]).toMatchObject({ merchant: "Ny butikk", varelinjerVersjon: 1 });
    expect(etter[0]!.varelinjer).toEqual(fersk[0]!.varelinjer);
  });

  it("medFerskeVarelinjer fjerner ikke-ferske varelinjefelt", () => {
    const ny = kvittering({ varelinjer: [linje("gml")], varelinjerVersjon: 1 });
    const fersk = kvittering();
    expect(medFerskeVarelinjer(ny, fersk).varelinjer).toBeUndefined();
  });
});

describe("økonomi og kontrollgrunnlag er uendret av varelinjer", () => {
  const t: TransaksjonRecord = {
    id: "t1",
    dato: "2026-11-01",
    tekst: "BUTIKK",
    belop: 123.4,
    retning: "ut",
    konto: "1234",
    status: null,
    hendelseId: "h1",
  };
  const h: HendelseRecord = {
    id: "h1",
    status: "ferdig",
    paaVentAarsak: null,
    transaksjonId: "t1",
    receiptId: "r1",
    fordelinger: [
      {
        plasseringId: "mat",
        plasseringType: "budget",
        plasseringNavn: "Mat",
        belop: 123.4,
        eiere: [{ person: "Felles", prosent: 100 }],
      },
    ],
    dato: "2026-11-01",
    regelId: null,
    opprettet: T,
    oppdatert: T,
  };

  it("kontrollgrunnlaget for koblet transaksjon er identisk før og etter varelinjer", () => {
    const foer = kontrollgrunnlagTekst(t, [h], [kvittering()]);
    const { neste } = lagreVarelinjer(
      [kvittering()],
      "r1",
      [linje("a", { belopOre: 12340, rabattOre: 0 })],
      0,
      T,
    );
    expect(kontrollgrunnlagTekst(t, [h], neste)).toBe(foer);
  });
});
