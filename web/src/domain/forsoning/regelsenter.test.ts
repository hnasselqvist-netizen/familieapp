import { describe, expect, it } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { RegelRecord } from "@app-types/forsoning";
import { ovrigeRegler, reglerPerNiva, spareReglerGruppert } from "./regelsenter";

const regel = (id: string, targetId: string): RegelRecord => ({
  id,
  pattern: id,
  normalizedPattern: id,
  targetType: "budget",
  targetId,
  targetName: targetId,
  mode: "suggest",
});

const grupper = {
  budgetGroups: [
    {
      id: "g",
      label: "G",
      items: [
        { id: "beskytte", name: "B", meta: { niva: "beskytte" } },
        { id: "rar", name: "R", meta: { niva: "nodvendig" } }, // niva utenfor NIVA_REKKEFOLGE
      ],
    },
  ] as unknown as BudsjettGruppe[],
  incomeGroups: [],
  sparingGroups: [
    { id: "s", label: "S", items: [{ id: "spar", name: "Spar" }] },
  ] as unknown as BudsjettGruppe[],
};

describe("ovrigeRegler", () => {
  it("fanger regler som verken er i en spare- eller nivåseksjon, så ingen regel er usynlig", () => {
    const regler = [regel("a", "beskytte"), regel("b", "rar"), regel("c", "spar"), regel("d", "x")];
    expect(ovrigeRegler(regler, grupper).map((r) => r.id)).toEqual(["b"]);
    const vist = [
      ...spareReglerGruppert(regler, grupper),
      ...reglerPerNiva(regler, grupper),
    ].flatMap((s) => s.regler.map((r) => r.id));
    expect([...vist, ...ovrigeRegler(regler, grupper).map((r) => r.id)].sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});
