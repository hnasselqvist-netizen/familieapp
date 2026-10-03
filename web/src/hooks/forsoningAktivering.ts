/**
 * Felles aktiveringsport for ALL React-skriving til forsoningsnodene
 * `transaksjoner`, `hendelser`, `receipts` og `rules` (§Issue #34 R3b,
 * ADR 0002).
 *
 * **AV.** Nesten hver legacy-flyt skriver to–tre av nodene samtidig
 * (Kvitteringsinnboks, Bankimport, RegelSenter, korrigering i gammel
 * Budsjett/Inntekter/Sparing, fortegns-recovery — se
 * `docs/arkitektur/r3b-cutover.md`), så de fire nodene bytter skriver i
 * ÉN felles cutover. Porten slås på i samme release som:
 *
 *  1. legacy-skrivesperren i de fire sentrale setterne
 *     (`docs/arkitektur/r3b-legacy-skrivesperre.patch`, egen revertérbar
 *     `index.html`-commit med eksplisitt mandat), og
 *  2. cutover-sjekklisten (alle enheter lastes på nytt; røyktest at
 *     legacy ikke lenger skriver nodene).
 *
 * Porten er bevisst en kodeendring — ingen UI-bryter, miljøvariabel eller
 * lagret innstilling — så den kan ikke slås på ved et uhell. Hooks avviser
 * skriving før datalaget røres, og skjermene skjuler skrivekontrollene.
 */
export function forsoningSkrivingAktiv(): boolean {
  return false;
}

export class ForsoningSkrivingStengt extends Error {
  constructor(
    melding = "Skriving til forsoningsnodene er stengt til R3b-cutover (én aktiv skriver per node, Issue #34).",
  ) {
    super(melding);
    this.name = "ForsoningSkrivingStengt";
  }
}
