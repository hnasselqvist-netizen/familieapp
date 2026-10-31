/**
 * Treffgrunnlaget regelmotoren matcher mot (#59, 6543087796 / 6543491911,
 * kontrakt 6543702753).
 *
 * `normaliserTransaksjonstekst` fjerner tall med seks eller flere sifre —
 * riktig for leverandørtekster med KID og løpenummer, men det gjør at en
 * regel på et kontonummer eller en KID aldri kan treffe. Derfor bærer
 * grunnlaget i tillegg sifferløpene fra RÅteksten:
 *
 *  - sammenhengende løp med ≥ 6 sifre;
 *  - kontonummer skrevet 4-2-5 med punktum eller mellomrom
 *    («2095.79.76493», «2095 79 76493»), slått sammen til 11 sifre.
 *
 * Et løp som ligger inntil et annet siffer, eller fortsetter med
 * «.<siffer>», er ikke et eget løp — et lengre tall gir aldri treff på et
 * kortere mønster.
 *
 * Ren modul; ingen skriving.
 */
import { normaliserTransaksjonstekst } from "./tekst";

export interface Treffgrunnlag {
  /** `normaliserTransaksjonstekst` av råteksten (tekstregler matcher mot denne). */
  normalisert: string;
  /** Lange sifferløp fra råteksten, unike, i forekomstrekkefølge. */
  sifferlop: readonly string[];
}

const KONTO_GRUPPERT = /(?<!\d)(?<!\d\.)(\d{4})[. ](\d{2})[. ](\d{5})(?!\d)(?!\.\d)/g;
const SAMMENHENGENDE = /(?<!\d)(?<!\d\.)\d{6,}(?!\d)(?!\.\d)/g;

/** Sifferløpene i en råtekst (se modulkommentaren). */
export function sifferlop(tekst: string | null | undefined): string[] {
  if (!tekst) return [];
  const funn: { pos: number; sifre: string }[] = [];
  for (const m of tekst.matchAll(KONTO_GRUPPERT)) {
    funn.push({ pos: m.index, sifre: `${m[1]}${m[2]}${m[3]}` });
  }
  for (const m of tekst.matchAll(SAMMENHENGENDE)) funn.push({ pos: m.index, sifre: m[0] });
  funn.sort((a, b) => a.pos - b.pos);
  return [...new Set(funn.map((f) => f.sifre))];
}

export function treffgrunnlag(tekst: string | null | undefined): Treffgrunnlag {
  return { normalisert: normaliserTransaksjonstekst(tekst), sifferlop: sifferlop(tekst) };
}

/**
 * Tallregel: mønsteret er ett sifferløp i samme form som `sifferlop`
 * kjenner igjen — minst seks sammenhengende sifre, eller et kontonummer
 * skrevet 4-2-5 med punktum/mellomrom. Returnerer sifrene, ellers `null`
 * (tekstregel). Andre tallmønstre («1000 1000») forblir tekstregler som før.
 */
export function tallmonster(monster: string | null | undefined): string | null {
  const m = (monster || "").trim();
  if (/^\d{6,}$/.test(m)) return m;
  const konto = /^(\d{4})[. ](\d{2})[. ](\d{5})$/.exec(m);
  return konto ? `${konto[1]}${konto[2]}${konto[3]}` : null;
}

/**
 * «Svak» tekst: etter normalisering er det ingen bokstaver igjen utover et
 * rent retningsprefiks («til», «fra»). En slik tekst sier ingenting om
 * mottakeren og må aldri bli et tekstmønster — da ville den truffet alle
 * overføringer til alle kontoer.
 */
export function erSvakTekst(normalisert: string): boolean {
  const bokstaver = normalisert.replace(/[^\p{L}]/gu, "");
  return bokstaver === "" || bokstaver === "til" || bokstaver === "fra";
}

/**
 * Nøkkelen læring, forslagsspredning og flerbruk bruker for «samme
 * mottaker». Normalisert tekst, bortsett fra svak tekst: da er nøkkelen
 * det ENE sifferløpet (kontonummer/KID). Svak tekst uten, eller med flere,
 * sifferløp gir `""` — ingen læring og ingen spredning.
 */
export function laeringsnokkel(tekst: string | null | undefined): string {
  const g = treffgrunnlag(tekst);
  if (!erSvakTekst(g.normalisert)) return g.normalisert;
  return g.sifferlop.length === 1 ? g.sifferlop[0]! : "";
}
