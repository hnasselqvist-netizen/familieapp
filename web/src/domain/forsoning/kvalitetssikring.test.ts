import { describe, expect, it } from "vitest";
import type { Fordeling, HendelseRecord, TransaksjonRecord } from "@app-types/forsoning";
import {
  GRUNNLAG_VERSJON,
  type Kontrollhandling,
  kontrollgrunnlag,
  kontrollgrunnlagTekst,
  kontrollstatus,
  medKvalitetssikring,
  sammeGjeldende,
  sha256Hex,
  utenKvalitetssikring,
} from "./kvalitetssikring";

/** Syntetiske data — aldri ekte transaksjoner. */
const t = (o: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id: "t1",
  dato: "2026-09-12",
  tekst: "EASYPARK",
  belop: 123.45,
  retning: "ut",
  konto: "helen",
  status: "ny",
  ...o,
});
const f = (o: Partial<Fordeling> = {}): Fordeling => ({
  plasseringId: "parkering",
  plasseringType: "budget",
  plasseringNavn: "Parkering",
  belop: 123.45,
  eiere: [{ person: "Felles", prosent: 100 }],
  ...o,
});
const h = (o: Partial<HendelseRecord> = {}): HendelseRecord => ({
  id: "h1",
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: "t1",
  receiptId: null,
  fordelinger: [f()],
  dato: "2026-09-12",
  regelId: null,
  opprettet: "2026-09-12T10:00:00Z",
  oppdatert: "2026-09-12T10:00:00Z",
  ...o,
});
const G = (tt = t(), hh: HendelseRecord[] = [h()]) => kontrollgrunnlag(tt, hh);
const base = G();

describe("sha256Hex", () => {
  it.each([
    "",
    "abc",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(64),
    "a".repeat(1000),
    "æøå EASYPARK – 123,45 kr 🧾",
  ])("er lik WebCrypto sin SHA-256 for %#", async (s) => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(sha256Hex(s)).toBe(hex);
  });

  it("kjente testvektorer (FIPS 180-4)", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("kontrollgrunnlag", () => {
  it.each<[string, TransaksjonRecord, HendelseRecord[]]>([
    ["dato", t({ dato: "2026-09-13" }), [h()]],
    ["konto", t({ konto: "felleskonto" }), [h()]],
    ["beløp", t({ belop: 123.46 }), [h()]],
    ["retning", t({ retning: "inn" }), [h()]],
    ["ignorert", t({ status: "ignorert" }), [h()]],
    ["intern overføring", t({ behandlingstype: "intern_overforing" }), [h()]],
    ["motpart", t({ motpartTransaksjonId: "t9" }), [h()]],
    ["hendelsesstatus", t(), [h({ status: "pa_vent", paaVentAarsak: "kvittering" })]],
    ["kvitteringskobling", t(), [h({ receiptId: "k1" })]],
    ["ingen hendelse", t(), []],
    ["post", t(), [h({ fordelinger: [f({ plasseringId: "bompenger" })] })]],
    ["type", t(), [h({ fordelinger: [f({ plasseringType: "income" })] })]],
    ["fordelingsbeløp", t(), [h({ fordelinger: [f({ belop: 100 }), f({ belop: 23.45 })] })]],
    [
      "eier",
      t(),
      [
        h({
          fordelinger: [
            f({
              eiere: [
                { person: "Helen", prosent: 50 },
                { person: "Eivind", prosent: 50 },
              ],
            }),
          ],
        }),
      ],
    ],
  ])("endres når %s endres", (_navn, tt, hh) => {
    expect(G(tt, hh)).not.toBe(base);
  });

  it.each<[string, TransaksjonRecord, HendelseRecord[]]>([
    ["tidsstempler", t(), [h({ opprettet: "2030-01-01T00:00:00Z", oppdatert: "2030-01-01" })]],
    ["regel-id", t(), [h({ regelId: "r9" })]],
    ["tekst", t({ tekst: "EasyPark AS" }), [h()]],
    ["læringsmetadata", t({ laeringsKey: "x", matchetNavn: "Y", hendelseId: "h1" }), [h()]],
    ["historisk postnavn", t(), [h({ fordelinger: [f({ plasseringNavn: "Parkering (gml)" })] })]],
    [
      "eier med 0 %",
      t(),
      [
        h({
          fordelinger: [
            f({
              eiere: [
                { person: "Felles", prosent: 100 },
                { person: "Helen", prosent: 0 },
              ],
            }),
          ],
        }),
      ],
    ],
    ["klokkeslett i dato", t({ dato: "2026-09-12T23:59:00" }), [h()]],
    ["øre-avrunding", t({ belop: 123.450000001 }), [h()]],
  ])("er uendret når bare %s endres", (_navn, tt, hh) => {
    expect(G(tt, hh)).toBe(base);
  });

  it("rekkefølgen på fordelinger og eiere betyr ikke noe", () => {
    const a = f({
      plasseringId: "a",
      belop: 100,
      eiere: [
        { person: "Helen", prosent: 50 },
        { person: "Eivind", prosent: 50 },
      ],
    });
    const b = f({ plasseringId: "b", belop: 23.45 });
    const bAa = f({ ...a, eiere: [...a.eiere].reverse() });
    expect(G(t(), [h({ fordelinger: [a, b] })])).toBe(G(t(), [h({ fordelinger: [b, bAa] })]));
  });

  it("grunnlaget er lesbar kanonisk tekst med versjon og uten tekst/tid", () => {
    const tekst = kontrollgrunnlagTekst(t(), [h()]);
    expect(JSON.parse(tekst)).toMatchObject({ v: GRUNNLAG_VERSJON, id: "t1", ore: 12345 });
    expect(tekst).not.toMatch(/EASYPARK|oppdatert|opprettet/);
  });
});

describe("kontrollstatus og spor", () => {
  const handling = (o: Partial<Kontrollhandling> = {}): Kontrollhandling => ({
    grunnlag: base,
    tid: "2026-10-31T11:00:00Z",
    av: "uid-helen",
    avNavn: "Helen",
    sporId: "s1",
    ...o,
  });

  it("ikke kontrollert → kvalitetssikret → endret etter kontroll", () => {
    expect(kontrollstatus(undefined, base)).toBe("ikke_kontrollert");
    const k = medKvalitetssikring(null, "t1", handling());
    expect(kontrollstatus(k, base)).toBe("kvalitetssikret");
    expect(kontrollstatus(k, G(t({ belop: 99 })))).toBe("endret_etter_kontroll");
    // En ny grunnlagsversjon gjør ikke en gammel kontroll grønn.
    expect(kontrollstatus({ ...k, gjeldende: { ...k.gjeldende!, versjon: 0 } }, base)).toBe(
      "endret_etter_kontroll",
    );
  });

  it("oppheving og ny kontroll bevarer hele sporet", () => {
    const k1 = medKvalitetssikring(null, "t1", handling());
    const k2 = utenKvalitetssikring(
      k1,
      "t1",
      handling({ sporId: "s2", tid: "2026-10-31T12:00:00Z" }),
    );
    expect(kontrollstatus(k2, base)).toBe("ikke_kontrollert");
    const k3 = medKvalitetssikring(
      k2,
      "t1",
      handling({ sporId: "s3", av: "uid-eivind", avNavn: "Eivind" }),
    );
    expect(Object.keys(k3.spor)).toEqual(["s1", "s2", "s3"]);
    expect(k3.spor.s2!.handling).toBe("opphevet");
    expect(k3.gjeldende).toMatchObject({ av: "uid-eivind", avNavn: "Eivind" });
  });

  it("samtidighetsvakten skiller ulike kontroller", () => {
    const a = medKvalitetssikring(null, "t1", handling()).gjeldende;
    const b = medKvalitetssikring(null, "t1", handling({ tid: "2026-10-31T11:00:01Z" })).gjeldende;
    expect(sammeGjeldende(a, a)).toBe(true);
    expect(sammeGjeldende(null, null)).toBe(true);
    expect(sammeGjeldende(a, b)).toBe(false);
    expect(sammeGjeldende(a, null)).toBe(false);
  });
});
