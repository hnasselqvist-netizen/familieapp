/**
 * Sammenslåing av handlelisteduplikater (Mat #20) er en MUTERENDE flyt. Den
 * var bare synlig mot emulatoren til legacy-vernet var på plass (review
 * 6353438086 pkt. 5): index.html skrev HELE `shopping`-noden fra lokal
 * tilstand og kunne overskrive resultatet eller historikken.
 *
 * **Aktivert (ADR 0003 steg 6, Helens beslutning i #20 6507010011):**
 * serververnet (rules med skrivermarkør) og markøren står i produksjon
 * siden 29. oktober, med uavhengig etterkontroll (#77 6499440077). Flagget
 * gjelder også preview, som bruker samme backend.
 *
 * Tilbakerulling: sett flagget til `false` og deploy. «Angre» ligger
 * utenfor porten og virker fortsatt; serververnet beholdes
 * (§ADR 0003 «Tilbakerulling etter aktivering»).
 */
export const HANDLELISTE_DUPLIKATER_I_PRODUKSJON = true;

export function handlelisteDuplikaterAktiv(): boolean {
  return (
    HANDLELISTE_DUPLIKATER_I_PRODUKSJON || import.meta.env.VITE_FIREBASE_USE_EMULATOR === "true"
  );
}
