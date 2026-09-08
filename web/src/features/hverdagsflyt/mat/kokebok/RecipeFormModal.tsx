import { useState } from "react";
import { Modal } from "@components/Modal";
import type { Vare } from "@app-types/vare";
import type { Ingredient, IngredientGroup, Recipe, RecipeFields } from "@app-types/recipe";
import { emptyIngredientRow, type IngredientRow } from "./ingredientRow";
import { IngredientEditor, type IngredientGroupDraft } from "./IngredientEditor";
import styles from "./RecipeFormModal.module.css";

const RECIPE_CATS = ["Middag", "Frokost", "Lunsj", "Dessert", "Snacks"];

function ingredientToRow(ing: Ingredient): IngredientRow {
  const amountStr = String(ing.amount || "");
  const numPart = amountStr.replace(/[^0-9.,]/g, "").trim();
  const unitPart = amountStr.replace(/[0-9.,\s]/g, "").trim();
  return {
    id: crypto.randomUUID(),
    name: ing.name || "",
    amount: numPart,
    unit: ing.unit || unitPart || "stk",
    itemId: null,
    cat: "",
  };
}

function toFlatRows(recipe: Recipe): IngredientRow[] {
  if (recipe.ingredientGroups.length > 0) return [emptyIngredientRow()];
  return [...recipe.ingredients.map(ingredientToRow), emptyIngredientRow()];
}

function toGroupDrafts(recipe: Recipe): IngredientGroupDraft[] {
  if (recipe.ingredientGroups.length === 0) return [];
  return recipe.ingredientGroups.map((g: IngredientGroup) => ({
    id: g.id || crypto.randomUUID(),
    name: g.name || "Ingredienser",
    rows: [...g.ingredients.map(ingredientToRow), emptyIngredientRow()],
  }));
}

function rowsToIngredients(rows: IngredientRow[]): Ingredient[] {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      amount: r.amount ? `${r.amount} ${r.unit}`.trim() : "",
      unit: r.unit,
      cat: "Diverse",
    }));
}

export interface RecipeFormModalProps {
  /** `null` = ny oppskrift (avansert flyt), en `Recipe` = rediger eksisterende. */
  initial: Recipe | null;
  onSave: (patch: Partial<RecipeFields>) => void;
  onClose: () => void;
  items: Vare[];
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
}

/**
 * Full oppskrift-redigering — portert fra `RecipeForm` (index.html linje
 * ~4476–4635). URL-hent-boksen øverst er bevisst IKKE portert (samme
 * ikke-autentiserte, tilsynelatende ikke-funksjonelle Anthropic-API-kall
 * som i `QuickAddRecipeModal` — se PR-beskrivelsen).
 */
export function RecipeFormModal({
  initial,
  onSave,
  onClose,
  items,
  findOrCreateItem,
}: RecipeFormModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [time, setTime] = useState(initial ? String(initial.time || "") : "");
  const [servings, setServings] = useState(initial ? String(initial.servings || "") : "");
  const [cat, setCat] = useState(initial?.cat ?? "Middag");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [lettvint, setLettvint] = useState(initial?.lettvint ?? false);
  const [variationTags, setVariationTags] = useState(initial?.variationTags?.join(", ") ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [rows, setRows] = useState<IngredientRow[]>(
    initial ? toFlatRows(initial) : [emptyIngredientRow()],
  );
  const [groups, setGroups] = useState<IngredientGroupDraft[]>(
    initial ? toGroupDrafts(initial) : [],
  );

  const ready = name.trim().length > 0;

  const save = () => {
    if (!ready) return;
    const hasGroups = groups.length > 0;
    const patch: Partial<RecipeFields> = {
      name: name.trim(),
      time: Number.parseInt(time, 10) || 0,
      servings: Number.parseInt(servings, 10) || 4,
      cat,
      tags: tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      lettvint,
      variationTags: variationTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      instructions: instructions || "",
      ingredients: hasGroups ? [] : rowsToIngredients(rows),
      ingredientGroups: hasGroups
        ? groups.map((g) => ({ id: g.id, name: g.name, ingredients: rowsToIngredients(g.rows) }))
        : [],
    };
    onSave(patch);
    onClose();
  };

  return (
    <Modal title={initial ? "Rediger oppskrift" : "Legg til oppskrift"} onClose={onClose}>
      <div className={styles.form}>
        <div>
          <div className={styles.fieldLabel}>Navn *</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            placeholder="Tomatsuppe…"
            className={styles.nameInput}
          />
        </div>
        <div className={styles.grid3}>
          <div>
            <div className={styles.fieldLabel}>Tid (min)</div>
            <input
              type="number"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              autoComplete="off"
              placeholder="30"
            />
          </div>
          <div>
            <div className={styles.fieldLabel}>Porsjoner</div>
            <input
              type="number"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              autoComplete="off"
              placeholder="4"
            />
          </div>
          <div>
            <div className={styles.fieldLabel}>Kategori</div>
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {RECIPE_CATS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>Ingredienser</div>
          <IngredientEditor
            rows={rows}
            setRows={setRows}
            groups={groups}
            setGroups={setGroups}
            items={items}
            findOrCreateItem={findOrCreateItem}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>Tagger</div>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            autoComplete="off"
            placeholder="enkel, favoritt…"
          />
        </div>
        <div>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={lettvint}
              onChange={(e) => setLettvint(e.target.checked)}
            />
            🍃 Lettvint middag
          </label>
        </div>
        <div>
          <div className={styles.fieldLabel}>
            Variasjonstagger <span className={styles.optional}>(valgfritt)</span>
          </div>
          <input
            value={variationTags}
            onChange={(e) => setVariationTags(e.target.value)}
            autoComplete="off"
            placeholder="fisk, pasta, pizza…"
          />
          <div className={styles.fieldHint}>
            Brukes KUN av Førsteutkast for å unngå at like middager havner rett etter hverandre —
            ikke det samme som «Tagger» over.
          </div>
        </div>
        <div>
          <div className={styles.fieldLabel}>
            Fremgangsmåte <span className={styles.optional}>(valgfritt)</span>
          </div>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Skriv fremgangsmåte her…"
            rows={5}
            className={styles.instructions}
          />
        </div>
        <button type="button" onClick={save} disabled={!ready} className={styles.saveButton}>
          💾 {initial ? "Lagre endringer" : "Lagre oppskrift"}
        </button>
      </div>
    </Modal>
  );
}
