/**
 * Intern overføring mellom egne kontoer — rene funksjoner, portert 1:1 fra
 * `index.html` ~10312–10375 (§Issue #34, R0). En intern overføring
 * oppretter ALDRI en hendelse og påvirker aldri resultat/kostnad/inntekt.
 */
import type { TransaksjonRecord } from "@app-types/forsoning";
import { belopMatcherIOre, dagerMellom } from "./tekst";

type KontoRetning = Pick<TransaksjonRecord, "konto" | "retning">;

/** Legacy: `kontoUlik` — begge må ha konto, og de må være ulike. */
export function kontoUlik(transaksjon: KontoRetning, kandidat: KontoRetning): boolean {
  return !!(transaksjon.konto && kandidat.konto && transaksjon.konto !== kandidat.konto);
}

/** Legacy: `retningMotsatt`. */
export function retningMotsatt(transaksjon: KontoRetning, kandidat: KontoRetning): boolean {
  return !!(transaksjon.retning && kandidat.retning && transaksjon.retning !== kandidat.retning);
}

export interface OverforingsKandidat {
  transaction: TransaksjonRecord;
  dagerAvvik: number;
}

/**
 * Obligatorisk: annen observasjon, ikke allerede koblet, motsatt fortegn,
 * likt beløp, ulik konto; dato kun prioritering innen 0–2 dager.
 * Legacy: `finnInterneOverforingsKandidater`.
 */
export function finnInterneOverforingsKandidater(
  transaksjon: TransaksjonRecord | null | undefined,
  alleTransaksjoner: TransaksjonRecord[] | null | undefined,
): OverforingsKandidat[] {
  if (!transaksjon || !alleTransaksjoner) return [];
  return alleTransaksjoner
    .filter(
      (o) =>
        o.id !== transaksjon.id &&
        !o.motpartTransaksjonId &&
        retningMotsatt(transaksjon, o) &&
        belopMatcherIOre(transaksjon.belop, o.belop) &&
        kontoUlik(transaksjon, o),
    )
    .map((o) => ({ transaction: o, dagerAvvik: dagerMellom(transaksjon.dato, o.dato) }))
    .filter((k) => k.dagerAvvik <= 2)
    .sort((a, b) => {
      if (a.dagerAvvik !== b.dagerAvvik) return a.dagerAvvik - b.dagerAvvik;
      return (
        (a.transaction.dato || "").localeCompare(b.transaction.dato || "") ||
        String(a.transaction.id).localeCompare(String(b.transaction.id))
      );
    });
}

/** Symmetrisk og idempotent bekreftelse av et par. Legacy: `bekreftInternOverforing`. */
export function bekreftInternOverforing(
  prev: TransaksjonRecord[] | null | undefined,
  transaksjonAId: string,
  transaksjonBId: string,
  naa: string,
): TransaksjonRecord[] {
  const merk = (t: TransaksjonRecord, motpart: string): TransaksjonRecord => ({
    ...t,
    status: "behandlet",
    behandlingstype: "intern_overforing",
    motpartTransaksjonId: motpart,
    matchetMot: null,
    matchetNavn: null,
    updatedAt: naa,
  });
  return (prev || []).map((t) => {
    if (t.id === transaksjonAId) return merk(t, transaksjonBId);
    if (t.id === transaksjonBId) return merk(t, transaksjonAId);
    return t;
  });
}
