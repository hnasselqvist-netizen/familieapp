import { useState } from "react";
import { Modal } from "@components/Modal";
import type { Vare } from "@app-types/vare";
import type { RecipeFields } from "@app-types/recipe";
import { emptyIngredientRow, type IngredientRow } from "./ingredientRow";
import { IngredientEditor, type IngredientGroupDraft } from "./IngredientEditor";
import styles from "./QuickAddRecipeModal.module.css";

const RECIPE_TYPES = [
  { id: "Middag", emoji: "🍽️" },
  { id: "Frokost", emoji: "🍳" },
  { id: "Lunsj", emoji: "🥪" },
  { id: "Dessert", emoji: "🍰" },
  { id: "Bakst", emoji: "🍪" },
  { id: "Tilbehør", emoji: "🥗" },
  { id: "Drikke", emoji: "🥤" },
  { id: "Annet", emoji: "⭐" },
];

/**
 * `itemId`/`cat` persisteres nå fra raden i stedet for å bli forkastet/
 * hardkodet (§Kontrolltårn-handoff, Issue #2: "Ingredient↔Vare"-
 * koblingen, samme fiks som `RecipeFormModal.tsx`) — `ItemPicker` har
 * allerede resolvert/opprettet varen og lagt `itemId`+`cat` i
 * radtilstanden. `cat` faller kun tilbake til "Diverse" når raden aldri
 * ble koblet til en vare (fritekst-navn).
 */
function rowsToIngredients(rows: IngredientRow[]) {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      amount: r.amount ? `${r.amount} ${r.unit}`.trim() : "",
      unit: r.unit,
      cat: r.cat || "Diverse",
      itemId: r.itemId,
    }));
}

export interface QuickAddRecipeModalProps {
  onSave: (fields: RecipeFields) => void;
  onClose: () => void;
  items: Vare[];
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
}

/**
 * Hurtigregistrering av ny oppskrift — portert fra `AddRecipeModal` sin
 * "quick"-fane (index.html linje ~4150–4379). URL- og bilde-fanene er
 * bevisst IKKE portert her — se PR-beskrivelsen for begrunnelse
 * (URL-fanen kaller Anthropic-API-et direkte fra klienten uten
 * autentisering og ser ut til å allerede være ikke-funksjonell i
 * produksjon; bilde-fanen er en marginal funksjon utsatt til en egen
 * skive om ønskelig).
 */
export function QuickAddRecipeModal({
  onSave,
  onClose,
  items,
  findOrCreateItem,
}: QuickAddRecipeModalProps) {
  const [cat, setCat] = useState("Middag");
  const [name, setName] = useState("");
  const [rows, setRows] = useState<IngredientRow[]>([emptyIngredientRow()]);
  const [groups, setGroups] = useState<IngredientGroupDraft[]>([]);
  const [instructions, setInstructions] = useState("");

  const ready = name.trim().length > 0;

  const save = () => {
    if (!ready) return;
    const hasGroups = groups.length > 0;
    const fields: RecipeFields = {
      name: name.trim(),
      cat,
      tags: [],
      time: 0,
      servings: 0,
      url: "",
      imageUrl: null,
      source: "quick",
      instructions: instructions.trim(),
      ingredients: hasGroups ? [] : rowsToIngredients(rows),
      ingredientGroups: hasGroups
        ? groups.map((g) => ({ id: g.id, name: g.name, ingredients: rowsToIngredients(g.rows) }))
        : [],
      lastCooked: null,
      timesCooked: 0,
      createdAt: Date.now(),
    };
    onSave(fields);
    onClose();
  };

  return (
    <Modal title="Ny oppskrift" onClose={onClose}>
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Type</div>
        <div className={styles.typeGrid}>
          {RECIPE_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCat(t.id)}
              className={cat === t.id ? styles.typeButtonActive : styles.typeButton}
            >
              <span>{t.emoji}</span>
              <span>{t.id}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Navn på retten…"
          autoComplete="off"
          className={styles.nameInput}
        />
      </div>

      <div className={styles.sectionLabel}>Ingredienser</div>
      <IngredientEditor
        rows={rows}
        setRows={setRows}
        groups={groups}
        setGroups={setGroups}
        items={items}
        findOrCreateItem={findOrCreateItem}
      />

      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          Fremgangsmåte <span className={styles.optional}>(valgfritt)</span>
        </div>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Skriv fremgangsmåte her…"
          rows={4}
          className={styles.instructions}
        />
      </div>

      <button type="button" onClick={save} disabled={!ready} className={styles.saveButton}>
        {ready ? `Lagre «${name.trim()}»` : "Skriv navn på retten"}
      </button>
    </Modal>
  );
}
