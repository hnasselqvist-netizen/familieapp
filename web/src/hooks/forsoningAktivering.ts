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
 *
 * **Eneste unntak er test (pre-cutover 3):** et bygg med
 * `vite build --mode e2e-skriving` har porten PÅ, slik at
 * `npm run test:e2e:skriving` kan kjøre skrivende flyter mot Firebase-
 * emulatoren (`.env.e2e-skriving` peker bare dit). Byggmodusen er en
 * byggtidskonstant som Vite erstatter ved bygg: `npm run build` (modus
 * `production`) kompilerer porten til `false`, og Vitest kjører i modus
 * `test`. Ingen miljøvariabel, URL eller lagret verdi kan slå den på.
 * Låst i `forsoningAktivering.test.ts`.
 */
export const E2E_SKRIVING_MODUS = "e2e-skriving";

export function forsoningSkrivingAktiv(): boolean {
  return import.meta.env.MODE === E2E_SKRIVING_MODUS;
}

export class ForsoningSkrivingStengt extends Error {
  constructor(
    melding = "Skriving til forsoningsnodene er stengt til R3b-cutover (én aktiv skriver per node, Issue #34).",
  ) {
    super(melding);
    this.name = "ForsoningSkrivingStengt";
  }
}
