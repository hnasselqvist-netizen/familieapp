/**
 * Lønnsdagsrunden (#59, Kontrolltårnet 2026-10-07): den månedlige
 * Forvaltning-jobben som én ledet rute — import → vurdering → kvitteringer
 * → Spillerom → tydelig avslutning.
 *
 * **Ingen lagret prosess-state.** Hvert stegs status utledes av data som
 * allerede finnes: importdatoen på transaksjonene, arbeidskøen,
 * kvitteringsinnboksen og likviditetsnoden (`saldoUpdated`,
 * `prognosisDate`, `lonnDay`). Runden kan derfor avbrytes og gjenopptas
 * hvor som helst, også fra en annen enhet, uten at noe må ryddes.
 *
 * Perioden er lønnsperioden: fra siste lønningsdag (`lonnDay`, standard 20)
 * til neste. Et steg som avhenger av tid (import, saldo) regnes som gjort
 * når det har skjedd i inneværende periode.
 */

export type StegId = "import" | "vurdering" | "kvitteringer" | "spillerom";

export const STEG_REKKEFOLGE: readonly StegId[] = [
  "import",
  "vurdering",
  "kvitteringer",
  "spillerom",
];

export interface RundeGrunnlag {
  /** `liquidity.lonnDay` — dag i måneden lønnen kommer. */
  lonnDay: number;
  /** Seneste `importertDato` (YYYY-MM-DD) blant transaksjonene, eller `null`. */
  sisteImport: string | null;
  /** Arbeidskøens «Krever vurdering» + «Forslag til match». */
  aVurdere: number;
  /** Kvitteringsinnboksens aktive (ikke ferdige, ikke forkastede) kvitteringer. */
  kvitteringer: number;
  /** `liquidity.saldoUpdated` (ms), eller `null` hvis saldo aldri er satt. */
  saldoOppdatert: number | null;
  /** Prognosedatoen ligger før i dag (`erPrognosedatoPassert`). */
  prognosedatoPassert: boolean;
  /** Manuelle prognoseposter med passert dato (`prognoseposterSomTrengerAvklaring`). */
  trengerAvklaring: number;
}

export type Steg =
  | { id: "import"; ferdig: boolean; sisteImport: string | null }
  | { id: "vurdering"; ferdig: boolean; antall: number }
  | { id: "kvitteringer"; ferdig: boolean; antall: number }
  | {
      id: "spillerom";
      ferdig: boolean;
      saldoOppdatert: boolean;
      prognosedatoPassert: boolean;
      trengerAvklaring: number;
    };

export interface Runde {
  /** Første dag i lønnsperioden (YYYY-MM-DD). */
  periodeStart: string;
  /** Neste lønningsdag (YYYY-MM-DD) — når neste runde begynner. */
  nesteLonnsdag: string;
  steg: Steg[];
  /** Første steg som ikke er gjort, eller `null` når runden er ferdig. */
  aktivt: StegId | null;
  gjenstar: number;
  ferdig: boolean;
}

function isoDato(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lønningsdagen i en gitt måned, kuttet til månedens siste dag (31 → 28/29/30). */
function lonnsdagI(aar: number, maaned: number, lonnDay: number): Date {
  const sisteDag = new Date(aar, maaned + 1, 0).getDate();
  const dag = Math.min(Math.max(1, Math.round(lonnDay) || 20), sisteDag);
  return new Date(aar, maaned, dag);
}

/** Siste lønningsdag på eller før `idag`, og den neste etter den. */
export function lonnsperiode(idag: Date, lonnDay: number): { start: Date; neste: Date } {
  const iMnd = lonnsdagI(idag.getFullYear(), idag.getMonth(), lonnDay);
  const dag = new Date(idag.getFullYear(), idag.getMonth(), idag.getDate());
  const start = iMnd <= dag ? iMnd : lonnsdagI(idag.getFullYear(), idag.getMonth() - 1, lonnDay);
  const neste = lonnsdagI(start.getFullYear(), start.getMonth() + 1, lonnDay);
  return { start, neste };
}

/** Saldoen er oppdatert etter siste lønningsdag. */
export function saldoOppdatertIPerioden(
  saldoOppdatert: number | null,
  lonnDay: number,
  idag: Date,
): boolean {
  return saldoOppdatert !== null && saldoOppdatert >= lonnsperiode(idag, lonnDay).start.getTime();
}

/**
 * Spillerom-steget er gjort: saldoen er oppdatert i perioden, prognosedatoen
 * ligger ikke bak oss, og ingen manuelle poster venter på avklaring. Delt
 * med Spillerom-skjermen, så «ferdig» betyr det samme begge steder.
 */
export function spilleromKlart(
  g: Pick<RundeGrunnlag, "lonnDay" | "saldoOppdatert" | "prognosedatoPassert" | "trengerAvklaring">,
  idag: Date,
): boolean {
  return (
    saldoOppdatertIPerioden(g.saldoOppdatert, g.lonnDay, idag) &&
    !g.prognosedatoPassert &&
    g.trengerAvklaring === 0
  );
}

export function beregnRunde(g: RundeGrunnlag, idag: Date): Runde {
  const { start, neste } = lonnsperiode(idag, g.lonnDay);
  const periodeStart = isoDato(start);

  const importGjort = g.sisteImport !== null && g.sisteImport >= periodeStart;
  const saldoGjort = saldoOppdatertIPerioden(g.saldoOppdatert, g.lonnDay, idag);

  const steg: Steg[] = [
    { id: "import", ferdig: importGjort, sisteImport: g.sisteImport },
    { id: "vurdering", ferdig: g.aVurdere === 0, antall: g.aVurdere },
    { id: "kvitteringer", ferdig: g.kvitteringer === 0, antall: g.kvitteringer },
    {
      id: "spillerom",
      ferdig: spilleromKlart(g, idag),
      saldoOppdatert: saldoGjort,
      prognosedatoPassert: g.prognosedatoPassert,
      trengerAvklaring: g.trengerAvklaring,
    },
  ];

  const aktivt = steg.find((s) => !s.ferdig)?.id ?? null;
  const gjenstar = steg.filter((s) => !s.ferdig).length;
  return {
    periodeStart,
    nesteLonnsdag: isoDato(neste),
    steg,
    aktivt,
    gjenstar,
    ferdig: gjenstar === 0,
  };
}

/** Seneste `importertDato` blant transaksjonene (ISO-datoer sammenlignes leksikografisk). */
export function sisteImportDato(
  transaksjoner: readonly { importertDato?: string }[],
): string | null {
  let siste: string | null = null;
  for (const t of transaksjoner) {
    const d = t.importertDato?.slice(0, 10);
    if (d && (siste === null || d > siste)) siste = d;
  }
  return siste;
}
