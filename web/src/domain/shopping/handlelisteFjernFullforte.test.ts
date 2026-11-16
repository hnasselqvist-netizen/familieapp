import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import { lagFjernFullfortePlan, vurderFjernFullforte } from "./handlelisteFjernFullforte";

const rad = (id: string, name: string, done: boolean): ShoppingItem => ({
  id,
  itemId: `v-${id}`,
  name,
  amount: "2",
  cat: "Diverse",
  done,
  raaGrunnlag: `raa-${id}`,
});
const LISTE = [rad("m", "Melk", true), rad("b", "Brød", false), rad("f", "Fløte", true)];
const node = (endring: Record<string, unknown> = {}) => ({
  ...Object.fromEntries(LISTE.map((r) => [r.id, { ...r }])),
  _ops: { r1: { tool: "x" } },
  ...endring,
});
const alleLike = () => true;

describe("lagFjernFullfortePlan", () => {
  it("bare radene som er fullført i listen slik den vises, med rågrunnlag", () => {
    const plan = lagFjernFullfortePlan(LISTE);
    expect(plan.rader.map((r) => [r.id, r.grunnlag, r.sett.done])).toEqual([
      ["m", "raa-m", true],
      ["f", "raa-f", true],
    ]);
  });
});

describe("vurderFjernFullforte", () => {
  const plan = lagFjernFullfortePlan(LISTE);

  it("uendrede rader fjernes samlet", () => {
    expect(vurderFjernFullforte(node(), plan, alleLike)).toEqual({
      utfall: "vurdert",
      fjern: ["m", "f"],
      detaljer: {
        fjernet: [
          { id: "m", navn: "Melk" },
          { id: "f", navn: "Fløte" },
        ],
        beholdt: [],
        borte: [],
      },
    });
  });

  it("endret, tilbakekrysset, endret rågrunnlag og borte skilles; nytilkomne rader er ikke med", () => {
    const v = vurderFjernFullforte(
      node({
        m: { ...LISTE[0], amount: "3" },
        f: undefined,
        n: { ...rad("n", "Nøtter", true) },
      }),
      plan,
      alleLike,
    );
    expect(v).toMatchObject({
      utfall: "vurdert",
      fjern: [],
      detaljer: {
        beholdt: [{ id: "m", navn: "Melk", grunn: "mengde 2 → 3" }],
        borte: [{ id: "f", navn: "Fløte" }],
      },
    });

    const w = vurderFjernFullforte(
      node({ f: { ...LISTE[2], done: false } }),
      plan,
      (id) => id !== "m",
    );
    expect(w).toMatchObject({
      fjern: [],
      detaljer: {
        beholdt: [
          { id: "m", grunn: expect.stringMatching(/endret på en annen enhet/) },
          { id: "f", grunn: "status fullført → ikke fullført" },
        ],
      },
    });
  });

  it("uventet form på noden eller dobbel rad i planen: konflikt", () => {
    expect(vurderFjernFullforte("tekst", plan, alleLike).utfall).toBe("konflikt");
    expect(
      vurderFjernFullforte(node(), { rader: [plan.rader[0]!, plan.rader[0]!] }, alleLike).utfall,
    ).toBe("konflikt");
  });

  it("reservert nøkkel eller rad med uventet form i planen: beholdes, aldri fjernet", () => {
    const v = vurderFjernFullforte(
      node({ m: "tekst" }),
      { rader: [...plan.rader, { id: "_ops", sett: plan.rader[0]!.sett }] },
      alleLike,
    );
    expect(v).toMatchObject({ fjern: ["f"] });
    expect(v.utfall === "vurdert" && v.detaljer.beholdt.map((b) => b.id)).toEqual(["m", "_ops"]);
  });
});
