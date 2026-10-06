/**
 * Saldoforløpet frem til prognosedatoen (Forvaltning produktfase, #59 —
 * Spillerom-prognose): hvordan disponibelt beløp beveger seg dag for dag
 * når de aktive prognosepostene i perioden inntreffer, og hvor lavt det
 * går underveis.
 *
 * Spillerommet (`calcSpillerom`) svarer på «hva står igjen på
 * prognosedatoen». Det kan være positivt selv om saldoen går under null
 * før lønn kommer inn — forløpet gjør det synlig. Samme poster og samme
 * periode som Spillerom-detaljene (`erAktivPrognosepost`,
 * `erPrognosepostIPeriode`), så sluttsaldoen alltid er lik spillerommet.
 *
 * Ren funksjon: mottar saldo, poster og periode, returnerer forløpet.
 * Rekkefølgen innen én dag er ukjent (banken bokfører når den vil), så
 * laveste punkt måles ved slutten av hver dag, ikke per post.
 */
import type { LiquidityPost } from "@app-types/liquidity";
import { erAktivPrognosepost, erPrognosepostIPeriode } from "./liquidity";

export interface ForlopDag {
  /** ISO-dato (YYYY-MM-DD). */
  dato: string;
  poster: LiquidityPost[];
  /** Innbetalinger − utbetalinger denne dagen. */
  netto: number;
  /** Disponibelt ved slutten av dagen. */
  saldoEtter: number;
}

export interface Saldoforlop {
  dager: ForlopDag[];
  /** Laveste disponible beløp i perioden (startsaldo eller slutten av en dag). */
  laveste: { saldo: number; dato: string | null };
  /** Disponibelt på prognosedatoen — lik `calcSpillerom(...).spillerom`. */
  slutt: number;
}

const fortegn = (p: LiquidityPost) =>
  (p.direction === "in" ? 1 : p.direction === "out" ? -1 : 0) * (Number(p.amount) || 0);

export function saldoforlop(
  saldo: number,
  posts: readonly LiquidityPost[],
  fraDato: Date | string,
  tilDato: Date | string,
): Saldoforlop {
  const start = Number(saldo) || 0;
  const perDag = new Map<string, LiquidityPost[]>();
  for (const p of posts) {
    if (!erAktivPrognosepost(p) || !erPrognosepostIPeriode(p, fraDato, tilDato)) continue;
    const dato = p.date.slice(0, 10);
    perDag.set(dato, [...(perDag.get(dato) ?? []), p]);
  }

  let lopende = start;
  let laveste: Saldoforlop["laveste"] = { saldo: start, dato: null };
  const dager: ForlopDag[] = [...perDag.keys()].sort().map((dato) => {
    const poster = perDag.get(dato)!;
    const netto = poster.reduce((s, p) => s + fortegn(p), 0);
    lopende += netto;
    if (lopende < laveste.saldo) laveste = { saldo: lopende, dato };
    return { dato, poster, netto, saldoEtter: lopende };
  });

  return { dager, laveste, slutt: lopende };
}
