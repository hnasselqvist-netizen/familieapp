/**
 * Differensiell karakterisering av transaksjonsoversikten (§Issue #34
 * R3-les): legacy-closurene i `BankimportScreen` trekkes ut ORDRETT fra
 * `index.html` (kun lesing), evalueres med samme omgivende variabler som
 * komponenten har, og kjøres side om side med portene.
 */
import { describe, expect, it } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import {
  extractConstArrow,
  extractInlineExpression,
  legacyContains,
  loadLegacy,
} from "../../test/legacy";
import * as port from "./transaksjonsoversikt";

// --- Fixtures ---------------------------------------------------------------

const t = (id: string, felt: Partial<TransaksjonRecord>): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000 OSLO",
  belop: 250,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...felt,
});

const transaksjoner: TransaksjonRecord[] = [
  t("t-ny", {}),
  t("t-krever", { status: "krever_vurdering", konto: "MC", dato: "2026-08-03" }),
  t("t-forslag", { status: "foresoatt_match", konto: "Regningskonto 1234" }),
  t("t-matchet-uten", {
    status: "matchet",
    matchetNavn: "Mat",
    laertKobling: { budgetItemId: "p-mat", navn: "Mat", flerbruk: true },
  }),
  t("t-ferdig-1", { status: "ny", hendelseId: "h-1", konto: "helen", dato: "2025-12-31" }),
  t("t-ferdig-2", { status: "ny", hendelseId: "h-2", konto: "Eivind lønn", retning: "inn" }),
  t("t-vent", { status: "krever_vurdering", konto: "krav", tekst: "Vipps Ola" }),
  t("t-vent-ukjent", { konto: null, importkilde: "DNB" }),
  t("t-uplassert", { konto: "" }),
  t("t-uplassert-forslag", { status: "foresoatt_match" }),
  t("t-ignorert", { status: "ignorert" }),
  t("t-intern", { behandlingstype: "intern_overforing", konto: "dnb" }),
  t("t-intern-forslag", { behandlingstype: "intern_overforing", status: "foresoatt_match" }),
  t("t-uten-dato", { dato: "", tekst: "" }),
  t("t-annen-konto", { konto: "Sparekonto" }),
  t("t-kvittering", { hendelseId: "h-kv", tekst: "KIWI 505", dato: "2026-09-12" }),
  // Kvittering koblet, men hendelsen er på vent: koblet ≠ lukket.
  t("t-kvittering-vent", { hendelseId: "h-kv-vent", tekst: "COOP", dato: "2026-09-14" }),
];

const fordeling = (plasseringId: string, plasseringNavn: string, type = "budget") => ({
  plasseringId,
  plasseringType: type as "budget" | "income" | "sparing",
  plasseringNavn,
  belop: 100,
  eiere: [{ person: "Felles", prosent: 100 }],
});

const h = (id: string, felt: Partial<HendelseRecord>): HendelseRecord => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "2026-09-10T00:00:00Z",
  oppdatert: "2026-09-10T00:00:00Z",
  ...felt,
});

const hendelser: HendelseRecord[] = [
  h("h-1", {
    transaksjonId: "t-ferdig-1",
    regelId: "r-flerbruk",
    fordelinger: [fordeling("p-gammel-id", "Mat (gammelt navn)")],
  }),
  h("h-2", {
    transaksjonId: "t-ferdig-2",
    regelId: "r-borte",
    fordelinger: [
      fordeling("i-lonn", "Lønn", "income"),
      fordeling("s-buffer", "Buffer", "sparing"),
      fordeling("ukjent", "Ukjent post"),
    ],
  }),
  h("h-vent", {
    transaksjonId: "t-vent",
    status: "pa_vent",
    paaVentAarsak: "venter_paa_kvittering",
  }),
  h("h-vent-ukjent", { transaksjonId: "t-vent-ukjent", status: "pa_vent", paaVentAarsak: "x" }),
  h("h-uplassert", { transaksjonId: "t-uplassert", status: "uplassert" }),
  h("h-uplassert-forslag", { transaksjonId: "t-uplassert-forslag", status: "uplassert" }),
  h("h-kv", { transaksjonId: "t-kvittering", receiptId: "k-1", fordelinger: [] }),
  h("h-kv-vent", {
    transaksjonId: "t-kvittering-vent",
    status: "pa_vent",
    paaVentAarsak: "maa_splittes",
    receiptId: "k-1",
  }),
  h("h-manuell", { kilde: "manuell", fordelinger: [fordeling("p-mat", "Mat")] }),
];

const rules = [
  { id: "r-flerbruk", multiUse: true },
  { id: "r-enkel", multiUse: false },
] as unknown as RegelRecord[];

const post = (id: string, name: string, legacyIds?: string[]) => ({
  id,
  name,
  months: [],
  ...(legacyIds ? { legacyIds } : {}),
});
const gruppe = (id: string, label: string, items: ReturnType<typeof post>[]): BudsjettGruppe => ({
  id,
  label,
  items,
});
const budgetGroups = [
  gruppe("g1", "Husholdning", [post("p-mat", "Mat", ["p-gammel-id"])]),
  // Samme post-id i to grupper: legacy lar SISTE gruppe vinne.
  gruppe("g2", "Diverse", [post("p-mat-kopi", "Mat 2", ["p-gammel-id"])]),
];
const incomeGroups = [gruppe("gi", "Lønn", [post("i-lonn", "Lønn Helen")])];
const sparingGroups = [gruppe("gs", "Buffer", [post("s-buffer", "Buffer")])];
const grupper = { budgetGroups, incomeGroups, sparingGroups };

const receipts = [
  { id: "k-1", merchant: "Kiwi" },
  { id: "k-direkte", transactionId: "t-ny", merchant: "Rema" },
] as unknown as KvitteringRecord[];

// --- Legacy ------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => unknown;
const globals = loadLegacy<Record<string, AnyFn>>({
  functions: ["finnHendelseForTransaksjon", "findReceipt"],
  constArrows: ["budsjettpostMatcherId"],
  constValues: ["UKLAR_AARSAK_LABEL"],
});

interface LegacyBankimport {
  KONTOER: unknown;
  normaliserKonto: AnyFn;
  loesEffektivStatus: AnyFn;
  fordelingTekst: AnyFn;
  beskrivTilstand: AnyFn;
  grupper: Record<"vurdering" | "forslag" | "paavent", TransaksjonRecord[]>;
  kontoFilter: AnyFn;
  atMaanedAlternativer: unknown;
  alleTransaksjonerFiltrert: TransaksjonRecord[];
}

/** Komponentens closures, i samme rekkefølge og med samme frie variabler. */
function legacyBankimport(scope: {
  transaksjoner: TransaksjonRecord[];
  valgtKonto?: string;
  atMaaned?: string;
  atKonto?: string;
  atSok?: string;
}) {
  const v = (name: string) => `const ${name} = ${extractInlineExpression(`const ${name} = `)};`;
  const body = [
    v("KONTOER"),
    extractConstArrow("normaliserKonto"),
    extractConstArrow("loesEffektivStatus"),
    v("TYPE_LABEL_AT"),
    extractConstArrow("fordelingTekst"),
    extractConstArrow("beskrivTilstand"),
    "const alle = transaksjoner||[];",
    v("grupper"),
    extractConstArrow("kontoFilter"),
    v("MAANED_NAVN"),
    v("atMaanedNokler"),
    v("atMaanedAlternativer"),
    v("alleTransaksjonerFiltrert"),
    "return { KONTOER, normaliserKonto, loesEffektivStatus, fordelingTekst, beskrivTilstand, grupper, kontoFilter, atMaanedAlternativer, alleTransaksjonerFiltrert };",
  ].join("\n");
  const env: Record<string, unknown> = {
    ...globals,
    hendelser,
    rules,
    receipts,
    budgetGroups,
    incomeGroups,
    sparingGroups,
    valgtKonto: "alle",
    atMaaned: "alle",
    atKonto: "alle",
    atSok: "",
    ...scope,
  };
  return new Function(...Object.keys(env), `"use strict";\n${body}`)(
    ...Object.values(env),
  ) as LegacyBankimport;
}

const L = legacyBankimport({ transaksjoner });
const ids = (liste: { id: string }[]) => liste.map((x) => x.id);

describe("Transaksjonsoversikt ≡ legacy BankimportScreen", () => {
  it("komponenten bygger arbeidskøen fra hele transaksjonslisten", () => {
    expect(legacyContains("  const alle = transaksjoner||[];\n")).toBe(true);
  });

  it("konstanter: KONTOER og UKLAR_AARSAK_LABEL", () => {
    expect(port.KONTOER).toEqual(L.KONTOER);
    expect(port.UKLAR_AARSAK_LABEL).toEqual(globals.UKLAR_AARSAK_LABEL);
  });

  it("effektiv status per transaksjon (hendelse først, ellers gamle felt)", () => {
    for (const tr of transaksjoner) {
      expect(port.loesEffektivStatus(tr, hendelser, rules), tr.id).toEqual(
        L.loesEffektivStatus(tr),
      );
    }
  });

  it("presis tilstand og fordelingstekst (legacyIds, siste gruppe vinner, ukjent post)", () => {
    for (const tr of transaksjoner) {
      expect(port.beskrivTilstand(tr, hendelser, rules, grupper), tr.id).toEqual(
        L.beskrivTilstand(tr),
      );
    }
    for (const f of hendelser.flatMap((x) => x.fordelinger)) {
      expect(port.fordelingTekst(f, grupper)).toBe(L.fordelingTekst(f));
    }
    expect(port.fordelingTekst(hendelser[0]!.fordelinger[0]!, grupper)).toBe(
      "Kostnad → Diverse / Mat (gammelt navn)",
    );
  });

  it("arbeidskøen: tre faner i lagret rekkefølge", () => {
    const ko = port.arbeidsko(transaksjoner, hendelser, rules);
    for (const s of ["forslag", "paavent"] as const) {
      expect(ids(ko[s]), s).toEqual(ids(L.grupper[s]));
    }
    // «Matchet uten hendelse» regnes som plassert i arbeidskøen (men som
    // økonomisk uferdig i kontrolloversikten, se beskrivTilstand).
    expect(ids(ko.vurdering)).not.toContain("t-matchet-uten");
    // Legacy-særegenhet (karakterisert): en hendelse med status «uplassert»
    // gjør at transaksjonen faller utenfor ALLE tre fanene i legacy (har
    // hendelse → ikke «vurdering», ikke pa_vent → ikke «På vent»).
    for (const s of ["vurdering", "forslag", "paavent"] as const) {
      expect(ids(L.grupper[s])).not.toContain("t-uplassert");
    }
    // Bevisst avvik (pre-cutover 2): React viser den i «Krever vurdering»,
    // i lagret rekkefølge — ellers identisk med legacy. Står den allerede i
    // «Forslag til match», vises den bare der (ingen duplikat).
    expect(ids(ko.vurdering)).toEqual(
      ids(
        transaksjoner.filter(
          (x) => ids(L.grupper.vurdering).includes(x.id) || x.id === "t-uplassert",
        ),
      ),
    );
    expect(ids(ko.forslag)).toContain("t-uplassert-forslag");
    expect(ids(ko.vurdering)).not.toContain("t-uplassert-forslag");
    expect(
      port.beskrivTilstand(
        transaksjoner.find((x) => x.id === "t-uplassert")!,
        hendelser,
        rules,
        grupper,
      ).kategori,
    ).toBe("uferdig");
  });

  it("kontofilter for hver konto, i begge modusene", () => {
    const ko = port.arbeidsko(transaksjoner, hendelser, rules);
    for (const { id } of port.KONTOER) {
      const Lk = legacyBankimport({ transaksjoner, valgtKonto: id });
      expect(ids(port.filtrerPaKonto(ko.vurdering, id)), id).toEqual(
        ids(Lk.kontoFilter(ko.vurdering) as TransaksjonRecord[]),
      );
      expect(ids(port.filtrerPaKonto(transaksjoner, id)), id).toEqual(
        ids(Lk.kontoFilter(transaksjoner) as TransaksjonRecord[]),
      );
    }
  });

  it("månedsvalg fra faktiske datoer, nyest først", () => {
    expect(port.maanedAlternativer(transaksjoner)).toEqual(L.atMaanedAlternativer);
    expect(port.maanedAlternativer([])).toEqual(
      legacyBankimport({ transaksjoner: [] }).atMaanedAlternativer,
    );
  });

  it("«Alle transaksjoner»: måned × konto × søk, sortert nyest først", () => {
    const maaneder = ["alle", "2026-09", "2025-12", "2030-01"];
    const kontoer = ["alle", "MC", "felleskonto", "helen"];
    const sok = ["", "rema", "  VIPPS ", "finnes-ikke"];
    for (const maaned of maaneder) {
      for (const konto of kontoer) {
        for (const s of sok) {
          const Lf = legacyBankimport({
            transaksjoner,
            atMaaned: maaned,
            atKonto: konto,
            atSok: s,
          });
          expect(
            ids(port.filtrerAlleTransaksjoner(transaksjoner, { maaned, konto, sok: s })),
            `${maaned}|${konto}|${s}`,
          ).toEqual(ids(Lf.alleTransaksjonerFiltrert));
        }
      }
    }
  });

  it("kvitteringsmerker på raden (direkte opplasting, via hendelse, lukket)", () => {
    const lagtTil = extractInlineExpression("const eksisterendeReceipt = ");
    const koblet = extractInlineExpression("const koblettMatchetReceipt = ");
    const lukket = extractInlineExpression("const erLukketViaKvittering = ");
    for (const tr of transaksjoner) {
      const koblettViaHendelse = globals.finnHendelseForTransaksjon!(hendelser, tr.id);
      const scope = { ...globals, t: tr, receipts, hendelser, koblettViaHendelse };
      const ev = (expr: string) =>
        new Function(...Object.keys(scope), `"use strict"; return (${expr});`)(
          ...Object.values(scope),
        );
      expect(port.radKvittering(tr, hendelser, receipts), tr.id).toEqual({
        lagtTil: ev(lagtTil),
        koblet: ev(koblet) ?? null,
        lukketViaKvittering: ev(lukket),
      });
    }
  });
});
