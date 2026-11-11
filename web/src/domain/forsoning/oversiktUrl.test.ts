/** URL-kontrakt for Transaksjoner (#59, PC-2). */
import { describe, expect, it } from "vitest";
import { TOMT_FILTER, UTEN_EIER } from "./kontrollrader";
import {
  type OversiktTilstand,
  STANDARD_TILSTAND,
  bareSokEndret,
  erstatterHistorikk,
  lesOversiktTilstand,
  skrivOversiktTilstand,
} from "./oversiktUrl";

const les = (s: string) => lesOversiktTilstand(new URLSearchParams(s));
const skriv = (forrige: string, t: OversiktTilstand) =>
  skrivOversiktTilstand(new URLSearchParams(forrige), t).toString();

const FULL: OversiktTilstand = {
  visning: "alle",
  filter: {
    maaned: "2026-10",
    konto: "regningskonto",
    sok: "easypark oslo",
    eier: UTEN_EIER,
    post: "dagligvarer",
    status: "ferdig",
    kontroll: "endret_etter_kontroll",
  },
  sortering: { kolonne: "belop", synkende: false },
  valgt: "8829b1e4-60e3-4f18-9157-987614109094",
};

describe("lesOversiktTilstand / skrivOversiktTilstand", () => {
  it("tom URL er standardvisningen, og standarden skrives ikke", () => {
    expect(les("")).toEqual(STANDARD_TILSTAND);
    expect(skriv("", STANDARD_TILSTAND)).toBe("");
  });

  it("roundtrip for alle styrte felt", () => {
    const url = skriv("", FULL);
    expect(les(url)).toEqual(FULL);
    // Ingen beløp i URL-en.
    expect(url).not.toMatch(/belop=|kr/);
  });

  it("andre parametre (ko, verktoy, fra) bevares i sin rekkefølge", () => {
    const url = skriv("ko=forslag&fra=gangen&verktoy=import&visning=alle", {
      ...STANDARD_TILSTAND,
      visning: "alle",
      valgt: "t1",
    });
    expect(url).toBe("ko=forslag&fra=gangen&verktoy=import&visning=alle&valgt=t1");
    // Å lukke valget fjerner bare `valgt`.
    expect(skriv(url, { ...les(url), valgt: null })).toBe(
      "ko=forslag&fra=gangen&verktoy=import&visning=alle",
    );
  });

  it("ugyldige og ukjente verdier normaliseres til standard", () => {
    const t = les(
      "visning=noe&maaned=2026-13&status=slettet&kontroll=ja&sorter=hemmelig&rekkefolge=opp&valgt=../x",
    );
    expect(t).toEqual(STANDARD_TILSTAND);
    expect(les("maaned=26-10").filter.maaned).toBe("alle");
    expect(les(`konto=${"x".repeat(81)}`).filter.konto).toBe("alle");
    expect(les("konto=%0Aregning").filter.konto).toBe("alle");
    expect(les(`sok=${"a".repeat(150)}`).filter.sok).toHaveLength(100);
    expect(les("sok=a%0Ab").filter.sok).toBe("ab");
  });

  it("valgt gjelder bare «Alle transaksjoner»", () => {
    expect(les("valgt=t1").valgt).toBeNull();
    expect(les("visning=alle&valgt=t1").valgt).toBe("t1");
    expect(skriv("", { ...STANDARD_TILSTAND, valgt: "t1" })).toBe("");
  });

  it("sortering uten retning bruker kolonnens standard", () => {
    expect(les("sorter=dato").sortering).toEqual({ kolonne: "dato", synkende: true });
    expect(les("sorter=tekst").sortering).toEqual({ kolonne: "tekst", synkende: false });
    expect(les("sorter=belop&rekkefolge=synkende").sortering).toEqual({
      kolonne: "belop",
      synkende: true,
    });
  });
});

describe("bareSokEndret: søk erstatter historikk, andre endringer lager ny oppføring", () => {
  const a: OversiktTilstand = { ...STANDARD_TILSTAND, visning: "alle" };
  it("bare søket", () => {
    expect(bareSokEndret(a, { ...a, filter: { ...TOMT_FILTER, sok: "e" } })).toBe(true);
  });
  it("filtervalg, sortering, valg eller visning", () => {
    expect(bareSokEndret(a, { ...a, filter: { ...TOMT_FILTER, konto: "mc" } })).toBe(false);
    expect(bareSokEndret(a, { ...a, valgt: "t1" })).toBe(false);
    expect(bareSokEndret(a, { ...a, sortering: { kolonne: "tekst", synkende: false } })).toBe(
      false,
    );
    expect(bareSokEndret(a, { ...a, visning: "behandling" })).toBe(false);
    expect(bareSokEndret(a, a)).toBe(false);
  });
});

describe("erstatterHistorikk: første tegn lager én oppføring, resten av søket erstatter", () => {
  const a: OversiktTilstand = { ...STANDARD_TILSTAND, visning: "alle" };
  const sok = (s: string): OversiktTilstand => ({ ...a, filter: { ...TOMT_FILTER, sok: s } });
  it("nytt søk lager oppføring", () => {
    expect(erstatterHistorikk(a, sok("r"))).toBe(false);
  });
  it("søk i gang erstatter, også når det tømmes", () => {
    expect(erstatterHistorikk(sok("r"), sok("re"))).toBe(true);
    expect(erstatterHistorikk(sok("re"), sok(""))).toBe(true);
  });
  it("annen endring under søk lager oppføring", () => {
    expect(erstatterHistorikk(sok("r"), { ...sok("r"), valgt: "t1" })).toBe(false);
  });
});
