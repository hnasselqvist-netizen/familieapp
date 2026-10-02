/**
 * Delte tekst-, beløps- og datohjelpere for forsoningslaget — rene
 * funksjoner, portert 1:1 fra `index.html` (§Issue #34, R0). Brukes av
 * regelmotoren, kvitteringsmatching og intern overføring.
 *
 * Karakterisert mot den faktiske legacy-koden i `forsoning.legacy.test.ts`.
 */

/**
 * Normaliserer bankens transaksjonstekst for stabil læring/matching:
 * lowercase, fjerner måneder, årstall, datoer, KID/lange tall og løpenummer.
 * Legacy: `normaliserTransaksjonstekst` (index.html ~10233).
 */
export function normaliserTransaksjonstekst(tekst: string | null | undefined): string {
  if (!tekst) return "";
  let t = tekst.toLowerCase();
  t = t.replace(/\b(jan|feb|mar|apr|mai|jun|jul|aug|sep|okt|nov|des)\.?\s*\d{0,4}\b/g, "");
  t = t.replace(
    /\b(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\b/g,
    "",
  );
  t = t.replace(/\b20\d{2}\b/g, "");
  t = t.replace(/\b\d{1,2}[./]\d{1,2}([./]\d{2,4})?\b/g, "");
  t = t.replace(/\b\d{6,}\b/g, "");
  t = t.replace(/#\d+/g, "");
  t = t.replace(/\(\d+\)/g, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/** "REMA1000", "REMA 1000" og "REMA-1000" blir like. Legacy: `normalizeMerchant`. */
export function normalizeMerchant(tekst: string | null | undefined): string {
  if (!tekst) return "";
  return tekst.toLowerCase().replace(/[\s\-_]+/g, "");
}

/** Beløpslikhet i øre, uavhengig av fortegn. Legacy: `belopMatcherIOre`. */
export function belopMatcherIOre(
  a: number | null | undefined,
  b: number | null | undefined,
): boolean {
  return Math.round(Math.abs(a || 0) * 100) === Math.round(Math.abs(b || 0) * 100);
}

/** Hele dager mellom to datoer; `Infinity` når én mangler. Legacy: `dagerMellom`. */
export function dagerMellom(
  datoA: string | null | undefined,
  datoB: string | null | undefined,
): number {
  if (!datoA || !datoB) return Infinity;
  return Math.round(
    Math.abs(new Date(datoA).getTime() - new Date(datoB).getTime()) / (1000 * 60 * 60 * 24),
  );
}

/**
 * Felles prefiks av to tekster, kuttet tilbake til siste hele ord når
 * prefikset slutter midt i et ord. Brukes av «bruk og utvid regel».
 * Legacy: `fellesPrefiks`.
 */
export function fellesPrefiks(a: string | null | undefined, b: string | null | undefined): string {
  const aa = a || "";
  const bb = b || "";
  const min = Math.min(aa.length, bb.length);
  let i = 0;
  while (i < min && aa[i] === bb[i]) i++;
  let prefix = aa.slice(0, i);
  const sisteMellomrom = prefix.lastIndexOf(" ");
  if (sisteMellomrom > 0 && i < aa.length) prefix = prefix.slice(0, sisteMellomrom);
  return prefix.trim();
}
