/**
 * «Kvalitetssikre alle treff» (#59, 6544393790) — rene funksjoner.
 *
 * Omfanget er nøyaktig radene `filtrerKontrollrader` gir for dagens søk og
 * filtre (samme funksjon som tabellen og kortene), også utenfor synlig del.
 * Ved bekreftelse FRYSES settet: transaksjons-ID, kontrollgrunnlaget
 * brukeren så og den gjeldende kontrollen (samtidighetsvakt). Senere
 * filterendringer, nye importer eller rader som forsvinner fra filteret
 * endrer ikke settet.
 *
 * Før hver skriving vurderes posten mot dagens rad:
 *  - borte eller nytt grunnlag → «endret» (skrives ALDRI på et annet
 *    grunnlag enn det som ble bekreftet);
 *  - allerede kvalitetssikret på samme grunnlag → «allerede» (ingen ny
 *    stempling);
 *  - ellers → skriv med det frosne grunnlaget og den frosne gjeldende
 *    kontrollen som forventet verdi.
 */
import type { KontrollRad } from "./kontrollrader";

export interface FrossetTreff {
  /** Raden slik den var ved bekreftelsen (grunnlag + gjeldende kontroll). */
  rad: KontrollRad;
}

export type MasseVurdering = "skriv" | "allerede" | "endret";
export type MasseUtfall = "kontrollert" | "allerede" | "endret" | "feilet";

export interface MasseResultat {
  kontrollert: number;
  allerede: number;
  endret: number;
  feilet: number;
  /** Tekstene til postene som ikke ble kontrollert (endret/feilet). */
  ikkeKontrollert: { id: string; tekst: string; utfall: "endret" | "feilet" }[];
}

export const TOMT_RESULTAT: MasseResultat = {
  kontrollert: 0,
  allerede: 0,
  endret: 0,
  feilet: 0,
  ikkeKontrollert: [],
};

/** Fryser det bekreftede treffsettet (kopi, uavhengig av senere endringer). */
export function frysTreff(utvalg: readonly KontrollRad[]): FrossetTreff[] {
  return utvalg.map((rad) => ({ rad: { ...rad, kontroll: { ...rad.kontroll } } }));
}

/** Hvor mange i et treffsett som allerede er kvalitetssikret på dagens grunnlag. */
export const antallAllerede = (utvalg: readonly KontrollRad[]): number =>
  utvalg.filter((r) => r.kontroll.status === "kvalitetssikret").length;

/** Vurderer én frosset post mot dagens rad (se modulkommentaren). */
export function vurderTreff(frosset: FrossetTreff, naa: KontrollRad | undefined): MasseVurdering {
  if (!naa || naa.kontroll.grunnlag !== frosset.rad.kontroll.grunnlag) return "endret";
  if (naa.kontroll.status === "kvalitetssikret") return "allerede";
  return "skriv";
}

export function leggTil(
  r: MasseResultat,
  frosset: FrossetTreff,
  utfall: MasseUtfall,
): MasseResultat {
  const ut = { ...r, [utfall]: r[utfall] + 1 };
  if (utfall === "endret" || utfall === "feilet") {
    ut.ikkeKontrollert = [
      ...r.ikkeKontrollert,
      { id: frosset.rad.id, tekst: frosset.rad.tekst || "(uten tekst)", utfall },
    ];
  }
  return ut;
}

/**
 * Kjører `arbeid` for hvert element med høyst `samtidig` i gang om gangen
 * (kontrollert batching), og kaller `ferdig` etter hvert element.
 */
export async function medBegrensetSamtidighet<T>(
  elementer: readonly T[],
  samtidig: number,
  arbeid: (el: T) => Promise<void>,
): Promise<void> {
  let neste = 0;
  const arbeidere = Array.from({ length: Math.min(samtidig, elementer.length) }, async () => {
    while (neste < elementer.length) {
      const el = elementer[neste++]!;
      await arbeid(el);
    }
  });
  await Promise.all(arbeidere);
}
