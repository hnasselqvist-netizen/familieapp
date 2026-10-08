import type { KontrollStatus, Maanedskontroll } from "@domain/avstemming/saldoavstemming";

const MAANEDER = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
];

/** `2026-09` → «september 2026» (eller bare «september» med `utenAar`). */
export function maanedNavn(maaned: string, utenAar = false): string {
  const [aar, mnd] = maaned.split("-");
  const navn = MAANEDER[Number(mnd) - 1] ?? maaned;
  return utenAar ? navn : `${navn} ${aar}`;
}

/** `2026-09` → «sep» — kolonnetittel i matrisen. */
export const kortMaaned = (maaned: string): string => maanedNavn(maaned, true).slice(0, 3);

/** `2026-09-30` → «30. sep». */
export function datoKort(dato: string): string {
  return `${Number(dato.slice(8, 10))}. ${kortMaaned(dato.slice(0, 7))}`;
}

const formatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Øre → «1 240,00 kr» (med fortegn når det er negativt). */
export const krOre = (ore: number): string => `${formatter.format(ore / 100)} kr`;

export const STATUS_TEKST: Record<KontrollStatus, string> = {
  ingen_saldo: "Mangler saldo",
  startpunkt: "Startpunkt",
  avstemt: "Avstemt",
  avvik: "Avvik",
};

/** Kort symbol i matrisen; teksten står alltid ved siden av for skjermlesere. */
export const STATUS_SYMBOL: Record<KontrollStatus, string> = {
  ingen_saldo: "–",
  startpunkt: "•",
  avstemt: "✓",
  avvik: "≠",
};

/** Differansen i ord: «1 240,00 kr mer i banken enn beregnet». */
export function differanseTekst(differanseOre: number): string {
  if (differanseOre === 0) return "Ingen differanse";
  return `${krOre(Math.abs(differanseOre))} ${differanseOre > 0 ? "mer" : "mindre"} i banken enn beregnet`;
}

/** Tastet saldo («12 345,67», «-500») → tall, eller `null` når det ikke er et tall. */
export function parseSaldo(tekst: string): number | null {
  const renset = tekst.replace(/\s/g, "").replace(",", ".").replace(/kr$/i, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(renset)) return null;
  return Number(renset);
}

/** Lønnsdagsrundens og forsidens linje for månedskontrollen. */
export function maanedskontrollTekst(m: Maanedskontroll): string {
  const navn = maanedNavn(m.maaned, true);
  if (m.totalt === 0) return `Månedskontroll ${navn}: ingen kontoer å avstemme`;
  if (m.avstemte === m.totalt) return `Månedskontroll ${navn}: alle ${m.totalt} kontoer avstemt`;
  return `Månedskontroll ${navn}: ${m.avstemte} av ${m.totalt} kontoer avstemt${
    m.avvik > 0 ? ` · ${m.avvik} med avvik` : ""
  }`;
}
