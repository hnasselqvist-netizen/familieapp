import { useState } from "react";
import { Icon } from "@components/Icon";
import { Modal } from "@components/Modal";
import type { Vare } from "@app-types/vare";
import type { Ingredient, IngredientGroup, Recipe, RecipeFields } from "@app-types/recipe";
import { emptyIngredientRow, type IngredientRow } from "./ingredientRow";
import { IngredientEditor, type IngredientGroupDraft } from "./IngredientEditor";
import styles from "./RecipeFormModal.module.css";

const RECIPE_CATS = ["Middag", "Frokost", "Lunsj", "Dessert", "Snacks"];

/**
 * Bevarer en eksisterende ingrediens sin `itemId`/`cat` når raden bygges
 * for redigering — IKKE hardkodet til `null`/`""` (§Kontrolltårn-handoff,
 * Issue #2: "Ingredient↔Vare"-koblingen). En tidligere versjon nullet
 * disse ut her uansett, som ville forkastet en allerede lagret varekobling
 * stille ved neste lagring dersom raden ikke ble rørt.
 */
function ingredientToRow(ing: Ingredient): IngredientRow {
  const amountStr = String(ing.amount || "");
  const numPart = amountStr.replace(/[^0-9.,]/g, "").trim();
  const unitPart = amountStr.replace(/[0-9.,\s]/g, "").trim();
  return {
    id: crypto.randomUUID(),
    name: ing.name || "",
    amount: numPart,
    unit: ing.unit || unitPart || "stk",
    itemId: ing.itemId ?? null,
    cat: ing.cat || "",
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

/**
 * `itemId`/`cat` persisteres nå fra raden i stedet for å bli forkastet/
 * hardkodet (§Kontrolltårn-handoff, Issue #2: "Ingredient↔Vare"-
 * koblingen) — `ItemPicker` har allerede resolvert/opprettet varen og
 * lagt `itemId`+`cat` i radtilstanden, se `IngredientRows.tsx`. `cat`
 * faller kun tilbake til "Diverse" når raden aldri ble koblet til en
 * vare (fritekst-navn), samme fallback som før — ikke lenger ubetinget.
 */
function rowsToIngredients(rows: IngredientRow[]): Ingredient[] {
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
 * ~4476–4635). URL-HENTE-boksen øverst (AI-basert autoutfylling fra en
 * ekstern lenke) er bevisst IKKE portert — samme ikke-autentiserte,
 * tilsynelatende ikke-funksjonelle Anthropic-API-kall som i
 * `QuickAddRecipeModal` — se PR-beskrivelsen.
 *
 * **Kjøkken v1 — bilde/kilde-lenke som ordinære redigerbare felt**
 * (§Kontrolltårn-handoff, Issue #20, "fullfør den naturlige
 * registrerings-/redigeringsflyten... bevar eksisterende oppskriftsdata,
 * importmulighet, bilde/URL-funksjon og koblinger"): `Recipe.imageUrl`/
 * `Recipe.url` fantes allerede i datamodellen og ble lest/vist i
 * `RecipesScreen`s detaljvisning, men det fantes ingen UI noe sted i
 * `web/` for faktisk å SETTE dem — kun den nå bevisst utelatte AI-
 * hente-flyten skrev dem. Disse to feltene er derfor nå ordinære
 * fritekst-URL-felt her, samme mønster som øvrige valgfrie felt
 * (`Tagger`/`Variasjonstagger`) — INGEN gjenoppbygging av AI-henting,
 * kun manuell inntasting/redigering av en allerede eksisterende,
 * allerede lest/vist datamodell.
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
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.url ?? "");
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
      imageUrl: imageUrl.trim() || null,
      url: sourceUrl.trim(),
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
          <div className={styles.fieldLabel}>
            Bilde-URL <span className={styles.optional}>(valgfritt)</span>
          </div>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            autoComplete="off"
            placeholder="https://…"
            className={styles.nameInput}
          />
        </div>
        <div>
          <div className={styles.fieldLabel}>
            Kilde-lenke <span className={styles.optional}>(valgfritt)</span>
          </div>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            autoComplete="off"
            placeholder="https://… (originaloppskriften)"
            className={styles.nameInput}
          />
        </div>
        <div>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={lettvint}
              onChange={(e) => setLettvint(e.target.checked)}
            />
            <Icon name="sprout" size={13} /> Lettvint middag
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
