/**
 * «Hva hvis…» i Spillerom (Forvaltning produktfase, #59): hva skjer med
 * spillerommet og den laveste saldoen før prognosedatoen hvis vi bruker
 * (eller får inn) et beløp en gitt dag? Ingenting lagres — scenarioet er
 * en midlertidig, tenkt post som legges oppå de aktive prognosepostene.
 *
 * Ren funksjon. Gjenbruker `saldoforlop`, så svaret alltid regnes med
 * samme regler som Spillerom-rommet selv (aktive poster, samme periode).
 */
import type { LiquidityPost } from "@app-types/liquidity";
import { type Saldoforlop, saldoforlop } from "./saldoforlop";

export interface HvaHvisScenario {
  /** Positivt beløp. */
  belop: number;
  retning: "ut" | "inn";
  /** ISO-dato (YYYY-MM-DD). */
  dato: string;
}

export interface HvaHvisResultat {
  /** Forløpet uten scenarioet (dagens bilde). */
  for: Saldoforlop;
  /** Forløpet med scenarioet. */
  etter: Saldoforlop;
  /** Endring i spillerommet på prognosedatoen (negativ = mindre spillerom). */
  endring: number;
  /** Scenarioets dato ligger utenfor perioden og påvirker ikke prognosen. */
  utenforPerioden: boolean;
}

export const HVA_HVIS_ID = "__hva_hvis__";

export function hvaHvis(
  saldo: number,
  posts: readonly LiquidityPost[],
  fraDato: Date | string,
  tilDato: Date | string,
  scenario: HvaHvisScenario,
): HvaHvisResultat {
  const tenkt: LiquidityPost = {
    id: HVA_HVIS_ID,
    name: "Hva hvis",
    amount: Math.abs(scenario.belop) || 0,
    direction: scenario.retning === "inn" ? "in" : "out",
    date: scenario.dato,
    type: "extra",
    kilde: "manuell",
  };
  const for_ = saldoforlop(saldo, posts, fraDato, tilDato);
  const etter = saldoforlop(saldo, [...posts, tenkt], fraDato, tilDato);
  const iPerioden = etter.dager.some((d) => d.poster.some((p) => p.id === HVA_HVIS_ID));
  return {
    for: for_,
    etter,
    endring: etter.slutt - for_.slutt,
    utenforPerioden: !iPerioden,
  };
}
