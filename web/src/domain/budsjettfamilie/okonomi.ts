/**
 * Samlet økonomibilde for én måned (Forvaltning produktfase 1, #34
 * 6000282907): inntekter, kostnader og sparing for samme periode, med sum
 * per område og per gruppe, og hva som er igjen.
 *
 * Tallene beregnes med nøyaktig de samme funksjonene som Inntekter-,
 * Budsjett- og Sparing-skjermene (`summerGruppeBudsjett`,
 * `summerGruppeFaktisk`), så forsiden og detaljene aldri viser ulike tall.
 * Beløp er positive i postens egen retning (en kostnad er positiv på en
 * kostnadspost), så «igjen» = inntekter − kostnader − sparing.
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import { summerGruppeBudsjett, summerGruppeFaktisk } from "./budsjettfamilie";

export interface Belop {
  budsjett: number;
  faktisk: number;
}

export interface GruppeSum extends Belop {
  id: string;
  label: string;
}

export interface OmradeSum extends Belop {
  grupper: GruppeSum[];
}

export interface Okonomibilde {
  inntekter: OmradeSum;
  kostnader: OmradeSum;
  sparing: OmradeSum;
  /** Inntekter − kostnader − sparing, budsjettert og faktisk. */
  igjen: Belop;
}

export interface OkonomiGrunnlag {
  incomeGroups: readonly BudsjettGruppe[];
  budgetGroups: readonly BudsjettGruppe[];
  sparingGroups: readonly BudsjettGruppe[];
}

function omrade(
  grupper: readonly BudsjettGruppe[],
  monthIndex: number,
  actualTotals: Record<string, number>,
): OmradeSum {
  const rader = grupper.map((g) => ({
    id: g.id,
    label: g.label,
    budsjett: summerGruppeBudsjett(g, monthIndex),
    faktisk: summerGruppeFaktisk(g, monthIndex, actualTotals),
  }));
  return {
    budsjett: rader.reduce((s, r) => s + r.budsjett, 0),
    faktisk: rader.reduce((s, r) => s + r.faktisk, 0),
    grupper: rader,
  };
}

export function beregnOkonomibilde(
  grunnlag: OkonomiGrunnlag,
  monthIndex: number,
  actualTotals: Record<string, number>,
): Okonomibilde {
  const inntekter = omrade(grunnlag.incomeGroups, monthIndex, actualTotals);
  const kostnader = omrade(grunnlag.budgetGroups, monthIndex, actualTotals);
  const sparing = omrade(grunnlag.sparingGroups, monthIndex, actualTotals);
  return {
    inntekter,
    kostnader,
    sparing,
    igjen: {
      budsjett: inntekter.budsjett - kostnader.budsjett - sparing.budsjett,
      faktisk: inntekter.faktisk - kostnader.faktisk - sparing.faktisk,
    },
  };
}
