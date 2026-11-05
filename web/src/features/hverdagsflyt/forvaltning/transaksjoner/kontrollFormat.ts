/**
 * Felles formatering for «Alle transaksjoner» og detaljpanelet (#59,
 * PC-1/PC-2), så tabell, kort og panel viser tallene likt.
 */
import type { KontrollFordeling } from "@domain/forsoning/kontrollrader";

const tall = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Eksakt beløp med øre og eksplisitt fortegn (+ inn, - ut). */
export const fmtOre = (ore: number) =>
  `${ore < 0 ? "-" : "+"}${tall.format(Math.abs(ore) / 100)} kr`;
/** `ÅÅÅÅ-MM-DD…` → `DD.MM.ÅÅÅÅ`, uten tidssone-tolkning. */
export const fmtDato = (dato: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dato);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : dato || "—";
};
export const eierTekst = (f: KontrollFordeling) =>
  f.eiere.length === 0
    ? "—"
    : f.eiere.map((e) => (e.prosent < 100 ? `${e.person} ${e.prosent} %` : e.person)).join(", ");
