import { describe, expect, it } from "vitest";
import type {
  Fordeling,
  HendelseRecord,
  KvitteringRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import {
  GRUNNLAG_VERSJON,
  type Kontrollhandling,
  kontrollgrunnlag,
  kontrollgrunnlagTekst,
  kontrollstatus,
  medKvalitetssikring,
  sammeGjeldende,
  kobledeKvitteringer,
  sha256Hex,
  vedleggsavtrykk,
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
    ["banktekst (annen leverandør, samme dato/beløp/fordeling)", t({ tekst: "APCOA" }), [h()]],
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

  it("grunnlaget er lesbar kanonisk tekst med versjon og banktekst, uten tidsstempler", () => {
    const tekst = kontrollgrunnlagTekst(t(), [h()]);
    expect(JSON.parse(tekst)).toMatchObject({
      v: GRUNNLAG_VERSJON,
      id: "t1",
      ore: 12345,
      tekst: "EASYPARK",
    });
    expect(tekst).not.toMatch(/oppdatert|opprettet|2026-09-12T10/);
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

describe("kontrollgrunnlag — kvitteringer og vedlegg (review 5722586456)", () => {
  const kv = (o: Partial<KvitteringRecord> = {}): KvitteringRecord =>
    ({
      id: "k1",
      merchant: "EasyPark",
      purchaseDate: "2026-09-12",
      total: 123.45,
      splits: [
        { targetType: "budget", targetId: "parkering", targetName: "Parkering", amount: 123.45 },
      ],
      ...o,
    }) as KvitteringRecord;
  const medKv = (r: KvitteringRecord[], hh: HendelseRecord[] = [h({ receiptId: "k1" })]) =>
    kontrollgrunnlag(t(), hh, r);
  const kobletBase = medKv([kv()]);

  it("følger alle koblingsveier: receiptId, hendelseId og transactionId", () => {
    const tt = t();
    const hh = h();
    expect(kobledeKvitteringer(tt, h({ receiptId: "k1" }), [kv()]).map((r) => r.id)).toEqual([
      "k1",
    ]);
    expect(kobledeKvitteringer(tt, hh, [kv({ hendelseId: "h1" })]).map((r) => r.id)).toEqual([
      "k1",
    ]);
    expect(kobledeKvitteringer(tt, null, [kv({ transactionId: "t1" })]).map((r) => r.id)).toEqual([
      "k1",
    ]);
    expect(kobledeKvitteringer(tt, hh, [kv({ transactionId: "t9", hendelseId: "h9" })])).toEqual(
      [],
    );
    // Flere/motstridende koblinger tas alle med, sortert.
    expect(
      kobledeKvitteringer(tt, h({ receiptId: "k2" }), [
        kv({ id: "k3", transactionId: "t1" }),
        kv({ id: "k2" }),
        kv({ id: "k1", hendelseId: "h1" }),
      ]).map((r) => r.id),
    ).toEqual(["k1", "k2", "k3"]);
  });

  it("en kvittering koblet bare via hendelseId eller transactionId påvirker grunnlaget", () => {
    expect(kontrollgrunnlag(t(), [h()], [kv({ hendelseId: "h1" })])).not.toBe(G());
    expect(kontrollgrunnlag(t(), [h()], [kv({ transactionId: "t1" })])).not.toBe(G());
    expect(kontrollgrunnlag(t(), [h()], [kv({ transactionId: "t9" })])).toBe(G());
  });

  it.each<[string, KvitteringRecord[]]>([
    ["butikk", [kv({ merchant: "APCOA" })]],
    ["kjøpsdato", [kv({ purchaseDate: "2026-09-13" })]],
    ["total", [kv({ total: 120 })]],
    ["forkastet", [kv({ forkastet: true })]],
    ["splitt", [kv({ splits: [] })]],
    ["Drive-vedlegg", [kv({ driveFileId: "drive-1" })]],
    ["lagret bilde", [kv({ imageUrl: "data:image/png;base64,AAAA" })]],
    ["kvittering fjernet", []],
    ["ekstra kvittering", [kv(), kv({ id: "k2", transactionId: "t1" })]],
  ])("endres når kvitteringens %s endres", (_navn, r) => {
    expect(medKv(r)).not.toBe(kobletBase);
  });

  it("bildeinnhold: endring midt i et stort felt gir nytt avtrykk; samme innhold gir samme", () => {
    const stor = (c: string) =>
      `data:image/png;base64,${"A".repeat(200_000)}${c}${"A".repeat(200_000)}`;
    const a = vedleggsavtrykk(kv({ imageUrl: stor("B") }));
    const b = vedleggsavtrykk(kv({ imageUrl: stor("C") }));
    expect(a).not.toEqual(b);
    expect(vedleggsavtrykk(kv({ imageUrl: stor("B") }))).toEqual(a);
    expect(vedleggsavtrykk(kv())).toBeNull();
  });

  it("tidsstempler og matchingsmetadata på kvitteringen er ufarlige", () => {
    expect(
      medKv([
        {
          ...kv(),
          createdAt: "2030-01-01",
          updatedAt: "2030-01-01",
          matchingUpdatedAt: "2030",
          ocrText: "x",
        } as KvitteringRecord,
      ]),
    ).toBe(kobletBase);
  });
});

describe("kontrollgrunnlag — avledet motpost (review 6543489123)", () => {
  const fm = (o: Partial<NonNullable<TransaksjonRecord["forventetMotpost"]>> = {}) => ({
    konto: "MC",
    dato: "2026-09-12",
    bekreftet: "2026-09-13T08:00:00Z",
    kilde: { belopOre: -12345, retning: "ut" as const, konto: "helen", dato: "2026-09-12" },
    ...o,
  });
  const intern = (o = {}) => t({ behandlingstype: "intern_overforing", forventetMotpost: fm(o) });
  const base2 = kontrollgrunnlag(intern(), []);

  it.each<[string, Partial<NonNullable<TransaksjonRecord["forventetMotpost"]>>]>([
    ["MC → felleskonto", { konto: "felleskonto" }],
    ["månedsskifte", { dato: "2026-10-01" }],
    [
      "kildeavtrykk (beløp)",
      { kilde: { belopOre: -12000, retning: "ut", konto: "helen", dato: "2026-09-12" } },
    ],
    ["kildeavtrykk mangler (gyldighet)", { kilde: undefined }],
    ["erstattet av importert motpost", { erstattetAv: "t9" }],
    ["avsluttet", { avsluttet: "2026-10-31T10:00:00Z" }],
  ])("endres ved %s", (_navn, o) => {
    expect(kontrollgrunnlag(intern(o), [])).not.toBe(base2);
  });

  it("avledet motpost fjernet endrer grunnlaget", () => {
    expect(kontrollgrunnlag(t({ behandlingstype: "intern_overforing" }), [])).not.toBe(base2);
  });

  it.each<[string, Partial<NonNullable<TransaksjonRecord["forventetMotpost"]>>]>([
    ["bekreftet-tid", { bekreftet: "2030-01-01T00:00:00Z" }],
    ["klokkeslett i dato", { dato: "2026-09-12T23:00:00" }],
  ])("er uendret ved ufarlig %s", (_navn, o) => {
    expect(kontrollgrunnlag(intern(o), [])).toBe(base2);
  });

  it("avsluttet-tidsstempel alene (avsluttet → avsluttet senere) er ufarlig", () => {
    expect(kontrollgrunnlag(intern({ avsluttet: "2026-10-31T10:00:00Z" }), [])).toBe(
      kontrollgrunnlag(intern({ avsluttet: "2026-11-01T12:00:00Z" }), []),
    );
  });
});
