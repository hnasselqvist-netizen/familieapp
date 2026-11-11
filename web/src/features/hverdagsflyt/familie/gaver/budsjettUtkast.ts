import type { Budsjettvalg, FastBudsjett } from "@app-types/gaver";
import { belopFelt, tolkPlanBelop } from "@domain/gaver/gaver";

/** Budsjettvalg i et skjema: typen pluss beløpet som tekst til det lagres. */
export interface BudsjettUtkast {
  type: Budsjettvalg["type"];
  tekst: string;
}

export const budsjettUtkast = (b: Budsjettvalg | undefined): BudsjettUtkast =>
  !b || b.type === "arv"
    ? { type: "arv", tekst: "" }
    : b.type === "ikke_satt"
      ? { type: "ikke_satt", tekst: "" }
      : { type: "belop", tekst: belopFelt(b.belopOre) };

/** `null` = ugyldig beløp. */
export function tilBudsjettvalg(u: BudsjettUtkast): Budsjettvalg | null {
  if (u.type === "arv") return { type: "arv" };
  if (u.type === "ikke_satt") return { type: "ikke_satt" };
  const ore = tolkPlanBelop(u.tekst);
  return ore === null || ore === undefined ? null : { type: "belop", belopOre: ore };
}

export function tilFastBudsjett(u: BudsjettUtkast): FastBudsjett | null {
  const b = tilBudsjettvalg(u.type === "arv" ? { ...u, type: "ikke_satt" } : u);
  return b && b.type !== "arv" ? b : null;
}
