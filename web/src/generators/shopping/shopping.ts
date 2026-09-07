/**
 * Handlelistegeneratoren — kan lese `src/domain/**` (§eslint.config.js sin
 * `import/no-restricted-paths`), som her betyr `getMealRecipes`/`isEvent`
 * (Middagsplan-motoren, PR #4) og `getIngredients` (Kokebok-motoren, PR #3).
 * Ingen av funksjonene under kaller selv Firebase — de tar allerede innlastet
 * data som parametre, akkurat som `resolveMealShoppingItems` allerede gjør
 * i dagens `index.html`.
 *
 * Portert 1:1 fra dagens index.html:
 *  - `resolveMealShoppingItems` — linje ~3927–3974 (allerede en "REN
 *    FUNKSJON" i dagens kode, karakterisert i PR #3 sin
 *    pre-implementeringskartlegging).
 *  - `lookupCategoryFromHistory`/`buildShoppingItems`/`mergeShoppingItems` —
 *    `ShoppingGenerator` sin `lookupCat`/`buildIngredients`
 *    (linje ~2765–2803).
 *  - `toShoppingListEntry` — `ShoppingGenerator.addToList` sitt
 *    rad-format (linje ~2838–2844).
 *  - `mergeIntoShoppingList` — `MatScreen.onAddToList` (linje ~3847–3862).
 *
 * Bevisst UTENFOR denne skiven (skjerm-/utvalgs-lim, Fase 2):
 * `ShoppingGenerator` sin `candidates`-bygging (hvilke dager som VISES som
 * avkrysningsbare kandidater — "kommende, ikke passerte, ikke hendelser").
 * Dette er reelt sett en render-tids-/"i dag akkurat nå"-avhengig
 * utvalgsliste for UI-en, ikke en datakorrekthets-bekymring: en
 * dagverdi fra en passert dag resolver fortsatt til korrekte ingredienser
 * her — den blir bare ikke FORHÅNDSVIST som avkrysset i dagens skjerm.
 * Funksjonene under tar derfor en allerede valgt liste med dagverdier inn,
 * uavhengig av uke/dato/checkbox-tilstand.
 *
 * Id-tildeling (`id`/`done` på et handlelistelement) er bevisst IKKE en
 * del av generatorens output — samme prinsipp som Fryserens
 * id-generering flyttet til kalleren (§domain/freezer/freezer.ts):
 * gjennomgangsflaten (Fase 2) trenger stabile id-er for redigering/fjerning,
 * men det er en skjerm-bekymring, ikke generatorens.
 */
import { getIngredients } from "@domain/recipes/recipes";
import { getMealRecipes, isEvent } from "@domain/meals/meals";
import type { Recipe } from "@app-types/recipe";
import type { MealValue } from "@app-types/meal";
import type {
  EnrichedShoppingItem,
  ItemHistoryEntry,
  MealLibraryEntry,
  MergedShoppingItem,
  ResolvedShoppingIngredient,
  ShoppingListEntry,
  Staples,
} from "@app-types/shopping";

/**
 * Resolverer handlegrunnlaget for ÉN dagverdi. Prioritet (§index.html
 * kommentar, linje ~3903–3926, bevart uendret):
 * 1. Hendelse eller tom verdi → [].
 * 2. Eksplisitt meal-objekt MED konkret `recipeId` → KUN id-oppslag. Finnes
 *    ikke id-en (f.eks. slettet oppskrift) → 0 varer for DENNE referansen,
 *    ALDRI navnematch her.
 * 3. Eksplisitt meal-objekt med `recipeId:null` → KUN
 *    `mealLibrary.shoppingBase` for samme navn. Ingen treff → [], ALDRI
 *    fallback til en navnelik Kokebok-oppskrift.
 * 4. Legacy raa streng → bevarer den gamle, opprinnelige
 *    navnefallback-oppførselen: recipe-navnematch først, deretter
 *    `mealLibrary.shoppingBase`, ellers [].
 * 5. Meny → hver oppskrift-referanse håndteres uavhengig med reglene 2/3.
 */
export function resolveMealShoppingItems(
  mealVal: MealValue | null | undefined,
  recipes: Recipe[],
  mealLibrary: MealLibraryEntry[],
): ResolvedShoppingIngredient[] {
  if (!mealVal || isEvent(mealVal)) return [];
  const items: ResolvedShoppingIngredient[] = [];

  if (typeof mealVal === "string") {
    const recipe = recipes.find((r) => r.name.toLowerCase() === mealVal.toLowerCase());
    if (recipe) {
      getIngredients(recipe).forEach((ing) => items.push({ ...ing, fromRecipe: recipe.name }));
      return items;
    }
    const libMeal = (mealLibrary || []).find((m) => m.name.toLowerCase() === mealVal.toLowerCase());
    if (libMeal?.shoppingBase && libMeal.shoppingBase.length > 0) {
      libMeal.shoppingBase.forEach((vare) =>
        items.push({
          itemId: vare.itemId || null,
          name: vare.name,
          amount: vare.amount || "",
          unit: vare.unit || "",
          cat: vare.cat || "Diverse",
          fromRecipe: libMeal.name,
        }),
      );
    }
    return items;
  }

  getMealRecipes(mealVal).forEach((recRef) => {
    if (!recRef?.name) return;
    if (recRef.recipeId) {
      const recipe = recipes.find((r) => r.id === recRef.recipeId);
      if (recipe) {
        getIngredients(recipe).forEach((ing) => items.push({ ...ing, fromRecipe: recipe.name }));
      }
      return;
    }
    const libMeal = (mealLibrary || []).find(
      (m) => m.name.toLowerCase() === recRef.name.toLowerCase(),
    );
    if (libMeal?.shoppingBase && libMeal.shoppingBase.length > 0) {
      libMeal.shoppingBase.forEach((vare) =>
        items.push({
          itemId: vare.itemId || null,
          name: vare.name,
          amount: vare.amount || "",
          unit: vare.unit || "",
          cat: vare.cat || "Diverse",
          fromRecipe: libMeal.name,
        }),
      );
    }
  });
  return items;
}

/** Slår opp kategori fra varehistorikken — første treff (ikke sist-brukt) vinner, samme som i dag. */
export function lookupCategoryFromHistory(name: string, itemHistory: ItemHistoryEntry[]): string {
  const h = (itemHistory || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.cat || "Diverse";
}

/**
 * Bygger den flate, ennå ikke sammenslåtte, berikede varelisten for et
 * sett med allerede VALGTE dagverdier (utvalget selv — hvilke dager som
 * ble krysset av — er skjermens ansvar, ikke generatorens). Speiler
 * `ShoppingGenerator.buildIngredients()` sin per-ingrediens-berikelse
 * (linje ~2773–2784) 1:1.
 */
export function buildShoppingItems(
  mealValues: (MealValue | null | undefined)[],
  context: {
    recipes: Recipe[];
    mealLibrary: MealLibraryEntry[];
    itemHistory: ItemHistoryEntry[];
    staples: Staples;
  },
): EnrichedShoppingItem[] {
  const items: EnrichedShoppingItem[] = [];
  mealValues.forEach((mealVal) => {
    resolveMealShoppingItems(mealVal, context.recipes, context.mealLibrary).forEach((ing) => {
      if (!ing.name.trim()) return;
      const resolvedCat =
        ing.cat && ing.cat !== "Diverse"
          ? ing.cat
          : lookupCategoryFromHistory(ing.name, context.itemHistory);
      const isStaple = !!context.staples[ing.name.toLowerCase()];
      items.push({
        itemId: ing.itemId || null,
        name: ing.name.trim(),
        amount: ing.amount || "",
        unit: ing.unit || "",
        cat: resolvedCat,
        fromRecipe: ing.fromRecipe,
        isStaple,
      });
    });
  });
  return items;
}

/**
 * Slår sammen like varer: samme navn + samme enhet (case-insensitivt).
 * Speiler `buildIngredients()` sin merge-logikk (linje ~2786–2803) 1:1,
 * MINUS `id`/`done` (se filens toppkommentar).
 */
export function mergeShoppingItems(items: EnrichedShoppingItem[]): MergedShoppingItem[] {
  const merged: MergedShoppingItem[] = [];
  items.forEach((item) => {
    const key = `${item.name.toLowerCase()}__${(item.unit || "").toLowerCase()}`;
    const existing = merged.find((m) => m.key === key);
    if (existing) {
      const a = parseFloat(existing.amount) || 0;
      const b = parseFloat(item.amount) || 0;
      if (a > 0 && b > 0) existing.amount = String(Math.round((a + b) * 100) / 100);
      existing.fromRecipes = [...new Set([...existing.fromRecipes, item.fromRecipe])];
      existing.isStaple = existing.isStaple && item.isStaple;
      if (!existing.itemId && item.itemId) existing.itemId = item.itemId;
    } else {
      merged.push({
        key,
        itemId: item.itemId || null,
        name: item.name,
        amount: item.amount,
        unit: item.unit,
        cat: item.cat,
        fromRecipes: [item.fromRecipe],
        isStaple: item.isStaple,
      });
    }
  });
  return merged;
}

/**
 * Former ett gjennomgått element til handlelistens lagrede form. Speiler
 * `ShoppingGenerator.addToList()` sin rad-bygging (linje ~2838–2844) 1:1,
 * inkludert kvirken at mengde+enhet slås sammen til ÉN streng her (ulikt
 * `MergedShoppingItem`, som holder dem separat) — kalleren har allerede
 * anvendt eventuelle brukerredigeringer FØR denne kalles; funksjonen selv
 * kjenner ikke til redigeringstilstand.
 */
export function toShoppingListEntry(item: {
  itemId: string | null;
  name: string;
  amount: string;
  unit: string;
  cat: string;
}): ShoppingListEntry {
  const amount =
    item.amount && item.unit ? `${item.amount} ${item.unit}`.trim() : item.amount || "";
  return { itemId: item.itemId, name: item.name, amount, cat: item.cat, done: false };
}

/**
 * Slår sammen nye handlelisteoppføringer inn i en eksisterende liste.
 * Speiler `MatScreen.onAddToList` (linje ~3847–3862) 1:1, MED VILJE
 * uendret selv om mønsteret avviker fra `mergeShoppingItems`:
 *  - matcher KUN på navn (ikke navn+enhet som over) — kan i teorien
 *    summere ulike enheter sammen.
 *  - matcher kun mot elementer som IKKE er `done` — et allerede fullført
 *    element med samme navn gjenbrukes aldri, en ny duplikatlinje legges
 *    alltid til i stedet.
 * Begge er kjente, dokumenterte inkonsistenser (§PR #3 sin
 * kode-sannhet-avstemming) — IKKE rettet her, siden Fase 1 er teknisk
 * migrering, ikke atferdsendring.
 *
 * `newEntries` har allerede sin `id` — kalleren tildeler den (samme
 * prinsipp som resten av denne filen: generator-/motorlaget genererer
 * aldri id-er selv, se filens toppkommentar).
 */
export function mergeIntoShoppingList(
  existing: (ShoppingListEntry & { id: string })[],
  newEntries: (ShoppingListEntry & { id: string })[],
): (ShoppingListEntry & { id: string })[] {
  const list = [...existing];
  newEntries.forEach((entry) => {
    const existingIdx = list.findIndex(
      (e) => e.name.toLowerCase() === entry.name.toLowerCase() && !e.done,
    );
    if (existingIdx >= 0) {
      const current = list[existingIdx];
      if (!current) return;
      const a = parseFloat(current.amount) || 0;
      const b = parseFloat(entry.amount) || 0;
      if (a > 0 && b > 0) {
        list[existingIdx] = { ...current, amount: String(Math.round((a + b) * 100) / 100) };
      }
    } else {
      list.push(entry);
    }
  });
  return list;
}
