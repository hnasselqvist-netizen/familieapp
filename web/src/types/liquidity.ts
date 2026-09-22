/**
 * Datamodellen for Spillerom (§index.html linje 10381–10935,
 * `families/familie1/liquidity`) — karakteriseringstype, ikke et nytt
 * skjema. Se domain/liquidity/liquidity.ts for motorene som opererer på
 * denne formen.
 */

export type LiquidityPostDirection = "in" | "out";

/**
 * Faktisk lagret verdi - IKKE en lukket union i legacy: meta.oppforsel
 * kan være "fast"|"variabel"|"fordele", manuelle poster kan sette hva
 * som helst. index.html linje 10559-10568 grupperer på
 * KNOWN_TYPES=["inn","fast","variabel","extra"] og bøtter alt annet i
 * en synlig "Ukjent type"-gruppe - se SpilleromScreen sin egen
 * gruppering, samme sted legacy selv definerer den (ren UI-
 * kategorisering, ikke en domenemotor).
 */
export type LiquidityPostType = string;

/** De fire visningskategoriene UI-en faktisk grupperer kjente poster i, pluss "ukjent" for alt annet. */
export type LiquidityDisplayType = "inn" | "fast" | "variabel" | "extra" | "ukjent";

export type LiquidityPostKilde = "generator" | "manuell";

export type LiquidityPostStatus = "aktiv" | "oppfylt";

/**
 * Én prognosepost i `liquidity.posts`. Genererte poster
 * (`kilde:"generator"`) har alltid `_genKey`/`generatedAt`; manuelle
 * poster (`kilde:"manuell"`) har det aldri. `sourceType`/`sourceGroup`/
 * `sourceBudgetItemId` osv. er kun til stede på genererte poster og
 * brukes ikke av Spillerom-motoren selv, kun til visning/sporing.
 */
export interface LiquidityPost {
  id: string;
  name: string;
  amount: number;
  direction: LiquidityPostDirection;
  /** ISO-dato (YYYY-MM-DD). */
  date: string;
  type: LiquidityPostType;
  kilde: LiquidityPostKilde;
  status?: LiquidityPostStatus;
  oppfyltAt?: number;
  /** Kun satt når en generert post er redigert manuelt — beholdes ved regenerering. */
  manueltOverstyrt?: boolean;
  erEstimat?: boolean;
  owner?: string;
  level?: string;
  konto?: string;
  forfallsdag?: string;
  likviditet?: string;
  /** Deterministisk nøkkel for å unngå duplikatgenerering — kun genererte poster. */
  _genKey?: string;
  generatedAt?: number;
  sourceType?: "kostnader" | "sparing" | "inntekter";
  sourceGroup?: string;
  sourceBudgetItemId?: string;
  sourceBudgetGroupId?: string;
  sourceSparingItemId?: string;
  sourceSparingGroupId?: string;
  sourceItemId?: string;
  sourceId?: string;
}

/** Formen data faktisk lagres i på `liquidity`-noden. */
export interface Liquidity {
  saldo: number;
  saldoUpdated: number | null;
  /** ISO-dato (YYYY-MM-DD). */
  prognosisDate: string;
  lonnDay: number;
  posts: Record<string, LiquidityPost>;
}

/** Resultatet av `calcSpillerom` — hva Helen faktisk ser i sammendraget. */
export interface SpilleromResult {
  disponibelt: number;
  innbetalinger: number;
  utbetalinger: number;
  bundet: number;
  spillerom: number;
}

/**
 * Minste felt-delmengde `generateForecastPosts` faktisk leser fra
 * Budsjett/Inntekter/Sparing-gruppene — IKKE en migrering av de
 * domenene selv (de forblir i `index.html` inntil egen slice). Speiler
 * kun det generatormotoren i dag bruker (§index.html linje 8918–9094).
 */
export interface ForecastMonthData {
  budget: number;
  spent: number;
}

export interface ForecastItemMeta {
  automatisk?: boolean;
  forfallsdag?: string;
  oppforsel?: "fast" | "variabel" | "fordele";
  eier?: string;
  niva?: string;
  konto?: string;
  likviditet?: string;
  /** Kun brukt av inntektsposter — eksplisitt overstyrt månedsbeløp. */
  disponibelt?: number;
}

export interface ForecastItem {
  id: string;
  name: string;
  meta?: ForecastItemMeta;
  /** Indeks 0–11 (januar–desember), samme som index.html sin `months[maaned]`. */
  months: (ForecastMonthData | undefined)[];
}

export interface ForecastGroup {
  id: string;
  label: string;
  items: ForecastItem[];
}
