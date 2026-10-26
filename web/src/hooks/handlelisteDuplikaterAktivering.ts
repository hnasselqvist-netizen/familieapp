/**
 * Sammenslåing av handlelisteduplikater (Mat #20) er en MUTERENDE flyt som
 * holdes utilgjengelig i produksjon til legacy-risikoen er avklart
 * (review 6353438086 pkt. 5): index.html skriver fortsatt HELE
 * `shopping`-noden fra lokal tilstand og kan overskrive resultatet eller
 * historikken. Flyten er bare synlig mot emulatoren (utvikling, CI,
 * E2E). Produksjon og preview bygges med `VITE_FIREBASE_USE_EMULATOR=false`
 * (`.github/workflows/production.yml`, `preview.yml`).
 *
 * Aktivering i produksjon er en egen, reviewet endring: sett
 * `HANDLELISTE_DUPLIKATER_I_PRODUKSJON` til `true` først når legacy-vernet
 * er på plass.
 */
export const HANDLELISTE_DUPLIKATER_I_PRODUKSJON = false;

export function handlelisteDuplikaterAktiv(): boolean {
  return (
    HANDLELISTE_DUPLIKATER_I_PRODUKSJON || import.meta.env.VITE_FIREBASE_USE_EMULATOR === "true"
  );
}
