import { useState } from "react";
import { Card } from "@components/Card";
import { getIngredients, scaleIngredientAmount } from "@domain/recipes/recipes";
import { freezerLabel } from "@domain/freezer/freezer";
import type { Ingredient, Recipe } from "@app-types/recipe";
import type { FreezerItem } from "@app-types/freezer";
import styles from "./RecipeIngredients.module.css";

export interface RecipeIngredientsProps {
  recipe: Recipe;
  freezer: FreezerItem[];
}

/** Et porsjonstall brukeren selv har valgt med ＋/−, bundet til oppskriften. */
interface Porsjonsvalg {
  recipeId: string;
  antall: number;
}

/**
 * Ingrediensvisning med skalering og fryseroverlegg — portert fra
 * `RecipeIngredients` (index.html linje ~4697–4766). Skalering er ren
 * visningslogikk (§designbok.md 3.1) — lagret data endres aldri.
 *
 * Visningen følger fersk `servings` så lenge brukeren ikke har valgt
 * porsjoner selv (#20 6774247374). Da vises de lagrede mengdene, også når
 * grunnen endres mens oppskriften er åpen, for eksempel fra ukjent (0) til 4.
 * Et uttrykkelig valg bevares når grunnen endres for samme oppskrift, og
 * gjelder aldri en annen oppskrift.
 */
export function RecipeIngredients({ recipe, freezer }: RecipeIngredientsProps) {
  const base = recipe.servings || 0;
  const [valg, setValg] = useState<Porsjonsvalg | null>(null);
  const valgt = valg?.recipeId === recipe.id ? valg.antall : null;
  const scale = valgt ?? (base || 1);
  const setScale = (endre: (s: number) => number) =>
    setValg((forrige) => ({
      recipeId: recipe.id,
      antall: endre(forrige?.recipeId === recipe.id ? forrige.antall : base || 1),
    }));

  const hasGroups = recipe.ingredientGroups.length > 0;

  if (!hasGroups && recipe.ingredients.length === 0) return null;

  const renderRow = (ing: Ingredient, key: string | number) => (
    <div key={key} className={styles.row}>
      <span className={styles.name}>{ing.name || ""}</span>
      {(() => {
        const label = freezerLabel(ing.name, freezer);
        return label && <span className={styles.freezerBadge}>{label}</span>;
      })()}
      <span className={styles.amount}>{scaleIngredientAmount(ing.amount, base, scale)}</span>
    </div>
  );

  return (
    <Card style={{ marginBottom: 12 }}>
      <div className={styles.header}>
        <span className={styles.title}>Ingredienser</span>
        {base > 0 && (
          <div className={styles.scaleControls}>
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(1, s - 1))}
              aria-label="Færre porsjoner"
              className={styles.scaleButton}
            >
              −
            </button>
            <span className={styles.scaleValue}>{scale} pers</span>
            <button
              type="button"
              onClick={() => setScale((s) => s + 1)}
              aria-label="Flere porsjoner"
              className={styles.scaleButton}
            >
              ＋
            </button>
          </div>
        )}
      </div>
      {hasGroups
        ? recipe.ingredientGroups.map((g) => (
            <div key={g.id} className={styles.group}>
              <div className={styles.groupName}>{g.name || "Ingredienser"}</div>
              {g.ingredients.map((ing, i) => renderRow(ing, i))}
            </div>
          ))
        : getIngredients(recipe).map((ing, i) => renderRow(ing, i))}
    </Card>
  );
}
