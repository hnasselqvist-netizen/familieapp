/**
 * Fast kategoriorden for handlelisten (§Issue #20, Helens endelige
 * rekkefølge i kommentar 6062985638). Erstatter "første gang kategorien
 * dukker opp"-ordenen, som fikk kategoriene til å hoppe når varer ble
 * endret, avhuket eller lagt til.
 *
 * Helens liste bruker produktnavn; her er de oversatt til de faktiske
 * kategori-ID-ene i `SHOP_CATS`, uten migrering eller omdøping:
 *
 *  1 Frukt og grønt                       → "Frukt og grønt"
 *  2 Kjøtt, fisk og pålegg                → "Kjøtt", "Fisk og sjømat"
 *  3 Brød og bakervarer                   → "Brød og bakst"
 *  4 Meieri og egg                        → "Ost og meieri"
 *  5 Frysevarer                           → "Frysevarer"
 *  6 Drikke                               → "Drikke"
 *  7 Husholdning og hygiene               → "Rengjøring"
 *  8 Tørrvarer og hermetikk               → "Tørrvarer"
 *  9 Middagstilbehør, sauser og krydder   → (ingen egen ID i dag)
 * 10 Snacks og søtsaker                   → (ingen egen ID i dag)
 * 11 Annet                                → "Diverse"
 *
 * Kategorier utenfor listen (eldre data eller fritekst) havner
 * alfabetisk etter de kjente, men før "Diverse", slik at "Annet" alltid
 * er sist.
 */
export const HANDLELISTE_KATEGORIORDEN = [
  "Frukt og grønt",
  "Kjøtt",
  "Fisk og sjømat",
  "Brød og bakst",
  "Ost og meieri",
  "Frysevarer",
  "Drikke",
  "Rengjøring",
  "Tørrvarer",
] as const;

/** Kategorien som alltid sorteres sist ("Annet" i Helens liste). */
export const SISTE_KATEGORI = "Diverse";

const rang = new Map<string, number>(HANDLELISTE_KATEGORIORDEN.map((cat, i) => [cat, i]));

/** Sammenligner to kategori-ID-er etter den faste handlelisteordenen. */
export function sammenlignKategori(a: string, b: string): number {
  if (a === b) return 0;
  if (a === SISTE_KATEGORI) return 1;
  if (b === SISTE_KATEGORI) return -1;
  const ra = rang.get(a);
  const rb = rang.get(b);
  if (ra !== undefined && rb !== undefined) return ra - rb;
  if (ra !== undefined) return -1;
  if (rb !== undefined) return 1;
  return a.localeCompare(b, "nb");
}

/**
 * De distinkte kategoriene i `cats`, i fast handlelisteorden. Resultatet
 * avhenger bare av hvilke kategorier som finnes — ikke av rekkefølgen på
 * varene, antall, avhuking eller når en vare ble lagt til.
 */
export function sorterKategorier(cats: Iterable<string>): string[] {
  return [...new Set(cats)].sort(sammenlignKategori);
}
