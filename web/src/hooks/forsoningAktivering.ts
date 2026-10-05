/**
 * Felles aktiveringsport for ALL React-skriving til forsoningsnodene
 * `transaksjoner`, `hendelser`, `receipts` og `rules` (§Issue #34 R3b,
 * ADR 0002).
 *
 * **PÅ siden R3b-cutover (2026-10-05, godkjent av Helen på #34).** Nesten
 * hver legacy-flyt skriver to–tre av nodene samtidig (Kvitteringsinnboks,
 * Bankimport, RegelSenter, korrigering i gammel Budsjett/Inntekter/Sparing
 * — se `docs/arkitektur/r3b-cutover.md`), så de fire nodene byttet skriver
 * i ÉN felles cutover, i samme release som legacy-skrivesperren i de fire
 * sentrale setterne (`docs/arkitektur/r3b-legacy-skrivesperre.patch`,
 * anvendt i `index.html` som egen revertérbar commit).
 *
 * **Rollback:** sett `FORSONING_CUTOVER_GJENNOMFORT` til `false`, deploy
 * `web/`, og reverter sperre-commiten i `index.html`. Ingen datamigrering
 * (samme array-form, se `r3b-cutover.md` §5). Porten er bevisst en
 * kodeendring — ingen UI-bryter, miljøvariabel eller lagret innstilling.
 * Hooks avviser skriving før datalaget røres når den er av, og skjermene
 * skjuler skrivekontrollene.
 *
 * Bygg med `vite build --mode e2e-skriving` har porten PÅ uavhengig av
 * flagget, slik at `npm run test:e2e:skriving` fortsatt dekker skrivende
 * flyter mot Firebase-emulatoren også om flagget settes tilbake.
 * Låst i `forsoningAktivering.test.ts`.
 */
export const E2E_SKRIVING_MODUS = "e2e-skriving";

/** R3b-cutover er gjennomført: React er eneste skriver av forsoningsnodene. */
export const FORSONING_CUTOVER_GJENNOMFORT = true;

export function forsoningSkrivingAktiv(): boolean {
  return FORSONING_CUTOVER_GJENNOMFORT || import.meta.env.MODE === E2E_SKRIVING_MODUS;
}

export class ForsoningSkrivingStengt extends Error {
  constructor(
    melding = "Skriving til forsoningsnodene er stengt (én aktiv skriver per node, Issue #34).",
  ) {
    super(melding);
    this.name = "ForsoningSkrivingStengt";
  }
}
