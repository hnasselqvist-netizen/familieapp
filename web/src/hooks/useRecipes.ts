import { useEffect, useState } from "react";
import {
  createRecipe,
  deleteRecipe,
  subscribeRecipes,
  transactRecipe,
  transactRecipeMedUtfall,
} from "@data/recipes.repository";
import {
  redigerHvisUendret,
  SKJEMAFELT,
  slettHvisUendret,
  type RedigeringsUtfall,
  type SletteUtfall,
} from "@domain/recipes/recipes";
import type { Recipe, RecipeFields } from "@app-types/recipe";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseRecipesResult {
  recipes: Loadable<Recipe[]>;
  addRecipe: (fields: RecipeFields) => Promise<Recipe>;
  updateRecipe: (id: string, patch: Partial<RecipeFields>) => Promise<void>;
  /**
   * Redigering fra skjemaet, med `observert` (oppskriften slik skjemaet ble
   * åpnet) som grunnlag for alle feltene skjemaet viser (`SKJEMAFELT`), også
   * dem patchen ikke skriver. Se `redigerHvisUendret`.
   */
  redigerRecipe: (observert: Recipe, patch: Partial<RecipeFields>) => Promise<RedigeringsUtfall>;
  removeRecipe: (id: string) => Promise<void>;
  /**
   * «Slett» med `observert` (oppskriften slik detaljen viste den) som
   * grunnlag. Se `slettHvisUendret`.
   */
  slettRecipe: (observert: Recipe) => Promise<SletteUtfall>;
}

/** React-binding for kokeboken — status følger §not_loaded/loading/loaded-kontrakten. */
export function useRecipes(): UseRecipesResult {
  const familyId = useFamilyId();
  const [recipes, setRecipes] = useState<Loadable<Recipe[]>>(notLoaded);

  useEffect(() => {
    setRecipes(loading);
    const unsubscribe = subscribeRecipes(familyId, (data) => setRecipes(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const addRecipe = (fields: RecipeFields) => createRecipe(familyId, fields);

  /**
   * Muterer via `transactRecipe`, og MERGER `patch` inn i den ferskeste
   * server-verdien i stedet for å erstatte den — bevisst avvik fra dagens
   * `RecipeForm.save()` (index.html linje ~4542–4555), som bygger et NYTT
   * objekt uten `imageUrl`/`source`/`lastCooked`/`timesCooked`. Fordi
   * `RecipesScreen.saveRecipe` sin `normalise()` deretter fyller inn
   * `imageUrl:null`/`source:"manual"` som fallback FØR disse skrives inn i
   * den eksisterende oppskriften, sletter dagens redigeringsflyt i praksis
   * en oppskrifts bilde og nullstiller kilden ved enhver redigering — en
   * utilsiktet regresjon, ikke en produktbeslutning (§Kontrolltårn-handoff:
   * "ikke fossiliser kjente produktregresjoner som ny fasit"). Denne
   * merge-baserte oppdateringen bevarer feltene skjemaet ikke selv
   * redigerer.
   */
  const updateRecipe = async (id: string, patch: Partial<RecipeFields>) => {
    await transactRecipe(familyId, id, (current) => (current ? { ...current, ...patch } : null));
  };

  /**
   * Validerer grunnlaget atomisk i transaksjonen (#20 6781074174). Et endret
   * eller slettet mål avvises uten skriving og uten gjenoppretting.
   */
  const redigerRecipe = async (
    observert: Recipe,
    patch: Partial<RecipeFields>,
  ): Promise<RedigeringsUtfall> => {
    const { id, ...observertFelt } = observert;
    const r = await transactRecipeMedUtfall(
      familyId,
      id,
      (current) => redigerHvisUendret(current, observertFelt, patch, SKJEMAFELT),
      "mangler" as const,
    );
    return r.type === "stopp" ? r.utfall : r.type;
  };

  const removeRecipe = (id: string) => deleteRecipe(familyId, id);

  /**
   * Validerer grunnlaget atomisk i transaksjonen (#20 6789830224). Et endret
   * eller manglende mål avvises uten endring.
   */
  const slettRecipe = async (observert: Recipe): Promise<SletteUtfall> => {
    const { id, ...observertFelt } = observert;
    const r = await transactRecipeMedUtfall(
      familyId,
      id,
      (current) => slettHvisUendret(current, observertFelt),
      "mangler" as const,
    );
    if (r.type === "stopp") return r.utfall;
    return r.type === "lagret" ? "slettet" : r.type;
  };

  return { recipes, addRecipe, updateRecipe, redigerRecipe, removeRecipe, slettRecipe };
}
