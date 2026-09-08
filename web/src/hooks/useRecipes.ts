import { useEffect, useState } from "react";
import {
  createRecipe,
  deleteRecipe,
  subscribeRecipes,
  transactRecipe,
} from "@data/recipes.repository";
import type { Recipe, RecipeFields } from "@app-types/recipe";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseRecipesResult {
  recipes: Loadable<Recipe[]>;
  addRecipe: (fields: RecipeFields) => Promise<Recipe>;
  updateRecipe: (id: string, patch: Partial<RecipeFields>) => Promise<void>;
  removeRecipe: (id: string) => Promise<void>;
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

  const removeRecipe = (id: string) => deleteRecipe(familyId, id);

  return { recipes, addRecipe, updateRecipe, removeRecipe };
}
