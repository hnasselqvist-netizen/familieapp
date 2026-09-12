import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { RoomHeader } from "@components/RoomHeader";
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
 *
 * `?apne=<recipeId>` åpner detaljvisningen direkte ved mount — erstatter
 * dagens `window.__openRecipe`/`setTimeout`-bridge (index.html linje
 * ~2275–2277, ~4809) med et idiomatisk React Router-søkeparameter.
 * Middagsplan sin "📖"-snarvei (§PlanScreen.tsx) navigerer hit.
 *
 * **Visuell Kjøkken-harmonisering** (§Kontrolltårn-handoff, Issue #20,
 * "visuelt førsteutkast av resten av Kjøkkenet"): sideheaderen bruker
 * `RoomHeader`, "＋ Legg til" er `Button`, og fargeidentiteten er byttet
 * til Hjem/Kjøkken-paletten (`--g-*`), samme mønster som Middagsplan v1.
 * Listens 🍳-ikon er byttet til `Icon name="book-open"` — samme asset som
 * Middagsplans "📖 åpne oppskrift"-snarvei allerede bruker for nøyaktig
 * det samme konseptet. Øvrige emoji (⏱/👥/✏️/🗑️/🔗) er bevisst UENDRET —
 * ingen matchende asset finnes i dagens ikon-register uten å lage nye
 * (utenfor denne skiven). Rollen her er "familiens kokebok" — varm og
 * innholdsorientert; oppskriftsdetaljen (bilde, ingredienser,
 * fremgangsmåte) er UENDRET strukturert som innhold, ikke administrasjon.
 * `RecipeFormModal`/`QuickAddRecipeModal` sin interne skjemastruktur er
 * bevisst IKKE restrukturert i denne skiven — kun deres fargetokens er
 * byttet, se egne CSS-moduler.
 *
 * **Design-review runde 1: "innhold og varme"** (§Kontrolltårn-review,
 * PR #26, §6): oppskriftslisten er nå ETT samlet møbel (`.recipesCard`)
 * med innrykkede skillelinjer mellom radene i stedet for separate `Card`-
 * er per rad, chevronen er nå et ekte Lucide-ikon i stedet for et rått
 * "›"-tegn, og "Rediger"/"Slett" i detaljvisningen bruker nå den delte
 * `Button`-atomen (`secondary`/`destructive`) i stedet for egne
 * knappeklasser på `--color-clay*`. Detaljvisningens tittel er nå H1
 * (28px/600) og "Fremgangsmåte" er H2 (20px/600) — samme
 * typografihierarki som resten av Hverdagsflyt.
 *
 * **Design-review runde 2: fullført ikonfamilie + innholdsrekkefølge**
 * (§Kontrolltårn-review, PR #26, §4): ⏱/👥/🔗/✏️/🗑️/✕ er byttet til
 * `clock`/`users`/`external-link`/`pencil`/`trash-2`/`x`-ikoner nå som
 * disse assetene faktisk finnes i registeret (§components/icons.ts).
 * Fremgangsmåte-teksten er 15px/400 (var 13px). Detaljvisningen følger nå
 * eksplisitt rekkefølgen navn → metadata → bilde/kilde → ingredienser →
 * fremgangsmåte → handlinger — `AddToPlanCard` er flyttet fra FØR
 * ingrediensene til handlingsklyngen nederst, siden den selv er en
 * handling (planlegging), ikke innhold.
 */
export function RecipesScreen() {
  const { recipes, addRecipe, updateRecipe, removeRecipe } = useRecipes();
  const { items, findOrCreateItem } = useItems();
  const { freezer } = useFreezer();
  const [searchParams] = useSearchParams();

  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("apne"));
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
          <span className={styles.chip}>
            <Icon name="clock" size={12} />
            {selected.time} min
          </span>
          <span className={styles.chip}>
            <Icon name="users" size={12} />
            {selected.servings} pers
          </span>
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
            <Icon name="external-link" size={13} />
            Originaloppskrift
          </a>
        )}

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

        <AddToPlanCard recipe={selected} />

        <div className={styles.detailActions}>
          <Button
            variant="secondary"
            onClick={() => setEditingRecipe(selected)}
            className={styles.actionButton}
          >
            <Icon name="pencil" size={16} />
            Rediger
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void removeRecipe(selected.id);
              setSelectedId(null);
            }}
            className={styles.actionButton}
          >
            <Icon name="trash-2" size={16} />
            Slett
          </Button>
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
      <RoomHeader
        eyebrow="KJØKKEN"
        title="Kokebok"
        description={`${allRecipes.length} oppskrifter`}
        actions={<Button onClick={() => setShowQuickAdd(true)}>＋ Legg til</Button>}
      />

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
            <Icon name="x" size={14} />
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

      {visible.length === 0 && allRecipes.length === 0 && (
        <div className={styles.empty}>
          <Icon name="book-open" size={32} className={styles.emptyIcon} />
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
      {visible.length > 0 && (
        <div className={styles.recipesCard}>
          {visible.map((r, i) => (
            <div key={r.id}>
              <div onClick={() => setSelectedId(r.id)} className={styles.listRow}>
                <Icon name="book-open" size={18} className={styles.listIcon} />
                <div className={styles.listInfo}>
                  <div className={styles.listName}>{r.name}</div>
                  <div className={styles.listMeta}>
                    <span className={styles.listMetaItem}>
                      <Icon name="clock" size={12} />
                      {r.time} min
                    </span>
                    <span className={styles.listMetaItem}>
                      <Icon name="users" size={12} />
                      {r.servings} pers
                    </span>
                    <span>{r.cat}</span>
                  </div>
                </div>
                {r.url && <Icon name="external-link" size={13} className={styles.linkIcon} />}
                <Icon name="chevron-right" size={16} className={styles.chevron} />
              </div>
              {i < visible.length - 1 && <div className={styles.listDivider} />}
            </div>
          ))}
        </div>
      )}

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
