import { describe, expect, it } from "vitest";
import {
  SENT_FORSOK,
  besluttKommentar,
  kommentarAvsluttetTekst,
  kommentarBerettigelse,
  kommentarNaatilstandTekst,
  kommentarTekst,
  lesKommentar,
  normaliserKommentar,
  nyttKommentarForsokTekst,
  vurderKommentarNaatilstand,
} from "./hendelseKommentar";

/**
 * Kommentar på manuell hendelse (#59, ordre 7002365160, #141). Syntetiske
 * hendelser i råform, med ukjente felt.
 */
const NAA = "2026-11-19T08:00:00.000Z";
const MANUELL = (over: Record<string, unknown> = {}) => ({
  id: "h1",
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [{ budgetItemId: "b1", belop: 250, plasseringType: "budget", x: 1 }],
  dato: "2026-11-01",
  regelId: null,
  kilde: "manuell",
  kommentar: "Gammel",
  opprettet: "2026-11-01T10:00:00.000Z",
  oppdatert: "2026-11-01T10:00:00.000Z",
  ukjentFelt: { a: 1 },
  ...over,
});
const ANNEN = { id: "h2", kilde: "manuell", kommentar: "Urørt", fordelinger: [] };
const uten = (o: Record<string, unknown>, k: string) => {
  const c = { ...o };
  delete c[k];
  return c;
};

describe("normaliserKommentar", () => {
  it("trimmer som manuell registrering; tom eller bare mellomrom er ingen kommentar", () => {
    expect(normaliserKommentar("  Middag med Ola \n")).toBe("Middag med Ola");
    expect(normaliserKommentar(" \n\t ")).toBeUndefined();
    expect(normaliserKommentar("")).toBeUndefined();
  });
});

describe("kommentarBerettigelse", () => {
  it("bare vanlig manuell: ikke mellomværende, ikke bank- eller kvitteringskoblet", () => {
    expect(kommentarBerettigelse(MANUELL())).toBe("ok");
    expect(kommentarBerettigelse(uten(MANUELL(), "transaksjonId"))).toBe("ok");
    expect(kommentarBerettigelse(MANUELL({ kilde: undefined }))).toBe("ikkeManuell");
    expect(kommentarBerettigelse(MANUELL({ kilde: "bank" }))).toBe("ikkeManuell");
    expect(kommentarBerettigelse(MANUELL({ mellomvaerende: { avtaleId: "a1" } }))).toBe(
      "mellomvaerende",
    );
    expect(kommentarBerettigelse(MANUELL({ transaksjonId: "t1" }))).toBe("koblet");
    expect(kommentarBerettigelse(MANUELL({ receiptId: "r1" }))).toBe("koblet");
    expect(kommentarBerettigelse("x")).toBe("ikkeManuell");
  });
});

describe("lesKommentar", () => {
  it("null/manglende er tom; ikke-tom streng er tekst; alt annet er ugyldig", () => {
    expect(lesKommentar(MANUELL({ kommentar: null }))).toEqual({ type: "tom" });
    expect(lesKommentar(uten(MANUELL(), "kommentar"))).toEqual({ type: "tom" });
    expect(lesKommentar(MANUELL())).toEqual({ type: "tekst", tekst: "Gammel" });
    expect(lesKommentar(MANUELL({ kommentar: 42 }))).toEqual({ type: "ugyldig" });
    expect(lesKommentar(MANUELL({ kommentar: "" }))).toEqual({ type: "ugyldig" });
    expect(lesKommentar(MANUELL({ kommentar: { t: "x" } }))).toEqual({ type: "ugyldig" });
  });
});

describe("besluttKommentar", () => {
  const maal = { id: "h1", kilde: "Gammel" };

  it("endring: bare `kommentar` og `oppdatert` endres; alt annet og andre hendelser står", () => {
    const r = besluttKommentar([ANNEN, MANUELL()], maal, "Ny tekst", NAA);
    expect(r).toEqual({
      type: "skriv",
      liste: [ANNEN, MANUELL({ kommentar: "Ny tekst", oppdatert: NAA })],
    });
  });

  it("sett ny kommentar der ingen fantes (null eller manglende)", () => {
    const r = besluttKommentar(
      [MANUELL({ kommentar: null })],
      { id: "h1", kilde: undefined },
      "Ny",
      NAA,
    );
    expect(r).toEqual({ type: "skriv", liste: [MANUELL({ kommentar: "Ny", oppdatert: NAA })] });
  });

  it("tømming fjerner nøkkelen og setter `oppdatert`", () => {
    const r = besluttKommentar([MANUELL()], maal, undefined, NAA);
    expect(r.type).toBe("skriv");
    const el = (r as { liste: Record<string, unknown>[] }).liste[0]!;
    expect(Object.hasOwn(el, "kommentar")).toBe(false);
    expect(el).toEqual(uten(MANUELL({ oppdatert: NAA }), "kommentar"));
  });

  it("identisk normalisert verdi: `allerede`, ingen skriving og ingen ny `oppdatert`", () => {
    expect(besluttKommentar([MANUELL()], maal, "Gammel", NAA)).toEqual({
      type: "stopp",
      utfall: "allerede",
    });
    expect(
      besluttKommentar(
        [MANUELL({ kommentar: null })],
        { id: "h1", kilde: undefined },
        undefined,
        NAA,
      ),
    ).toEqual({ type: "stopp", utfall: "allerede" });
  });

  it("kommentaren er endret siden utkastet startet: `konflikt`", () => {
    expect(besluttKommentar([MANUELL({ kommentar: "Annen enhet" })], maal, "Ny", NAA)).toEqual({
      type: "stopp",
      utfall: "konflikt",
    });
    expect(besluttKommentar([MANUELL({ kommentar: null })], maal, "Ny", NAA)).toEqual({
      type: "stopp",
      utfall: "konflikt",
    });
  });

  it("andre felt endret siden utkastet startet: skrives på fersk verdi, de andre endringene står", () => {
    const fersk = MANUELL({ status: "paa_vent", fordelinger: [{ budgetItemId: "b2", belop: 99 }] });
    expect(besluttKommentar([fersk], maal, "Ny", NAA)).toEqual({
      type: "skriv",
      liste: [{ ...fersk, kommentar: "Ny", oppdatert: NAA }],
    });
  });

  it("målet er id, ikke indeks: en reindeksert liste treffer samme hendelse", () => {
    const r = besluttKommentar([ANNEN, ANNEN, MANUELL()], maal, "Ny", NAA);
    expect((r as { liste: unknown[] }).liste[2]).toEqual(
      MANUELL({ kommentar: "Ny", oppdatert: NAA }),
    );
  });

  it("duplikat-id: `tvetydig`; slettet: `mangler` (aldri gjenopprettet)", () => {
    expect(besluttKommentar([MANUELL(), MANUELL()], maal, "Ny", NAA)).toEqual({
      type: "stopp",
      utfall: "tvetydig",
    });
    expect(besluttKommentar([ANNEN], maal, "Ny", NAA)).toEqual({
      type: "stopp",
      utfall: "mangler",
    });
    expect(besluttKommentar([], maal, "Ny", NAA)).toEqual({ type: "stopp", utfall: "mangler" });
  });

  it("mellomværende, bank- eller kvitteringskoblet hendelse avvises (`ikkeBerettiget`)", () => {
    for (const over of [
      { mellomvaerende: { avtaleId: "a1" } },
      { transaksjonId: "t1" },
      { receiptId: "r1" },
      { kilde: undefined },
    ]) {
      expect(besluttKommentar([MANUELL(over)], maal, "Ny", NAA)).toEqual({
        type: "stopp",
        utfall: "ikkeBerettiget",
      });
    }
  });

  it("ugyldig lagret form endres aldri", () => {
    expect(besluttKommentar([MANUELL({ kommentar: 7 })], maal, "Ny", NAA)).toEqual({
      type: "stopp",
      utfall: "ugyldig",
    });
  });
});

describe("vurderKommentarNaatilstand", () => {
  const F = { kontekst: "familie1|s1", hendelseId: "h1", kilde: "Gammel", sendt: "Ny" };
  it("sammenligner nåtilstanden med DET SENDTE forsøket", () => {
    expect(vurderKommentarNaatilstand([MANUELL({ kommentar: "Ny" })], F)).toBe("likSendt");
    expect(vurderKommentarNaatilstand([MANUELL()], F)).toBe("likKilde");
    expect(vurderKommentarNaatilstand([MANUELL({ kommentar: "X" })], F)).toBe("annet");
    expect(vurderKommentarNaatilstand([], F)).toBe("mangler");
    expect(vurderKommentarNaatilstand([MANUELL(), MANUELL()], F)).toBe("tvetydig");
    expect(vurderKommentarNaatilstand([MANUELL({ transaksjonId: "t" })], F)).toBe("ikkeBerettiget");
    expect(vurderKommentarNaatilstand([MANUELL({ kommentar: 1 })], F)).toBe("ugyldig");
    expect(
      vurderKommentarNaatilstand([uten(MANUELL(), "kommentar")], { ...F, sendt: undefined }),
    ).toBe("likSendt");
  });
});

describe("tekster", () => {
  it("kontrollen påstår aldri at forsøket sikkert er lagret eller ikke", () => {
    for (const o of [
      "likSendt",
      "likKilde",
      "annet",
      "mangler",
      "tvetydig",
      "ikkeBerettiget",
      "ugyldig",
      "avvist",
      "byttet",
      "ikkeLest",
    ] as const) {
      const t = kommentarNaatilstandTekst(o);
      expect(t).toContain("Om akkurat dette forsøket ble lagret, er fortsatt ikke avklart.");
      expect(t).not.toMatch(/ble ikke lagret|Bekreftet|er lagret\./);
    }
  });
  it("et sikkert avslag på retry gjelder bare det nye forsøket", () => {
    for (const u of [
      "konflikt",
      "mangler",
      "tvetydig",
      "ikkeBerettiget",
      "ugyldig",
      "avvist",
      "byttet",
      "stengt",
      "ikkeLest",
    ] as const) {
      const t = nyttKommentarForsokTekst(u);
      expect(t).toMatch(/^Det nye forsøket er ikke lagret: /);
      expect(t).toContain("Det første forsøket er fortsatt ikke avklart.");
    }
    for (const u of ["lagret", "allerede"] as const) {
      expect(nyttKommentarForsokTekst(u)).toContain(SENT_FORSOK);
    }
    for (const v of ["godta", "grunnlag", "lukk"] as const) {
      expect(kommentarAvsluttetTekst(v)).toContain(SENT_FORSOK);
    }
  });
  it("utfall av «Lagre kommentar»", () => {
    expect(kommentarTekst("konflikt")).toMatch(/Ingenting er lagret\. Utkastet ditt står/);
    expect(kommentarTekst("mangler")).toMatch(/ikke gjenopprettet/);
    expect(kommentarTekst("ukjent")).toMatch(/Vi vet ikke om kommentaren ble lagret/);
  });
});
