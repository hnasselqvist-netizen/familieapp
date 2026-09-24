/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * Budsjett/Inntekter/Sparing-motoren i dagens `index.html` (linje
 * 11477–12506, delte hjelpefunksjoner linje 939, 954, 9591–9723), lest
 * og verifisert manuelt mot koden FØR porteringen til
 * budsjettfamilie.ts. Ved uenighet om "riktig" oppførsel senere: dette
 * er fasit — MED ÉN unntatt, bevisst dokumentert avviks-fiks (se
 * "budgetMonthKey/currentBudgetYear" nederst): legacy sitt hardkodede
 * "2026" er en observert feil, ikke ønsket atferd å låse.
 */
import { describe, expect, it } from "vitest";
import {
  beregnFaktiskTotalerFraHendelser,
  budgetMonthKey,
  budsjettpostMatcherId,
  currentBudgetYear,
  defaultMeta,
  defaultSparingMeta,
  finnHendelserForPost,
  hentFaktiskForPost,
  isOver,
  nyPostMeta,
  summerGruppeBudsjett,
  summerGruppeFaktisk,
} from "./budsjettfamilie";
import type { BankHendelse, BankTransaksjon, Kvittering } from "@app-types/gangen";
import type { BudsjettGruppe, BudsjettPost } from "@app-types/budsjettfamilie";

function post(overrides: Partial<BudsjettPost>): BudsjettPost {
  return {
    id: "p1",
    name: "Test",
    months: Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 })),
    ...overrides,
  };
}

describe("isOver", () => {
  it("er over kun når budsjett er positivt OG faktisk overstiger det", () => {
    expect(isOver(150, 100)).toBe(true);
    expect(isOver(100, 100)).toBe(false);
    expect(isOver(50, 100)).toBe(false);
  });

  it("er aldri over når budsjett er 0 eller negativt, uansett faktisk", () => {
    expect(isOver(500, 0)).toBe(false);
    expect(isOver(500, -100)).toBe(false);
  });
});

describe("budsjettpostMatcherId", () => {
  it("matcher direkte id", () => {
    expect(budsjettpostMatcherId(post({ id: "a" }), "a")).toBe(true);
  });

  it("matcher via legacyIds", () => {
    expect(budsjettpostMatcherId(post({ id: "a", legacyIds: ["gammel_a"] }), "gammel_a")).toBe(
      true,
    );
  });

  it("false når verken id eller legacyIds matcher", () => {
    expect(budsjettpostMatcherId(post({ id: "a", legacyIds: ["b"] }), "c")).toBe(false);
  });
});

describe("hentFaktiskForPost", () => {
  it("undefined når actualTotals ikke finnes", () => {
    expect(hentFaktiskForPost(undefined, post({}))).toBeUndefined();
  });

  it("summerer på tvers av id og legacyIds", () => {
    const p = post({ id: "a", legacyIds: ["gammel_a"] });
    expect(hentFaktiskForPost({ a: 100, gammel_a: 50 }, p)).toBe(150);
  });

  it("undefined når ingen nøkkel i actualTotals matcher posten (selv om andre poster har data)", () => {
    expect(hentFaktiskForPost({ annen_post: 100 }, post({ id: "a" }))).toBeUndefined();
  });
});

describe("beregnFaktiskTotalerFraHendelser", () => {
  function hendelse(overrides: Partial<BankHendelse>): BankHendelse {
    return {
      id: "h1",
      transaksjonId: "t1",
      receiptId: null,
      status: "ferdig",
      dato: "2026-06-15",
      fordelinger: [{ plasseringId: "p1", belop: 100 }],
      ...overrides,
    };
  }

  it("summerer kun ferdige hendelser", () => {
    const gyldig = new Set(["t1"]);
    const totals = beregnFaktiskTotalerFraHendelser(
      [hendelse({ status: "ferdig" }), hendelse({ id: "h2", status: "uavklart" })],
      "2026-06",
      gyldig,
    );
    expect(totals).toEqual({ p1: 100 });
  });

  it("filtrerer på måned via dato.slice(0,7)", () => {
    const gyldig = new Set(["t1"]);
    const totals = beregnFaktiskTotalerFraHendelser(
      [hendelse({ dato: "2026-07-01" })],
      "2026-06",
      gyldig,
    );
    expect(totals).toEqual({});
  });

  it("krever gyldig observasjon (transaksjonId/receiptId i settet) for ikke-manuelle hendelser", () => {
    const gyldig = new Set(["annen-transaksjon"]);
    const totals = beregnFaktiskTotalerFraHendelser([hendelse({})], "2026-06", gyldig);
    expect(totals).toEqual({});
  });

  it("manuelle hendelser (kilde:manuell) teller alltid, uten noen observasjon", () => {
    const gyldig = new Set<string>();
    const totals = beregnFaktiskTotalerFraHendelser(
      [hendelse({ transaksjonId: null, receiptId: null, kilde: "manuell" })],
      "2026-06",
      gyldig,
    );
    expect(totals).toEqual({ p1: 100 });
  });

  it("en kvitteringsbasert hendelse (receiptId) er gyldig når receiptId finnes i settet", () => {
    const gyldig = new Set(["r1"]);
    const totals = beregnFaktiskTotalerFraHendelser(
      [hendelse({ transaksjonId: null, receiptId: "r1" })],
      "2026-06",
      gyldig,
    );
    expect(totals).toEqual({ p1: 100 });
  });

  it("summerer flere fordelinger til samme plasseringId på tvers av hendelser", () => {
    const gyldig = new Set(["t1", "t2"]);
    const totals = beregnFaktiskTotalerFraHendelser(
      [
        hendelse({ fordelinger: [{ plasseringId: "p1", belop: 100 }] }),
        hendelse({
          id: "h2",
          transaksjonId: "t2",
          fordelinger: [{ plasseringId: "p1", belop: 50 }],
        }),
      ],
      "2026-06",
      gyldig,
    );
    expect(totals).toEqual({ p1: 150 });
  });

  it("ingen månedsfiltrering når monthKey er undefined", () => {
    const gyldig = new Set(["t1"]);
    const totals = beregnFaktiskTotalerFraHendelser(
      [hendelse({ dato: "2020-01-01" }), hendelse({ id: "h2", dato: "2030-12-31" })],
      undefined,
      gyldig,
    );
    expect(totals).toEqual({ p1: 200 });
  });
});

describe("finnHendelserForPost", () => {
  const p1 = post({ id: "p1" });

  it("returnerer kun rader for fordelinger som matcher posten", () => {
    const hendelser: BankHendelse[] = [
      {
        id: "h1",
        transaksjonId: "t1",
        receiptId: null,
        status: "ferdig",
        dato: "2026-06-10",
        fordelinger: [
          { plasseringId: "p1", belop: 100 },
          { plasseringId: "annen-post", belop: 999 },
        ],
      },
    ];
    const transaksjoner: BankTransaksjon[] = [{ id: "t1", status: "ok", tekst: "Rema 1000" }];
    const rader = finnHendelserForPost(
      hendelser,
      transaksjoner,
      [],
      p1,
      "2026-06",
      new Set(["t1"]),
    );
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({
      hendelseId: "h1",
      belop: 100,
      tekst: "Rema 1000",
      erKvittering: false,
    });
  });

  it("henter tekst fra kvittering (merchant) for kvitteringsbaserte hendelser", () => {
    const hendelser: BankHendelse[] = [
      {
        id: "h1",
        transaksjonId: null,
        receiptId: "r1",
        status: "ferdig",
        dato: "2026-06-10",
        fordelinger: [{ plasseringId: "p1", belop: 200 }],
      },
    ];
    const receipts: Kvittering[] = [
      { id: "r1", matchingStatus: "matched", suggestedTransactionId: null, merchant: "Kiwi" },
    ];
    const rader = finnHendelserForPost(hendelser, [], receipts, p1, "2026-06", new Set(["r1"]));
    expect(rader[0]).toMatchObject({ tekst: "Kiwi", erKvittering: true });
  });

  it("henter tekst fra kommentar for manuelle hendelser, uten observasjonskrav", () => {
    const hendelser: BankHendelse[] = [
      {
        id: "h1",
        transaksjonId: null,
        receiptId: null,
        status: "ferdig",
        dato: "2026-06-10",
        kilde: "manuell",
        kommentar: "Kontant",
        fordelinger: [{ plasseringId: "p1", belop: 50 }],
      },
    ];
    const rader = finnHendelserForPost(hendelser, [], [], p1, "2026-06", new Set());
    expect(rader[0]).toMatchObject({ tekst: "Kontant", erManuell: true });
  });

  it("sorterer nyeste dato først", () => {
    const hendelser: BankHendelse[] = [
      {
        id: "h1",
        transaksjonId: "t1",
        receiptId: null,
        status: "ferdig",
        dato: "2026-06-01",
        fordelinger: [{ plasseringId: "p1", belop: 1 }],
      },
      {
        id: "h2",
        transaksjonId: "t2",
        receiptId: null,
        status: "ferdig",
        dato: "2026-06-20",
        fordelinger: [{ plasseringId: "p1", belop: 2 }],
      },
    ];
    const rader = finnHendelserForPost(hendelser, [], [], p1, "2026-06", new Set(["t1", "t2"]));
    expect(rader.map((r) => r.hendelseId)).toEqual(["h2", "h1"]);
  });
});

describe("summerGruppeBudsjett / summerGruppeFaktisk", () => {
  function gruppe(items: BudsjettPost[]): BudsjettGruppe {
    return { id: "g1", label: "Gruppe", items };
  }

  it("summerer budsjett for gitt måned på tvers av postene i gruppen", () => {
    const g = gruppe([
      post({
        id: "a",
        months: Array.from({ length: 12 }, (_, i) => ({ budget: i === 5 ? 100 : 0, spent: 0 })),
      }),
      post({
        id: "b",
        months: Array.from({ length: 12 }, (_, i) => ({ budget: i === 5 ? 50 : 0, spent: 0 })),
      }),
    ]);
    expect(summerGruppeBudsjett(g, 5)).toBe(150);
  });

  it("bruker Faktisk fremfor lagret spent når actualTotals har data for posten", () => {
    const g = gruppe([
      post({
        id: "a",
        months: Array.from({ length: 12 }, (_, i) => ({ budget: 0, spent: i === 5 ? 30 : 0 })),
      }),
    ]);
    expect(summerGruppeFaktisk(g, 5, { a: 999 })).toBe(999);
  });

  it("faller tilbake til lagret spent når ingen Faktisk-data finnes for posten", () => {
    const g = gruppe([
      post({
        id: "a",
        months: Array.from({ length: 12 }, (_, i) => ({ budget: 0, spent: i === 5 ? 30 : 0 })),
      }),
    ]);
    expect(summerGruppeFaktisk(g, 5, {})).toBe(30);
  });
});

describe("nyPostMeta — den dokumenterte forskjellen mellom de tre skjermene", () => {
  it("Budsjett: ingen meta-nøkkel (undefined) på en ny post", () => {
    expect(nyPostMeta("budget", "bolig")).toBeUndefined();
  });

  it("Inntekter: eksplisitt null på en ny post", () => {
    expect(nyPostMeta("incomeGroups", "lonn")).toBeNull();
  });

  it("Sparing: gruppens likviditet-standard umiddelbart på en ny post", () => {
    expect(nyPostMeta("sparingGroups", "investering")).toMatchObject({ likviditet: "langsiktig" });
    expect(nyPostMeta("sparingGroups", "buffer")).toMatchObject({ likviditet: "avsatt" });
  });
});

describe("defaultMeta / defaultSparingMeta", () => {
  it("defaultMeta har forventede feltverdier", () => {
    expect(defaultMeta()).toMatchObject({
      eier: "Felles",
      niva: "opprettholde",
      oppforsel: "fast",
      konto: "Regninger",
    });
  });

  it("defaultSparingMeta faller tilbake til 'avsatt' for ukjent gruppe-id", () => {
    expect(defaultSparingMeta("ukjent_gruppe")).toMatchObject({ likviditet: "avsatt" });
  });
});

describe("budgetMonthKey / currentBudgetYear — bevisst avvik fra legacy sitt hardkodede 2026", () => {
  it("bruker faktisk inneværende år, ikke et hardkodet tall", () => {
    expect(currentBudgetYear(new Date(2030, 0, 1))).toBe(2030);
    expect(budgetMonthKey(2030, 0)).toBe("2030-01");
  });

  it("gir samme resultat som legacy sitt hardkodede '2026-MM' i 2026 selv", () => {
    expect(budgetMonthKey(currentBudgetYear(new Date(2026, 5, 15)), 5)).toBe("2026-06");
  });
});
