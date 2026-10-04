import { describe, expect, it } from "vitest";
import {
  ANTALL_BOTTER,
  byggKontroll,
  type RaaForsoningsnoder,
  stabilJson,
} from "./cutoverKontroll";

const LEST = "2026-10-04T18:00:00.000Z";

const t = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  dato: "2026-09-10",
  tekst: `BUTIKK ${id}`,
  belop: 4711.33,
  retning: "ut",
  konto: "Felles",
  status: "ny",
  ...o,
});
const h = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "2026-09-11T10:00:00.000Z",
  oppdatert: "2026-09-11T10:00:00.000Z",
  ...o,
});

/** Et sunt øyeblikksbilde i legacy-form, med alle referansetyper i bruk. */
function sunt(): RaaForsoningsnoder {
  return {
    transaksjoner: [
      t("t1", { hendelseId: "h1" }),
      t("t2", { status: "intern_overforing", motpartTransaksjonId: "t3" }),
      t("t3", { status: "intern_overforing", motpartTransaksjonId: "t2" }),
      t("t4"),
    ],
    hendelser: [
      h("h1", { transaksjonId: "t1", receiptId: "k1", regelId: "r1" }),
      h("h2", { status: "pa_vent", transaksjonId: null, kilde: "manuell" }),
    ],
    receipts: [
      {
        id: "k1",
        hendelseId: "h1",
        matchingStatus: "matched",
        driveFileId: "drive-fil-1",
        updatedAt: "2026-09-11T10:00:00.000Z",
      },
      { id: "k2", transactionId: "t4", imageUrl: "data:image/jpeg;base64,AAAA" },
      { id: "k3", matchingStatus: "suggested", suggestedTransactionId: "t4", forkastet: true },
    ],
    rules: [{ id: "r1", mode: "auto", pattern: "BUTIKK" }],
  };
}

describe("byggKontroll — struktur", () => {
  it("sunt øyeblikksbilde: strukturOk, antall, fordeling, bilder og ingen brudd", () => {
    const r = byggKontroll(sunt(), { lest: LEST });
    expect(r.format).toBe(1);
    expect(r.lest).toBe(LEST);
    expect(r.vurdering).toEqual({ strukturOk: true, merknader: [] });
    expect(r.noder.transaksjoner).toMatchObject({
      form: "array",
      antall: 4,
      hull: [],
      utenId: { antall: 0, nokler: [] },
      dupliserteIder: [],
      fordeling: { intern_overforing: 2, ny: 2 },
    });
    expect(r.noder.hendelser.fordeling).toEqual({ ferdig: 1, pa_vent: 1 });
    expect(r.noder.receipts.fordeling).toEqual({ "(mangler)": 1, matched: 1, suggested: 1 });
    expect(r.noder.rules.fordeling).toEqual({ auto: 1 });
    expect(r.kvitteringsbilder).toEqual({ drive: 1, base64: 1, annenImageUrl: 0, forkastet: 1 });
    expect(r.referansebrudd.every((b) => b.antall === 0)).toBe(true);
    expect(r.referansebrudd.map((b) => b.type)).toEqual([
      "transaksjoner.hendelseId→hendelser",
      "transaksjoner.motpartTransaksjonId→transaksjoner",
      "hendelser.transaksjonId→transaksjoner",
      "hendelser.receiptId→receipts",
      "hendelser.regelId→rules",
      "receipts.hendelseId→hendelser",
      "receipts.transactionId→transaksjoner",
      "receipts.suggestedTransactionId→transaksjoner",
    ]);
  });

  it("tomme noder er gyldige (form «tom», antall 0)", () => {
    const r = byggKontroll(
      { transaksjoner: null, hendelser: undefined, receipts: null, rules: null },
      { lest: LEST },
    );
    expect(r.vurdering.strukturOk).toBe(true);
    for (const n of Object.values(r.noder)) expect(n).toMatchObject({ form: "tom", antall: 0 });
  });

  it("avvik: hull, objekt-form, manglende id, duplikat og ikke-objekter meldes", () => {
    const raa = sunt();
    const hendelser: unknown[] = [h("h1"), undefined, h("h1"), { status: "ferdig" }];
    raa.hendelser = hendelser;
    raa.rules = { a: { id: "r1", mode: "auto" } };
    raa.receipts = [{ id: "k1" }, "ugyldig"];
    const r = byggKontroll(raa, { lest: LEST });

    expect(r.vurdering.strukturOk).toBe(false);
    expect(r.noder.hendelser).toMatchObject({
      form: "array_med_hull",
      antall: 3,
      hull: [1],
      utenId: { antall: 1, nokler: ["3"] },
      dupliserteIder: [{ id: "h1", antall: 2 }],
    });
    expect(r.noder.rules).toMatchObject({ form: "objekt", ikkeArrayNokler: ["a"] });
    expect(r.noder.receipts).toMatchObject({ ugyldigeElementer: 1, utenId: { antall: 1 } });
    expect(r.vurdering.merknader).toEqual([
      "hendelser: 1 hull i arrayen",
      "hendelser: 1 elementer uten id",
      "hendelser: 1 dupliserte id-er",
      "receipts: 1 elementer er ikke objekter",
      "receipts: 1 elementer uten id",
      "rules: lest som objekt, ikke array",
    ]);
  });

  it("null i en array regnes som hull, som undefined", () => {
    const raa = sunt();
    raa.rules = [{ id: "r1", mode: "auto" }, null];
    expect(byggKontroll(raa, { lest: LEST }).noder.rules).toMatchObject({
      form: "array_med_hull",
      antall: 1,
      hull: [1],
    });
  });

  it("en primitiv verdi der en node skulle vært gir form «ugyldig»", () => {
    const raa = sunt();
    raa.rules = "tull";
    const r = byggKontroll(raa, { lest: LEST });
    expect(r.noder.rules.form).toBe("ugyldig");
    expect(r.vurdering.merknader).toContain("rules: lest som ugyldig, ikke array");
  });

  it("brutte referanser telles per type, med id-ene som peker feil", () => {
    const raa = sunt();
    (raa.hendelser as Record<string, unknown>[]).push(
      h("h3", { transaksjonId: "t-borte", receiptId: "k-borte", regelId: "r-slettet" }),
    );
    (raa.receipts as Record<string, unknown>[]).push({ id: "k4", hendelseId: "h-borte" });
    const r = byggKontroll(raa, { lest: LEST });
    const brudd = Object.fromEntries(r.referansebrudd.map((b) => [b.type, b]));
    expect(brudd["hendelser.transaksjonId→transaksjoner"]).toEqual({
      type: "hendelser.transaksjonId→transaksjoner",
      antall: 1,
      eksempler: ["h3"],
    });
    expect(brudd["hendelser.receiptId→receipts"]?.antall).toBe(1);
    expect(brudd["hendelser.regelId→rules"]?.antall).toBe(1);
    expect(brudd["receipts.hendelseId→hendelser"]?.eksempler).toEqual(["k4"]);
    // Brudd alene gjør ikke strukturen ugyldig — de sammenlignes før/etter.
    expect(r.vurdering.strukturOk).toBe(true);
  });

  it("returnerer aldri beløp, tekst, datoer eller bilder — kun antall, id-er og hasher", () => {
    const raa = sunt();
    const json = JSON.stringify(byggKontroll(raa, { lest: LEST }));
    // (Ingen rene heks-strenger her — de kunne tilfeldigvis forekomme i en hash.)
    for (const hemmelig of [
      "BUTIKK",
      "Felles",
      "2026-09-10",
      "base64,AAAA",
      "4711.33",
      "drive-fil",
    ]) {
      expect(json).not.toContain(hemmelig);
    }
  });

  it("rører ikke input", () => {
    const raa = sunt();
    const foer = JSON.stringify(raa);
    byggKontroll(raa, { lest: LEST, endretEtter: "2026-01-01T00:00:00Z" });
    expect(JSON.stringify(raa)).toBe(foer);
  });
});

describe("byggKontroll — sammenligning før/etter", () => {
  it("samme data → like digester; rekkefølgen på nøklene i et element spiller ingen rolle", () => {
    const a = byggKontroll(sunt(), { lest: LEST });
    const omstokket = sunt();
    omstokket.rules = [{ pattern: "BUTIKK", mode: "auto", id: "r1" }];
    const b = byggKontroll(omstokket, { lest: LEST, forrige: a.sammenligningsgrunnlag });
    expect(b.sammenligningsgrunnlag.noder).toEqual(a.sammenligningsgrunnlag.noder);
    expect(b.sammenligning?.noder.rules).toEqual({
      antallFor: 1,
      antallEtter: 1,
      endret: false,
      endredeBotter: [],
    });
    expect(a.sammenligningsgrunnlag.noder.transaksjoner.botter).toHaveLength(ANTALL_BOTTER);
  });

  it("én endret transaksjon → nøyaktig én endret bøtte i transaksjoner, resten urørt", () => {
    const foer = byggKontroll(sunt(), { lest: LEST });
    const raa = sunt();
    (raa.transaksjoner as Record<string, unknown>[])[3]!.status = "ignorert";
    const etter = byggKontroll(raa, { lest: LEST, forrige: foer.sammenligningsgrunnlag });
    expect(etter.sammenligning?.forrigeLest).toBe(LEST);
    expect(etter.sammenligning?.noder.transaksjoner).toMatchObject({
      antallFor: 4,
      antallEtter: 4,
      endret: true,
    });
    expect(etter.sammenligning?.noder.transaksjoner.endredeBotter).toHaveLength(1);
    for (const n of ["hendelser", "receipts", "rules"] as const) {
      expect(etter.sammenligning?.noder[n].endret).toBe(false);
    }
    expect(etter.sammenligning?.referansebrudd).toEqual([]);
  });

  it("endretEtter forklarer endringer med tidsstempel; uten tidsstempel meldes bøtta som uforklart", () => {
    const foer = byggKontroll(sunt(), { lest: LEST });
    const raa = sunt();
    // Forklart: hendelsen er oppdatert etter før-snapshotet.
    (raa.hendelser as Record<string, unknown>[])[1] = h("h2", {
      status: "ferdig",
      oppdatert: "2026-10-04T18:05:00.000Z",
    });
    // Uforklart: en transaksjon er endret uten updatedAt.
    (raa.transaksjoner as Record<string, unknown>[])[3]!.status = "ignorert";
    const etter = byggKontroll(raa, {
      lest: "2026-10-04T18:10:00.000Z",
      forrige: foer.sammenligningsgrunnlag,
      endretEtter: LEST,
    });
    expect(etter.endretEtter?.noder.hendelser).toEqual({
      antall: 1,
      ider: ["h2"],
      viaReferanse: { antall: 0, ider: [] },
    });
    expect(etter.endretEtter?.noder.transaksjoner).toEqual({
      antall: 0,
      ider: [],
      viaReferanse: { antall: 0, ider: [] },
    });
    expect(etter.sammenligning?.noder.hendelser.uforklarteBotter).toEqual([]);
    expect(etter.sammenligning?.noder.transaksjoner.uforklarteBotter).toHaveLength(1);
    expect(etter.vurdering.merknader).toEqual([
      `transaksjoner: endringer uten tidsstempel i bøtte ${etter.sammenligning?.noder.transaksjoner.uforklarteBotter?.[0]}`,
    ]);
    // Uforklarte endringer er en merknad, ikke et strukturbrudd.
    expect(etter.vurdering.strukturOk).toBe(true);
  });

  it("Bankimport-beslutning (transaksjon uten updatedAt) forklares via den nye hendelsen", () => {
    const foer = byggKontroll(sunt(), { lest: LEST });
    const raa = sunt();
    // Slik React/legacy lagrer en beslutning: transaksjonen får status og
    // hendelseId (uten tidsstempel), hendelsen er ny med opprettet/oppdatert.
    Object.assign((raa.transaksjoner as Record<string, unknown>[])[3]!, {
      status: "ferdig",
      hendelseId: "h9",
    });
    (raa.hendelser as Record<string, unknown>[]).push(
      h("h9", {
        transaksjonId: "t4",
        opprettet: "2026-10-04T18:20:00.000Z",
        oppdatert: "2026-10-04T18:20:00.000Z",
      }),
    );
    const etter = byggKontroll(raa, {
      lest: "2026-10-04T18:30:00.000Z",
      forrige: foer.sammenligningsgrunnlag,
      endretEtter: LEST,
    });
    expect(etter.endretEtter?.noder.hendelser).toMatchObject({ antall: 1, ider: ["h9"] });
    expect(etter.endretEtter?.noder.transaksjoner).toEqual({
      antall: 0,
      ider: [],
      viaReferanse: { antall: 1, ider: ["t4"] },
    });
    expect(etter.sammenligning?.noder.transaksjoner).toMatchObject({
      endret: true,
      uforklarteBotter: [],
    });
    expect(etter.sammenligning?.noder.hendelser).toMatchObject({
      antallFor: 2,
      antallEtter: 3,
      uforklarteBotter: [],
    });
    expect(etter.vurdering).toEqual({ strukturOk: true, merknader: [] });
  });

  it("endretEtter: tidsstempel lik grensen teller med", () => {
    const raa = sunt();
    const r = byggKontroll(raa, { lest: LEST, endretEtter: "2026-09-11T10:00:00.000Z" });
    expect(r.endretEtter?.noder.hendelser.ider).toEqual(["h1", "h2"]);
    expect(r.endretEtter?.noder.receipts.ider).toEqual(["k1"]);
  });

  it("viaReferanse virker i begge retninger: pekt på av, og peker på, et endret element", () => {
    const ny = "2026-10-04T18:20:00.000Z";
    // Endret hendelse peker på t4 (t4 peker ikke tilbake) → t4 forklart.
    const fram = sunt();
    (fram.hendelser as Record<string, unknown>[]).push(
      h("h9", { transaksjonId: "t4", oppdatert: ny }),
    );
    expect(
      byggKontroll(fram, { lest: LEST, endretEtter: LEST }).endretEtter?.noder.transaksjoner
        .viaReferanse,
    ).toEqual({ antall: 1, ider: ["t4"] });
    // t4 peker på en endret hendelse (hendelsen peker ikke tilbake) → t4 forklart.
    const bak = sunt();
    (bak.transaksjoner as Record<string, unknown>[])[3]!.hendelseId = "h9";
    (bak.hendelser as Record<string, unknown>[]).push(h("h9", { oppdatert: ny }));
    expect(
      byggKontroll(bak, { lest: LEST, endretEtter: LEST }).endretEtter?.noder.transaksjoner
        .viaReferanse,
    ).toEqual({ antall: 1, ider: ["t4"] });
  });

  it("nye referansebrudd meldes med før/etter-antall", () => {
    const foer = byggKontroll(sunt(), { lest: LEST });
    const raa = sunt();
    (raa.transaksjoner as Record<string, unknown>[])[3]!.hendelseId = "h-borte";
    const etter = byggKontroll(raa, { lest: LEST, forrige: foer.sammenligningsgrunnlag });
    expect(etter.sammenligning?.referansebrudd).toEqual([
      { type: "transaksjoner.hendelseId→hendelser", for: 0, etter: 1 },
    ]);
    expect(etter.vurdering.merknader).toContain(
      "Referansebrudd økt for transaksjoner.hendelseId→hendelser: 0 → 1",
    );
  });

  it("nytt element endrer antall og akkurat én bøtte", () => {
    const foer = byggKontroll(sunt(), { lest: LEST });
    const raa = sunt();
    (raa.rules as Record<string, unknown>[]).push({ id: "r2", mode: "suggest" });
    const etter = byggKontroll(raa, { lest: LEST, forrige: foer.sammenligningsgrunnlag });
    expect(etter.sammenligning?.noder.rules).toMatchObject({
      antallFor: 1,
      antallEtter: 2,
      endret: true,
    });
    expect(etter.sammenligning?.noder.rules.endredeBotter).toHaveLength(1);
  });
});

describe("stabilJson", () => {
  it("sorterer nøkler rekursivt og hopper over undefined", () => {
    expect(stabilJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(
      '{"a":{"d":[1,{"x":1,"y":2}]},"b":1}',
    );
  });
});
