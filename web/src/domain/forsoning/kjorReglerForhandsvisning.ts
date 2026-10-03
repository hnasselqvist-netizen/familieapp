/**
 * «Kjør regler» — kun forhåndsvisningen, portert fra legacy-RegelSenter
 * (`index.html` ~12598–13006), §Issue #34 R1+.
 *
 * Bruker de samme motorene som legacy (`evaluerReglerMotUavklarteTransaksjoner`
 * og `byggKjorReglerEndringsplan`, portert og differensielt testet i R0),
 * og grupperer planen slik forhåndsvisningen viser den. **Planen skrives
 * aldri**: «Bruk resultatet» skriver `transaksjoner` og `hendelser` og
 * aktiveres først ved R3b-cutover (ADR 0002).
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import {
  type EndringsplanLinje,
  type MalpostTreff,
  type RegelEvaluering,
  byggKjorReglerEndringsplan,
  evaluerReglerMotUavklarteTransaksjoner,
} from "./regler";

export interface KjorReglerOppsummering {
  /** Behandles automatisk. */
  auto: EndringsplanLinje[];
  /** Til vurdering. */
  forslag: EndringsplanLinje[];
  /** Røres ikke: på vent, treff funnet men ikke skrevet. */
  paaVent: EndringsplanLinje[];
  /** Regelen peker mot en post som ikke finnes. */
  malMangler: EndringsplanLinje[];
  ingenTreffAntall: number;
  /** Om «Bruk resultatet» ville hatt noe å skrive. */
  noeAaSkrive: boolean;
}

/** Legacy-forhåndsvisningens gruppering av planen (~12893–12898). */
export function oppsummerKjorRegler(
  plan: readonly EndringsplanLinje[],
  evaluering: RegelEvaluering | null,
): KjorReglerOppsummering {
  const auto = plan.filter((l) => l.handling === "auto" && l.skalSkrives);
  const forslag = plan.filter((l) => l.handling === "forslag" && l.skalSkrives);
  return {
    auto,
    forslag,
    paaVent: plan.filter((l) => l.handling === "forslag_pa_vent"),
    malMangler: plan.filter((l) => l.handling === "mal_mangler"),
    ingenTreffAntall: evaluering ? evaluering.ingenTreff.length : 0,
    noeAaSkrive: auto.length > 0 || forslag.length > 0,
  };
}

export const TYPE_LABEL_R: Record<string, string> = {
  budget: "Kostnad",
  income: "Inntekt",
  sparing: "Sparing",
};

/** Legacy `gruppeLabelFor` (~12888): gruppens navn, ellers gruppe-id-en. */
export function gruppeLabelFor(
  target: Pick<MalpostTreff, "kildeType" | "gruppeId">,
  grupper: {
    budgetGroups: readonly BudsjettGruppe[];
    incomeGroups: readonly BudsjettGruppe[];
    sparingGroups: readonly BudsjettGruppe[];
  },
): string {
  const grupper2 =
    target.kildeType === "income"
      ? grupper.incomeGroups
      : target.kildeType === "sparing"
        ? grupper.sparingGroups
        : grupper.budgetGroups;
  const g = (grupper2 || []).find((x) => x.id === target.gruppeId);
  return g ? g.label : target.gruppeId;
}

export interface KjorReglerForhandsvisning {
  evaluering: RegelEvaluering;
  plan: EndringsplanLinje[];
  oppsummering: KjorReglerOppsummering;
}

/**
 * Legacy `forhandsvisKjorRegler` (~12598) uten state: evaluering → plan →
 * gruppering. Hendelse-id-ene i planen brukes bare ved skriving: til
 * visning er de deterministiske plassholdere, og «Bruk resultatet»
 * (`brukKjorRegler.ts`) sender inn en ekte id-generator.
 */
export function forhandsvisKjorRegler(
  transaksjoner: TransaksjonRecord[],
  hendelser: HendelseRecord[],
  rules: RegelRecord[],
  budgetGroups: BudsjettGruppe[],
  incomeGroups: BudsjettGruppe[],
  sparingGroups: BudsjettGruppe[],
  newId?: () => string,
): KjorReglerForhandsvisning {
  const evaluering = evaluerReglerMotUavklarteTransaksjoner(
    transaksjoner,
    hendelser,
    rules,
    budgetGroups,
    incomeGroups,
    sparingGroups,
  );
  let n = 0;
  const plan = byggKjorReglerEndringsplan(
    evaluering,
    transaksjoner,
    newId ?? (() => `forhandsvisning-${++n}`),
  );
  return { evaluering, plan, oppsummering: oppsummerKjorRegler(plan, evaluering) };
}
