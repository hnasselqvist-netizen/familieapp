import { describe, expect, it } from "vitest";
import {
  MAKS_NOTAT,
  besluttNotat,
  lesNotat,
  normaliserNotat,
  notatTekst,
  vurderNotatOppfolging,
} from "./notat";

/** Eksportform av en post med prioriteter og ukjente felt (syntetisk). */
const POST = (notat?: unknown) => ({
  ".priority": 3,
  name: "Taco",
  lettvint: true,
  _mcp: { kilde: "test" },
  shoppingBase: { "0": { id: "sb1", name: "Lefser", ".priority": 1 } },
  ...(notat !== undefined ? { notat } : {}),
});

describe("normaliserNotat", () => {
  it("bevarer linjeskift og gjør CRLF/CR til LF", () => {
    expect(normaliserNotat("Kjøp\r\nlefser\rtidlig")).toBe("Kjøp\nlefser\ntidlig");
    expect(normaliserNotat("  innrykk\n\nsiste  ")).toBe("  innrykk\n\nsiste  ");
  });
  it("tomt eller bare mellomrom/linjeskift er «ingen notat»", () => {
    expect(normaliserNotat("")).toBeUndefined();
    expect(normaliserNotat(" \n\t\r\n ")).toBeUndefined();
  });
});

describe("lesNotat", () => {
  it("leser streng, streng med prioritet og manglende notat", () => {
    expect(lesNotat(POST())).toEqual({ type: "tom" });
    expect(lesNotat(POST("Hei"))).toEqual({ type: "tekst", tekst: "Hei" });
    expect(lesNotat(POST({ ".value": "Hei", ".priority": 5 }))).toEqual({
      type: "tekst",
      tekst: "Hei",
    });
  });
  it("ukjent eller ugyldig råform er `ugyldig`, aldri normalisert", () => {
    expect(lesNotat(POST(42))).toEqual({ type: "ugyldig" });
    expect(lesNotat(POST({ tekst: "x" }))).toEqual({ type: "ugyldig" });
    expect(lesNotat(POST(""))).toEqual({ type: "ugyldig" });
    expect(lesNotat(POST(["a"]))).toEqual({ type: "ugyldig" });
    expect(lesNotat("bare tekst")).toEqual({ type: "ugyldig" });
    expect(lesNotat({ ".value": "x", ".priority": 1 })).toEqual({ type: "ugyldig" });
  });
});

describe("besluttNotat", () => {
  it("nytt notat: bare `notat` legges til; prioriteter og andre felt står", () => {
    const r = besluttNotat(POST(), undefined, "Lag dobbel porsjon\nFrys halvparten");
    expect(r).toEqual({
      type: "skriv",
      eksport: { ...POST(), notat: "Lag dobbel porsjon\nFrys halvparten" },
    });
  });
  it("endring: bare `notat` endres; en prioritet på notatet bevares", () => {
    expect(besluttNotat(POST("Gammelt"), "Gammelt", "Nytt")).toEqual({
      type: "skriv",
      eksport: { ...POST(), notat: "Nytt" },
    });
    expect(besluttNotat(POST({ ".value": "Gammelt", ".priority": 9 }), "Gammelt", "Nytt")).toEqual({
      type: "skriv",
      eksport: { ...POST(), notat: { ".value": "Nytt", ".priority": 9 } },
    });
  });
  it("tømming fjerner nøkkelen", () => {
    const r = besluttNotat(POST("Gammelt"), "Gammelt", undefined);
    expect(r).toEqual({ type: "skriv", eksport: POST() });
    expect(Object.hasOwn((r as { eksport: object }).eksport, "notat")).toBe(false);
  });
  it("samtidig endret notat gir konflikt uten skriving", () => {
    expect(besluttNotat(POST("Fra annen enhet"), "Gammelt", "Mitt")).toEqual({
      type: "stopp",
      utfall: "konflikt",
    });
    expect(besluttNotat(POST("Fra annen enhet"), undefined, "Mitt")).toEqual({
      type: "stopp",
      utfall: "konflikt",
    });
    expect(besluttNotat(POST(), "Gammelt", "Mitt")).toEqual({ type: "stopp", utfall: "konflikt" });
  });
  it("allerede likt utkastet (f.eks. nytt forsøk etter tapt svar): ingen skriving", () => {
    expect(besluttNotat(POST("Mitt"), "Gammelt", "Mitt")).toEqual({
      type: "stopp",
      utfall: "allerede",
    });
    expect(besluttNotat(POST(), "Gammelt", undefined)).toEqual({
      type: "stopp",
      utfall: "allerede",
    });
  });
  it("ugyldig lagret form endres aldri", () => {
    expect(besluttNotat(POST(42), undefined, "Mitt")).toEqual({ type: "stopp", utfall: "ugyldig" });
    expect(besluttNotat("x", undefined, "Mitt")).toEqual({ type: "stopp", utfall: "ugyldig" });
  });
  it("for langt utkast stoppes før noe annet", () => {
    expect(besluttNotat(POST(), undefined, "x".repeat(MAKS_NOTAT + 1))).toEqual({
      type: "stopp",
      utfall: "forLang",
    });
    expect(besluttNotat(POST(), undefined, "x".repeat(MAKS_NOTAT)).type).toBe("skriv");
  });
});

describe("vurderNotatOppfolging", () => {
  it("skiller lagret, ikke lagret, endret, mangler og ugyldig", () => {
    expect(vurderNotatOppfolging(POST("Mitt"), "Gammelt", "Mitt")).toBe("lagret");
    expect(vurderNotatOppfolging(POST("Gammelt"), "Gammelt", "Mitt")).toBe("ikkeLagret");
    expect(vurderNotatOppfolging(POST("Annet"), "Gammelt", "Mitt")).toBe("endret");
    expect(vurderNotatOppfolging(null, "Gammelt", "Mitt")).toBe("mangler");
    expect(vurderNotatOppfolging(POST(7), "Gammelt", "Mitt")).toBe("ugyldig");
    expect(vurderNotatOppfolging(POST(), "Gammelt", undefined)).toBe("lagret");
  });
});

describe("notatTekst", () => {
  it("konflikt og ukjent sier at ingenting/ukjent er lagret", () => {
    expect(notatTekst("konflikt", "Taco")).toMatch(/Ingenting er lagret\. Utkastet ditt står/);
    expect(notatTekst("ukjent", "Taco")).toMatch(/Vi vet ikke om notatet på «Taco» ble lagret/);
    expect(notatTekst("mangler", "Taco")).toMatch(/ikke gjenopprettet/);
  });
});
