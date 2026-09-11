/**
 * Innebygde standardhendelser — ren kodekonstant, ALDRI persistert
 * (§designbok.md, låst prinsipp: "Ingen hardkodede demo-poster i
 * kildekoden" gjelder DATA, ikke UI-valgmuligheter; denne listen skriver
 * aldri noe til Firebase av seg selv). Kuratert ned fra dagens
 * `MEAL_EVENTS` (index.html linje ~403–413, tidligere 1:1-portert i
 * `PlanScreen.tsx`) i Middagsplan v1 (§Kontrolltårn-handoff, Issue #20,
 * "Byggehandoff — Middagsplan v1", "Rydd samtidig skillet i dagens
 * hardkodede hendelsesliste"):
 *
 * FJERNET (flyttet til å være en vanlig planlagt middag, ikke en
 * hendelse): "Grandiosa" — en konkret, nevnbar rett hører hjemme som
 * middag/variant, ikke som en hendelse-situasjon uten ingredienser
 * (§domain/meals/meals.ts: `getMealRecipes()` gir alltid `[]` for
 * hendelser — "Grandiosa" SKAL kunne generere handleliste). Ingen
 * biblioteksoppføring for "Grandiosa" opprettes automatisk her eller noe
 * annet sted — det ville vært nøyaktig den hardkodede demo-posten
 * designboken forbyr; brukeren planlegger den som enhver annen middag
 * (fritekst, eller sin egen biblioteksoppføring).
 *
 * BEHOLDT som ekte hendelser — ingen av dem har ingrediens-/oppskrifts-
 * karakter, alle er situasjoner der kjøkkenets middagsoppgave i praksis
 * er håndtert på en annen måte: "Enkel middag" og "Rester" er begge
 * beskrivelser av HVORDAN middagen ble løst, ikke navnet på en spesifikk
 * rett som trenger et eget handlegrunnlag — samme semantiske kategori som
 * "Spiser ute"/"Ingen middag hjemme", derfor beholdt her fremfor flyttet.
 */
export interface MealEventDefault {
  name: string;
  emoji: string;
}

export const DEFAULT_MEAL_EVENTS: readonly MealEventDefault[] = [
  { name: "Middag hos svigermor", emoji: "🏡" },
  { name: "Middag hos foreldrene", emoji: "🏠" },
  { name: "Enkel middag", emoji: "🍳" },
  { name: "Rester", emoji: "♻️" },
  { name: "Spiser ute", emoji: "🍽️" },
  { name: "Hytta", emoji: "🌲" },
  { name: "Ingen middag hjemme", emoji: "❌" },
  { name: "Annet", emoji: "⭐" },
];
