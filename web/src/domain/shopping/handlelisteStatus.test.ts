import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import { lagStatusPlan, vurderStatus } from "./handlelisteStatus";

const MELK: ShoppingItem = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const node = (m: Record<string, unknown> | null = { ...MELK }) => ({ m, _ops: { r: 1 } });

describe("vurderStatus", () => {
  it("planen er raden og den valgte boolske målstatusen", () => {
    expect(lagStatusPlan(MELK, true)).toEqual({
      id: "m",
      navn: "Melk",
      itemId: "v-melk",
      maal: true,
    });
  });

  it("begge retninger: sett når fersk status er en annen, ellers skrivefri `allerede`", () => {
    expect(vurderStatus(node(), lagStatusPlan(MELK, true))).toEqual({ utfall: "sett" });
    expect(vurderStatus(node(), lagStatusPlan(MELK, false))).toEqual({ utfall: "allerede" });
    const ferdig = { ...MELK, done: true };
    expect(vurderStatus(node(ferdig), lagStatusPlan(ferdig, false))).toEqual({ utfall: "sett" });
    expect(vurderStatus(node(ferdig), lagStatusPlan(MELK, true))).toEqual({ utfall: "allerede" });
  });

  it("urelaterte feltendringer, historikk og ukjente felt hindrer ikke målstatus", () => {
    expect(
      vurderStatus(
        node({ ...MELK, amount: "9", cat: "Diverse", sammenslaing: { opId: "x" }, ukjent: 1 }),
        lagStatusPlan(MELK, true),
      ),
    ).toEqual({ utfall: "sett" });
  });

  it("posten er borte: `borte` (opprettes aldri)", () => {
    expect(vurderStatus(node(null), lagStatusPlan(MELK, true))).toEqual({ utfall: "borte" });
    expect(vurderStatus(null, lagStatusPlan(MELK, true))).toEqual({ utfall: "borte" });
  });

  it.each([
    ["nytt navn", { name: "Lettmelk" }, /nå «Lettmelk»/],
    ["byttet varekobling", { itemId: "v-annen" }, /varekoblingen er byttet/],
    ["fjernet varekobling", { itemId: null }, /varekoblingen er fjernet/],
  ])("radidentitet endret (%s): konflikt, status endres ikke", (_n, endring, tekst) => {
    const u = vurderStatus(node({ ...MELK, ...endring }), lagStatusPlan(MELK, true));
    expect(u.utfall).toBe("konflikt");
    expect((u as { grunn: string }).grunn).toMatch(tekst);
    expect((u as { grunn: string }).grunn).toMatch(/Status er ikke endret/);
  });

  it("varekobling lagt til på en rad uten kobling: konflikt", () => {
    const uten = { ...MELK, itemId: null };
    expect(vurderStatus(node({ ...MELK }), lagStatusPlan(uten, true))).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/varekobling er lagt til/),
    });
  });

  it("reservert nøkkel eller uventet form: konflikt", () => {
    expect(vurderStatus(node(), { ...lagStatusPlan(MELK, true), id: "_ops" }).utfall).toBe(
      "konflikt",
    );
    expect(vurderStatus({ m: "tekst" }, lagStatusPlan(MELK, true)).utfall).toBe("konflikt");
    expect(vurderStatus("tekst", lagStatusPlan(MELK, true)).utfall).toBe("konflikt");
  });
});
