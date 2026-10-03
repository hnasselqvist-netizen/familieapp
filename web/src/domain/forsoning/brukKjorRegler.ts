/**
 * «Kjør regler» → «Bruk resultatet» (§Issue #34 R3b), portert fra legacy
 * `bekreftKjorRegler` (`index.html` ~12610–12645). Ren orkestrering: selve
 * skrivingen injiseres (`transactHendelser`/`transactTransaksjoner`), slik
 * at domenet ikke kjenner datalaget og kan testes uten Firebase.
 *
 * Samme kontrakt som legacy:
 *  1. bygg en FERSK plan mot nåværende data og sammenlign den semantisk
 *     (`erEndringsplanUendret`, id-er/tidsstempler ignorert) med planen
 *     brukeren godkjente — ved avvik skrives ingenting, og den ferske
 *     forhåndsvisningen returneres med legacy sin advarsel;
 *  2. skriv planen byte-for-byte med `skrivEndringsplan`.
 *
 * Bevisste avvik fra legacy, begge for datasikkerhet:
 *  - **Rekkefølge:** `hendelser` skrives FØR `transaksjoner` (legacy gjør
 *    omvendt). Tilstanden til en transaksjon slås opp via hendelsens
 *    `transaksjonId` (`finnHendelseForTransaksjon`), så feiler steg 2,
 *    er transaksjonen likevel riktig plassert — bare `hendelseId`-pekeren
 *    mangler. Legacy sin rekkefølge kan etterlate en peker til en hendelse
 *    som aldri ble skrevet.
 *  - **Helnode-transaksjoner mot fersk verdi** i stedet for blind
 *    overskriving med en ferdig array (`setTransaksjoner(nyeTransaksjoner)`):
 *    en hendelse legges bare til hvis transaksjonen ikke allerede har fått
 *    en, og transaksjonsoppdateringen gjelder bare linjer som faktisk ble
 *    skrevet — så to klienter kan ikke dobbeltplassere.
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import { finnHendelseForTransaksjon } from "./fordeling";
import { type KjorReglerForhandsvisning, forhandsvisKjorRegler } from "./kjorReglerForhandsvisning";
import { type EndringsplanLinje, erEndringsplanUendret, skrivEndringsplan } from "./regler";

export const ENDRET_ADVARSEL =
  "Data eller regler har endret seg. Kontroller den oppdaterte forhåndsvisningen før du fortsetter.";

export interface KjorReglerResultat {
  auto: number;
  forslagSkrevet: number;
  forslagPaaVent: number;
  malMangler: number;
}

export type BrukKjorReglerUtfall =
  | { status: "endret"; advarsel: string; forhandsvisning: KjorReglerForhandsvisning }
  | { status: "skrevet"; resultat: KjorReglerResultat };

export interface ForsoningData {
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  rules: RegelRecord[];
  budgetGroups: BudsjettGruppe[];
  incomeGroups: BudsjettGruppe[];
  sparingGroups: BudsjettGruppe[];
}

export interface BrukKjorReglerDeps {
  transactHendelser: (updater: (prev: HendelseRecord[]) => HendelseRecord[]) => Promise<unknown>;
  transactTransaksjoner: (
    updater: (prev: TransaksjonRecord[]) => TransaksjonRecord[],
  ) => Promise<unknown>;
  newId: () => string;
  naa: string;
}

/** Legger til planens nye hendelser, unntatt for transaksjoner som allerede har en hendelse. */
export function leggTilPlanHendelser(
  prev: HendelseRecord[],
  nye: HendelseRecord[],
): { liste: HendelseRecord[]; lagtTil: Set<string> } {
  const lagtTil = new Set<string>();
  const liste = [...prev];
  for (const h of nye) {
    if (!h.transaksjonId || finnHendelseForTransaksjon(liste, h.transaksjonId)) continue;
    liste.push(h);
    lagtTil.add(h.transaksjonId);
  }
  return { liste, lagtTil };
}

/**
 * Planlinjene som skal gi en transaksjonsoppdatering: auto-linjer bare hvis
 * hendelsen deres faktisk ble lagt til, forslag bare hvis transaksjonen
 * fortsatt ikke har noen hendelse.
 */
export function linjerForTransaksjoner(
  plan: readonly EndringsplanLinje[],
  hendelserEtter: readonly HendelseRecord[],
  lagtTil: ReadonlySet<string>,
): EndringsplanLinje[] {
  return plan.filter((l) => {
    if (!l.skalSkrives) return false;
    if (l.handling === "auto") return lagtTil.has(l.transaksjonId);
    if (l.handling === "forslag")
      return !finnHendelseForTransaksjon([...hendelserEtter], l.transaksjonId);
    return false;
  });
}

export function resultatFor(plan: readonly EndringsplanLinje[]): KjorReglerResultat {
  return {
    auto: plan.filter((l) => l.handling === "auto" && l.skalSkrives).length,
    forslagSkrevet: plan.filter((l) => l.handling === "forslag" && l.skalSkrives).length,
    forslagPaaVent: plan.filter((l) => l.handling === "forslag_pa_vent").length,
    malMangler: plan.filter((l) => l.handling === "mal_mangler").length,
  };
}

export async function brukKjorRegler(
  godkjentPlan: EndringsplanLinje[],
  data: ForsoningData,
  deps: BrukKjorReglerDeps,
): Promise<BrukKjorReglerUtfall> {
  const fersk = forhandsvisKjorRegler(
    data.transaksjoner,
    data.hendelser,
    data.rules,
    data.budgetGroups,
    data.incomeGroups,
    data.sparingGroups,
    deps.newId,
  );
  if (!erEndringsplanUendret(godkjentPlan, fersk.plan)) {
    return { status: "endret", advarsel: ENDRET_ADVARSEL, forhandsvisning: fersk };
  }

  const { nyeHendelser } = skrivEndringsplan(fersk.plan, data.transaksjoner, deps.naa);
  // Updaterne kan kjøres flere ganger; bare SISTE kall blir skrevet.
  let hendelserEtter: HendelseRecord[] = data.hendelser;
  let lagtTil = new Set<string>();
  if (nyeHendelser.length > 0) {
    await deps.transactHendelser((prev) => {
      const r = leggTilPlanHendelser(prev, nyeHendelser);
      hendelserEtter = r.liste;
      lagtTil = r.lagtTil;
      return r.liste;
    });
  }
  const linjer = linjerForTransaksjoner(fersk.plan, hendelserEtter, lagtTil);
  if (linjer.length > 0) {
    await deps.transactTransaksjoner(
      (prev) => skrivEndringsplan(linjer, prev, deps.naa).nyeTransaksjoner,
    );
  }
  return { status: "skrevet", resultat: resultatFor(fersk.plan) };
}
