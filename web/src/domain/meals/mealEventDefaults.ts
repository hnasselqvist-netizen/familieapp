/**
 * Innebygde standardhendelser — ren kodekonstant, ALDRI persistert
 * (§designbok.md, låst prinsipp: "Ingen hardkodede demo-poster i
 * kildekoden" gjelder DATA, ikke UI-valgmuligheter; denne listen skriver
 * aldri noe til Firebase av seg selv).
 *
 * **Den låste 3-hendelsesmodellen** (§Helen-review, PR #26, design-review
 * runde 3, §8 — "Denne endringen prioriteres i denne runden. Dagens åtte
 * standardhendelser er gammel mellomtilstand"), som erstatter Middagsplan
 * v1 sitt tidligere 8-hendelses-mellomsett (kuratert ned fra produksjonens
 * `MEAL_EVENTS`, index.html linje ~403–413, i §Kontrolltårn-handoff, Issue
 * #20):
 *
 * - **"Middag hos svigermor"/"Middag hos foreldrene"** samles nå under
 *   **"Spiser et annet sted"** med et valgfritt detaljfelt (`allowsDetail`
 *   under) — brukeren skriver selv "hos svigermor"/"restaurant"/"venner"
 *   der det er relevant, i stedet for én hardkodet relasjon per hendelse.
 * - **"Enkel middag"** er FJERNET som hendelse — den er et pre-planleggings-
 *   input/dagskrav til Førsteutkast (§ForsteutkastPanel.tsx sin
 *   `lettvintDager`), ikke en situasjon der middagsoppgaven ble løst på en
 *   annen måte.
 * - **"Take-away"** er NY — maten spises hjemme, men kjøpes/hentes samme
 *   dag; uten ordinær oppskrift/handlegrunnlag, samme semantiske kategori
 *   som "Rester".
 * - **"Hytta"/"Ingen middag hjemme"/"Annet"** er FJERNET — dekket av den
 *   enklere modellen over, eller av brukeropprettede hendelser
 *   (§hooks/useMealEvents.ts, uendret additiv modell).
 * - **"Grandiosa"** hører fortsatt hjemme som middag/variant (fjernet fra
 *   hendelseslisten allerede i Middagsplan v1, uendret her) — ingen
 *   biblioteksoppføring opprettes automatisk noe sted.
 *
 * Ingen av de tre har ingrediens-/oppskriftskarakter — alle er situasjoner
 * der kjøkkenets middagsoppgave i praksis er håndtert på en annen måte
 * (§domain/meals/meals.ts: `getMealRecipes()` gir alltid `[]` for
 * hendelser).
 */
export interface MealEventDefault {
  name: string;
  emoji: string;
  /**
   * Tilbyr et valgfritt detaljfelt ved valg (§ActiveMealCard.tsx sin
   * `eventDetail`-modus) — brukt av "Spiser et annet sted" for å la
   * brukeren beskrive f.eks. svigermor, foreldre, restaurant eller venner
   * uten en egen hendelse per relasjon. Detaljen skrives inn i selve
   * `name` ved bekreftelse (`"${name} – ${detalj}"`) — dagverdiens lagrede
   * form (`{type:"event",name,emoji?}`) endres ikke.
   */
  allowsDetail?: boolean;
}

export const DEFAULT_MEAL_EVENTS: readonly MealEventDefault[] = [
  { name: "Spiser et annet sted", emoji: "🍽️", allowsDetail: true },
  { name: "Rester", emoji: "♻️" },
  { name: "Take-away", emoji: "🥡" },
];
