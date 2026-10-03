import { ForsoningSkrivingStengt, forsoningSkrivingAktiv } from "./forsoningAktivering";

/**
 * Aktiveringsporten for React-RegelSenter sin SKRIVING til `rules`
 * (§Issue #34 R1, Kontrolltårn-beslutning 5952884278).
 *
 * `rules` bytter skriver i samme R3b-cutover som de tre andre
 * forsoningsnodene, så porten følger den felles porten i
 * `forsoningAktivering.ts` (AV til cutover). Se den filen og ADR 0002 for
 * hvorfor porten er en kodeendring og hva som må skje i samme release.
 */
export function regelsenterSkrivingAktiv(): boolean {
  return forsoningSkrivingAktiv();
}

export class RegelsenterSkrivingStengt extends ForsoningSkrivingStengt {
  constructor() {
    super("Regelsenter-skriving er stengt til R3b-cutover (én aktiv skriver per node, Issue #34).");
    this.name = "RegelsenterSkrivingStengt";
  }
}
