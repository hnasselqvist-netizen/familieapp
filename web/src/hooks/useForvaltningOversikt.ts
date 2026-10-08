import { useEffect, useMemo, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  subscribeHendelser,
  subscribeKvitteringer,
  subscribeTransaksjonRecords,
} from "@data/forsoning.repository";
import { subscribeRules } from "@data/rules.repository";
import { subscribeSaldokontroller } from "@data/saldokontroller.repository";
import {
  type Maanedskontroll,
  avstemmingsoversikt,
  maanedskontroll,
  sisteAvsluttedeMaaned,
} from "@domain/avstemming/saldoavstemming";
import {
  beregnFaktiskTotalerFraHendelser,
  budgetMonthKey,
  currentBudgetYear,
} from "@domain/budsjettfamilie/budsjettfamilie";
import { type Okonomibilde, beregnOkonomibilde } from "@domain/budsjettfamilie/okonomi";
import { type Oppmerksomhet, beregnOppmerksomhet } from "@domain/forsoning/oppmerksomhet";
import {
  erPrognosedatoPassert,
  prognoseposterSomTrengerAvklaring,
} from "@domain/liquidity/liquidity";
import { type SpilleromOversikt, spilleromOversikt } from "@domain/liquidity/oversikt";
import { type Runde, beregnRunde, sisteImportDato } from "@domain/lonnsdagsrunde/lonnsdagsrunde";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { type Loadable, loaded, loading } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";
import { useLiquidity } from "./useLiquidity";

export interface ForvaltningOversikt {
  spillerom: SpilleromOversikt;
  oppmerksomhet: Oppmerksomhet;
  okonomi: Okonomibilde;
  /** Måneden økonomibildet gjelder (0–11, inneværende). */
  month: number;
  /** Lønnsdagsrunden (#59), utledet av de samme dataene — ingen egen lagret state. */
  runde: Runde;
  /** Prognosedatoen Spillerom regner frem til (YYYY-MM-DD). */
  prognosisDate: string;
  /**
   * Saldoavstemmingen for siste avsluttede KALENDERMÅNED (#59). Egen
   * kontrollperiode — lønnsperioden til runden er uendret.
   */
  maanedskontroll: Maanedskontroll;
}

/**
 * Data til Forvaltning-forsiden (produktfase 1, #34 6000282907). Rent
 * lesende: abonnerer på de samme nodene som detaljskjermene og regner ut
 * med de samme domenefunksjonene, så forsidens tall er de samme som
 * brukeren møter i detaljene.
 */
export function useForvaltningOversikt(): Loadable<ForvaltningOversikt> {
  const familyId = useFamilyId();
  const { liquidity } = useLiquidity();
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[] | null>(null);
  const [incomeGroups, setIncomeGroups] = useState<BudsjettGruppe[] | null>(null);
  const [sparingGroups, setSparingGroups] = useState<BudsjettGruppe[] | null>(null);
  const [transaksjoner, setTransaksjoner] = useState<TransaksjonRecord[] | null>(null);
  const [hendelser, setHendelser] = useState<HendelseRecord[] | null>(null);
  const [kvitteringer, setKvitteringer] = useState<KvitteringRecord[] | null>(null);
  const [rules, setRules] = useState<RegelRecord[] | null>(null);
  const [saldokontroller, setSaldokontroller] = useState<SaldoKontroll[] | null>(null);

  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "incomeGroups", setIncomeGroups), [familyId]);
  useEffect(
    () => subscribeBudsjettGrupper(familyId, "sparingGroups", setSparingGroups),
    [familyId],
  );
  useEffect(() => subscribeTransaksjonRecords(familyId, setTransaksjoner), [familyId]);
  useEffect(() => subscribeHendelser(familyId, setHendelser), [familyId]);
  useEffect(() => subscribeKvitteringer(familyId, setKvitteringer), [familyId]);
  useEffect(() => subscribeRules(familyId, setRules), [familyId]);
  useEffect(() => subscribeSaldokontroller(familyId, setSaldokontroller), [familyId]);

  return useMemo(() => {
    if (
      liquidity.status !== "loaded" ||
      !budgetGroups ||
      !incomeGroups ||
      !sparingGroups ||
      !transaksjoner ||
      !hendelser ||
      !kvitteringer ||
      !rules ||
      !saldokontroller
    ) {
      return loading;
    }
    const naa = new Date();
    const month = naa.getMonth();
    const gyldige = new Set([...transaksjoner.map((t) => t.id), ...kvitteringer.map((r) => r.id)]);
    const actualTotals = beregnFaktiskTotalerFraHendelser(
      // Samme felt som Budsjett-familien leser; `kommentar` er `null`-bar i fullformen.
      hendelser.map((h) => ({ ...h, kommentar: h.kommentar ?? undefined })),
      budgetMonthKey(currentBudgetYear(naa), month),
      gyldige,
    );
    const oppmerksomhet = beregnOppmerksomhet(transaksjoner, hendelser, rules, kvitteringer);
    const runde = beregnRunde(
      {
        lonnDay: liquidity.data.lonnDay,
        sisteImport: sisteImportDato(transaksjoner),
        aVurdere: oppmerksomhet.transaksjonerAVurdere + oppmerksomhet.forslagTilMatch,
        kvitteringer: oppmerksomhet.kvitteringer,
        saldoOppdatert: liquidity.data.saldoUpdated,
        prognosedatoPassert: erPrognosedatoPassert(liquidity.data.prognosisDate, naa),
        trengerAvklaring: prognoseposterSomTrengerAvklaring(
          Object.values(liquidity.data.posts),
          naa,
        ).length,
      },
      naa,
    );
    return loaded({
      spillerom: spilleromOversikt(liquidity.data, naa.toISOString().slice(0, 10)),
      oppmerksomhet,
      okonomi: beregnOkonomibilde(
        { budgetGroups, incomeGroups, sparingGroups },
        month,
        actualTotals,
      ),
      month,
      runde,
      prognosisDate: liquidity.data.prognosisDate,
      maanedskontroll: maanedskontroll(
        avstemmingsoversikt(transaksjoner, saldokontroller, naa, 1),
        sisteAvsluttedeMaaned(naa),
      ),
    });
  }, [
    liquidity,
    budgetGroups,
    incomeGroups,
    sparingGroups,
    transaksjoner,
    hendelser,
    kvitteringer,
    rules,
    saldokontroller,
  ]);
}
