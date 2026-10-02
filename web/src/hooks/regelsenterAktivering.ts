/**
 * Aktiveringsporten for React-RegelSenter sin SKRIVING til `rules`
 * (§Issue #34 R1, Kontrolltårn-beslutning 5952884278).
 *
 * **AV.** Legacy skriver fortsatt `rules` fra Bankimport-læring,
 * korrigering i gammel Budsjett/Inntekter/Sparing og legacy-RegelSenter.
 * Kontrakten er én aktiv skriver per node, så React-skriving aktiveres
 * først ved **R3b-cutover**, i samme release som:
 *
 *  1. legacy-skrivesperren i `setRules` (egen, revertérbar `index.html`-
 *     commit med eksplisitt mandat), og
 *  2. cutover-sjekklisten (alle enheter lastes på nytt; røyktest at
 *     legacy ikke skriver `rules`).
 *
 * Porten er bevisst en kodeendring — ingen UI-bryter, ingen miljøvariabel,
 * ingen lagret innstilling — så den kan ikke slås på ved et uhell. Både
 * hooken (`useRegelsenter`, som avviser skriving) og skjermen (som da
 * ikke viser redigeringskontroller) leser den herfra.
 */
export function regelsenterSkrivingAktiv(): boolean {
  return false;
}

export class RegelsenterSkrivingStengt extends Error {
  constructor() {
    super("Regelsenter-skriving er stengt til R3b-cutover (én aktiv skriver per node, Issue #34).");
    this.name = "RegelsenterSkrivingStengt";
  }
}
