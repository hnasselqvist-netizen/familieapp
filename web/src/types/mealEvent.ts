/**
 * Brukerdefinerte hendelser i Middagsplanen (Middagsplan v1, §Kontrolltårn-
 * handoff, Issue #20, "Byggehandoff — Middagsplan v1": "Gjør hendelsene
 * brukerforvaltbare på en enkel måte... brukeren skal kunne
 * velge/opprette/redigere relevant hendelse"). Lagres under
 * `families/{familyId}/mealEvents/{id}` — en NY, additiv samling, atskilt
 * fra de innebygde standardhendelsene (§domain/meals/mealEventDefaults.ts,
 * ren kodekonstant, ikke persistert). Brukeren kan opprette/redigere/
 * fjerne sine egne; standardhendelsene er ikke redigerbare (holder
 * modellen enkel — "uten at planflaten blir et administrasjonsskjema").
 *
 * Uavhengig av `MealEventValue` (§types/meal.ts) — SELVE dagverdien når en
 * dag settes til en hendelse er og forblir `{type:"event", name, emoji?}`,
 * uendret og fullt bakoverkompatibel. Denne samlingen er kun KATALOGEN
 * brukeren velger fra/administrerer, ikke en endring av hvordan valget
 * lagres på selve dagen.
 */
export interface MealEventOption {
  id: string;
  name: string;
  emoji?: string;
}
