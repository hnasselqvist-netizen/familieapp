import { useState } from "react";
import { Card } from "@components/Card";
import { useFreezer } from "@hooks/useFreezer";
import { useItems } from "@hooks/useItems";
import { useRecipes } from "@hooks/useRecipes";
import type { Recipe } from "@app-types/recipe";
import { AddToPlanCard } from "./AddToPlanCard";
import { QuickAddRecipeModal } from "./QuickAddRecipeModal";
import { RecipeFormModal } from "./RecipeFormModal";
import { RecipeIngredients } from "./RecipeIngredients";
import styles from "./RecipesScreen.module.css";

const CATEGORIES = ["Alle", "Middag", "Frokost", "Lunsj", "Dessert", "Snacks"];

/**
 * Kokebok — første Fase 2-skjerm migrert fra index.html
 * (`RecipesScreen`, linje ~4769–4900). Funksjonell paritet mot dagens
 * skjerm, med to bevisste avvik dokumentert i PR-beskrivelsen: URL-/
 * bilde-import er ikke portert (URL-fanen kaller Anthropic-API-et direkte
 * fra klienten uten autentisering og fremstår allerede ikke-funksjonell i
 * produksjon), og redigering via full-skjemaet MERGER nå inn i den
 * eksisterende oppskriften i stedet for å slette `imageUrl`/`source`
 * (§hooks/useRecipes.ts sin `updateRecipe`).
 */
export function RecipesScreen() {
  const { recipes, addRecipe, updateRecipe, removeRecipe } = useRecipes();
  const { items, findOrCreateItem } = useItems();
  const { freezer } = useFreezer();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [filter, setFilter] = useState("Alle");
  const [search, setSearch] = useState("");

  if (recipes.status !== "loaded" || items.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const allRecipes = recipes.data;
  const selected = selectedId ? allRecipes.find((r) => r.id === selectedId) : null;
  if (selectedId && !selected) setSelectedId(null);

  if (selected) {
    return (
      <div>
        <button type="button" onClick={() => setSelectedId(null)} className={styles.backButton}>
          ← Tilbake
        </button>
        <div className={styles.detailName}>{selected.name}</div>
        <div className={styles.chips}>
          <span className={styles.chip}>⏱ {selected.time} min</span>
          <span className={styles.chip}>👥 {selected.servings} pers</span>
          <span className={styles.chip}>{selected.cat}</span>
          {selected.tags.map((t) => (
            <span key={t} className={styles.chip}>
              {t}
            </span>
          ))}
        </div>
        {selected.imageUrl && (
          <img src={selected.imageUrl} alt={selected.name} className={styles.detailImage} />
        )}
        {selected.url && (
          <a href={selected.url} target="_blank" rel="noreferrer" className={styles.sourceLink}>
            ↗ Originaloppskrift
          </a>
        )}

        <AddToPlanCard recipe={selected} />
        <RecipeIngredients
          recipe={selected}
          freezer={freezer.status === "loaded" ? freezer.data : []}
        />

        {selected.instructions && (
          <Card style={{ marginBottom: 12 }}>
            <div className={styles.instructionsLabel}>Fremgangsmåte</div>
            <div className={styles.instructionsText}>{selected.instructions}</div>
          </Card>
        )}

        <div className={styles.detailActions}>
          <button
            type="button"
            onClick={() => setEditingRecipe(selected)}
            className={styles.editButton}
          >
            ✏️ Rediger
          </button>
          <button
            type="button"
            onClick={() => {
              void removeRecipe(selected.id);
              setSelectedId(null);
            }}
            className={styles.deleteButton}
          >
            🗑️ Slett
          </button>
        </div>

        {editingRecipe && (
          <RecipeFormModal
            initial={editingRecipe}
            onSave={(patch) => void updateRecipe(editingRecipe.id, patch)}
            onClose={() => setEditingRecipe(null)}
            items={items.data}
            findOrCreateItem={findOrCreateItem}
          />
        )}
      </div>
    );
  }

  const visible = allRecipes
    .filter((r) => filter === "Alle" || r.cat === filter)
    .filter(
      (r) =>
        !search ||
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())),
    );

  return (
    <div>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Kokebok</div>
          <div className={styles.subtitle}>🍳 {allRecipes.length} oppskrifter</div>
        </div>
        <button type="button" onClick={() => setShowQuickAdd(true)} className={styles.addButton}>
          ＋ Legg til
        </button>
      </div>

      <div className={styles.searchRow}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Søk i kokebok…"
          className={styles.searchInput}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Tøm søk"
            className={styles.clearSearchButton}
          >
            ✕
          </button>
        )}
      </div>

      <div className={styles.categoryRow}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            className={filter === c ? styles.categoryPillActive : styles.categoryPill}
          >
            {c}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {visible.length === 0 && allRecipes.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>📖</div>
            <div className={styles.emptyTitle}>Kokeboken er tom</div>
            <div className={styles.emptyText}>
              Start med en rett du lager ofte.
              <br />
              Skriv navn + ingredienser — ferdig på 15 sekunder.
            </div>
            <button
              type="button"
              onClick={() => setShowQuickAdd(true)}
              className={styles.emptyButton}
            >
              ⚡ Legg inn første oppskrift
            </button>
          </div>
        )}
        {visible.length === 0 && allRecipes.length > 0 && (
          <div className={styles.noMatch}>Ingen oppskrifter matcher søket</div>
        )}
        {visible.map((r) => (
          <Card key={r.id} onClick={() => setSelectedId(r.id)} style={{ padding: "10px 14px" }}>
            <div className={styles.listRow}>
              <span className={styles.listIcon}>🍳</span>
              <div className={styles.listInfo}>
                <div className={styles.listName}>{r.name}</div>
                <div className={styles.listMeta}>
                  ⏱ {r.time} min · 👥 {r.servings} pers · {r.cat}
                </div>
              </div>
              {r.url && <span className={styles.linkIcon}>🔗</span>}
              <span className={styles.chevron}>›</span>
            </div>
          </Card>
        ))}
      </div>

      {showQuickAdd && (
        <QuickAddRecipeModal
          onSave={(fields) => void addRecipe(fields)}
          onClose={() => setShowQuickAdd(false)}
          items={items.data}
          findOrCreateItem={findOrCreateItem}
        />
      )}
    </div>
  );
}
