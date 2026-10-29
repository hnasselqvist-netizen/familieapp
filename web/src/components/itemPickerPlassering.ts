/**
 * Ren plasseringsberegning for `ItemPicker` sin forslagsliste (#82).
 *
 * Listen ligger i en portal med `position:fixed`, altså i layout-
 * viewportens koordinater. `getBoundingClientRect()` gir ikke alltid de
 * samme koordinatene: i WebKit (iOS Safari og alle iOS-nettlesere) er de
 * relative til den *synlige* viewporten, som Safari forskyver med
 * `visualViewport.offsetTop` når skjermtastaturet åpner seg. Uten
 * korreksjon havner listen like langt over inputen som forskyvningen —
 * Helens skjermbilde i #82. Floating UI korrigerer det samme avviket.
 *
 * I stedet for å gjette nettleser måles avviket direkte: `forskyvning` er
 * forskjellen mellom der listen ble satt (layoutkoordinater) og der
 * `getBoundingClientRect()` sier den havnet. Den er 0 der koordinat-
 * systemene er like (Chromium, Firefox, WebKit uten panorert viewport).
 */

/** Rektangel fra `getBoundingClientRect()` — målte koordinater. */
export interface MaltRektangel {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/** Synlig viewport i layoutkoordinater (`window.visualViewport`). */
export interface SynligViewport {
  offsetTop: number;
  height: number;
}

export interface Forskyvning {
  x: number;
  y: number;
}

export interface Plassering {
  /** Ankerlinjen i layoutkoordinater: inputens underkant, eller overkant når `over`. */
  top: number;
  left: number;
  width: number;
  /** Listen vokser oppover fra inputens overkant fordi det er for lite plass under. */
  over: boolean;
  maxHeight: number;
}

/** Luft mellom listen og kanten av det synlige området. */
export const KANTMARG = 8;
/** Plass under inputen som alltid er nok til å bli liggende under. */
export const NOK_PLASS_UNDER = 160;
/** Minste høyde listen får, også når det er trangt både over og under. */
export const MINSTE_HOYDE = 96;

export const INGEN_FORSKYVNING: Forskyvning = Object.freeze({ x: 0, y: 0 });

export function beregnPlassering(
  input: MaltRektangel,
  forskyvning: Forskyvning,
  synlig: SynligViewport | null,
  layoutHoyde: number,
): Plassering {
  const topp = input.top + forskyvning.y;
  const bunn = input.bottom + forskyvning.y;
  const synligTopp = synlig?.offsetTop ?? 0;
  const synligBunn = synligTopp + (synlig?.height ?? layoutHoyde);
  const plassUnder = synligBunn - bunn - KANTMARG;
  const plassOver = topp - synligTopp - KANTMARG;
  const over = plassUnder < NOK_PLASS_UNDER && plassOver > plassUnder;
  return {
    top: over ? topp : bunn,
    left: input.left + forskyvning.x,
    width: input.width,
    over,
    maxHeight: Math.max(MINSTE_HOYDE, over ? plassOver : plassUnder),
  };
}

/**
 * Avviket mellom satt og målt posisjon for en liste som ble rendret med
 * `satt`. Med `over` er ankeret listens underkant (`translateY(-100%)`).
 */
export function malForskyvning(satt: Plassering, maltListe: MaltRektangel): Forskyvning {
  return {
    x: satt.left - maltListe.left,
    y: satt.top - (satt.over ? maltListe.bottom : maltListe.top),
  };
}

export function likPlassering(a: Plassering | null, b: Plassering | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.maxHeight - b.maxHeight) < 0.5 &&
    a.over === b.over
  );
}
