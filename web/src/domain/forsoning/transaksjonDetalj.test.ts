/** Detaljgrunnlag for sidepanelet (#59, PC-2). Syntetiske data. */
import { describe, expect, it } from "vitest";
import type { KvitteringRecord, RegelRecord } from "@app-types/forsoning";
import { kvitteringerForTransaksjon, regelgrunnlag } from "./transaksjonDetalj";

const regel = { id: "r1", pattern: "REMA", targetName: "Dagligvarer" } as RegelRecord;

describe("regelgrunnlag", () => {
  it("nåværende regel, slettet regel, lært forslag og ingen", () => {
    expect(regelgrunnlag({}, { regelId: "r1" }, [regel])).toEqual({ type: "regel", regel });
    expect(regelgrunnlag({}, { regelId: "borte" }, [regel])).toEqual({
      type: "regel_slettet",
      regelId: "borte",
    });
    expect(
      regelgrunnlag(
        { laertKobling: { budgetItemId: "d", navn: "Dagligvarer", gruppe: "Mat", flerbruk: true } },
        null,
        [regel],
      ),
    ).toEqual({ type: "laert_forslag", navn: "Dagligvarer", gruppe: "Mat", flerbruk: true });
    expect(regelgrunnlag({}, { regelId: null }, [regel])).toEqual({ type: "ingen" });
  });
});

describe("kvitteringerForTransaksjon: alle koblingsveier", () => {
  const k = (id: string, o: Partial<KvitteringRecord> = {}) => ({ id, ...o }) as KvitteringRecord;
  const h = { id: "h1", receiptId: "k2" };

  it("transaksjon, hendelse og kvittering-til-hendelse; flere koblinger vises alle", () => {
    const { koblet, forkastet } = kvitteringerForTransaksjon({ id: "t1" }, h, [
      k("k1", { transactionId: "t1" }),
      k("k2"),
      k("k3", { hendelseId: "h1" }),
      k("k4", { transactionId: "t2", hendelseId: "h2" }),
    ]);
    expect(koblet.map((x) => [x.kvittering.id, x.veier])).toEqual([
      ["k1", ["transaksjon"]],
      ["k2", ["hendelse_peker"]],
      ["k3", ["kvittering_peker"]],
    ]);
    expect(forkastet).toBe(0);
  });

  it("samme kvittering via flere veier telles én gang med alle veiene", () => {
    const { koblet } = kvitteringerForTransaksjon({ id: "t1" }, { id: "h1", receiptId: "k1" }, [
      k("k1", { transactionId: "t1", hendelseId: "h1" }),
    ]);
    expect(koblet).toEqual([
      {
        kvittering: expect.objectContaining({ id: "k1" }),
        veier: ["transaksjon", "hendelse_peker", "kvittering_peker"],
      },
    ]);
  });

  it("forkastede kvitteringer gjenopplives ikke, bare telles", () => {
    const { koblet, forkastet } = kvitteringerForTransaksjon({ id: "t1" }, null, [
      k("k1", { transactionId: "t1", forkastet: true }),
    ]);
    expect(koblet).toEqual([]);
    expect(forkastet).toBe(1);
  });

  it("uten hendelse og uten kobling: ingen", () => {
    expect(kvitteringerForTransaksjon({ id: "t1" }, null, [k("k1")])).toEqual({
      koblet: [],
      forkastet: 0,
    });
  });
});
