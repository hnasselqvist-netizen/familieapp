import { useEffect, useState } from "react";
import { backfillMealLibraryIdAcrossWeeks } from "@data/meals.repository";
import {
  createMealLibraryEntry,
  removeMealLibraryEntry,
  subscribeMealLibrary,
  transactMealLibraryEntry,
  transactMealLibraryEntryMedUtfall,
} from "@data/mealLibrary.repository";
import {
  addShoppingBaseItem as addShoppingBaseItemToEntry,
  addVariant as addVariantOnEntry,
  addVariantShoppingBaseItem as addVariantShoppingBaseItemOnEntry,
  clearShoppingBaseItemToFreeText as clearShoppingBaseItemToFreeTextOnEntry,
  removeShoppingBaseItem as removeShoppingBaseItemFromEntry,
  removeVariant as removeVariantOnEntry,
  removeVariantShoppingBaseItem as removeVariantShoppingBaseItemOnEntry,
  replaceShoppingBaseItemFromPicker as replaceShoppingBaseItemFromPickerOnEntry,
  updateEntryFields as updateEntryFieldsOnEntry,
  updateShoppingBaseItemField as updateShoppingBaseItemFieldOnEntry,
  updateVariant as updateVariantOnEntry,
  VariantvareIkkeLagret,
} from "@domain/mealLibrary/mealLibrary";
import type {
  MealVariantPatch,
  NewMealVariant,
  VariantvareUtfall,
} from "@domain/mealLibrary/mealLibrary";
import type { MealLibraryEntry } from "@app-types/shopping";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseMealLibraryResult {
  mealLibrary: Loadable<MealLibraryEntry[]>;
  addEntry: (name: string) => Promise<MealLibraryEntry>;
  removeEntry: (id: string) => Promise<void>;
  addShoppingBaseItem: (
    mealId: string,
    vare: { itemId: string; name: string; cat: string },
  ) => Promise<void>;
  updateShoppingBaseItemField: (
    mealId: string,
    itemId: string,
    field: "amount" | "unit",
    value: string,
  ) => Promise<void>;
  clearShoppingBaseItemToFreeText: (mealId: string, itemId: string, name: string) => Promise<void>;
  replaceShoppingBaseItemFromPicker: (
    mealId: string,
    itemId: string,
    vare: { id: string; name: string; cat: string },
  ) => Promise<void>;
  removeShoppingBaseItem: (mealId: string, itemId: string) => Promise<void>;
  updateEntryFields: (
    mealId: string,
    patch: Partial<Pick<MealLibraryEntry, "name" | "lettvint" | "variationTags">>,
  ) => Promise<void>;
  addVariant: (mealId: string, variant: NewMealVariant) => Promise<void>;
  updateVariant: (mealId: string, variantId: string, patch: MealVariantPatch) => Promise<void>;
  removeVariant: (mealId: string, variantId: string) => Promise<void>;
  /** Legger én vare til i en handlegrunnlag-variant, beregnet fra den ferske varianten (#20 6754247077). */
  addVariantShoppingBaseItem: (
    mealId: string,
    variantId: string,
    vare: { itemId: string; name: string; cat: string },
  ) => Promise<void>;
  /** Fjerner én vare (per rad-id) fra en handlegrunnlag-variant, beregnet fra den ferske varianten. */
  removeVariantShoppingBaseItem: (
    mealId: string,
    variantId: string,
    rowId: string,
  ) => Promise<void>;
}

/**
 * React-binding for Middagsbiblioteket. `shoppingBase`-mutasjonene
 * komponerer `transactMealLibraryEntry` (§data/mealLibrary.repository.ts)
 * med de rene motorfunksjonene (§domain/mealLibrary/mealLibrary.ts) —
 * samme mønster som `useFreezer` allerede bruker for
 * `transactFreezerItem` + domenefunksjonene der.
 *
 * `current===null` på speculativt (kaldt cache-)kall håndteres med
 * `return null` (aldri `undefined`) — se `transactMealLibraryEntry` sin
 * toppkommentar for hvorfor: en harmløs, retriable verdi som overstyres
 * av den ferske server-verdien dersom måltidet faktisk finnes.
 *
 * **Varianter eksponert som brukerfunksjon** (§Helen-review, PR #26,
 * design-review runde 3, §13): `addVariant`/`updateVariant`/
 * `removeVariant` komponerer nå de rene motorfunksjonene
 * (§domain/mealLibrary/mealLibrary.ts) med samme
 * `transactMealLibraryEntry`-mønster som `shoppingBase`-mutasjonene over
 * — motoren fantes allerede fra variantmodell-skivene (PR #18/#19), men
 * manglet frem til nå den nødvendige brukerinngangen. `addVariant`
 * genererer variant-id-en selv (`crypto.randomUUID()`), samme
 * ID-genereringsprinsipp som `addShoppingBaseItem`.
 *
 * **Omdøping reparerer legacy-planreferanser** (§Kontrolltårn-review,
 * PR #26, runde 5 — Helens reelle preview-test avdekket at runde 4s
 * additive `mealLibraryId` ikke dekket planer skrevet FØR feltet fantes):
 * `updateEntryFields` fanger opp det GAMLE navnet før selve rename-
 * transaksjonen, og kaller — kun ved en faktisk navneendring, og kun når
 * det gamle navnet var entydig i biblioteket i det øyeblikket — den
 * separate `backfillMealLibraryIdAcrossWeeks` (§data/meals.repository.ts)
 * for å koble opp allerede planlagte dager som fortsatt kun matchet på
 * navn. Se den funksjonens toppkommentar for hva den rører og hvorfor
 * flyten er delt i to separate skrivinger (entry-renamen selv, deretter
 * en best-effort bulk-reparasjon av planreferanser) i stedet for én
 * transaksjon.
 */
export function useMealLibrary(): UseMealLibraryResult {
  const familyId = useFamilyId();
  const [mealLibrary, setMealLibrary] = useState<Loadable<MealLibraryEntry[]>>(notLoaded);

  useEffect(() => {
    setMealLibrary(loading);
    const unsubscribe = subscribeMealLibrary(familyId, (data) => setMealLibrary(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const addEntry = (name: string) => createMealLibraryEntry(familyId, name);
  const removeEntry = (id: string) => removeMealLibraryEntry(familyId, id);

  const addShoppingBaseItem = async (
    mealId: string,
    vare: { itemId: string; name: string; cat: string },
  ) => {
    const rowId = crypto.randomUUID();
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? addShoppingBaseItemToEntry(current, rowId, vare) : null,
    );
  };

  const updateShoppingBaseItemField = async (
    mealId: string,
    itemId: string,
    field: "amount" | "unit",
    value: string,
  ) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? updateShoppingBaseItemFieldOnEntry(current, itemId, field, value) : null,
    );
  };

  const clearShoppingBaseItemToFreeText = async (mealId: string, itemId: string, name: string) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? clearShoppingBaseItemToFreeTextOnEntry(current, itemId, name) : null,
    );
  };

  const replaceShoppingBaseItemFromPicker = async (
    mealId: string,
    itemId: string,
    vare: { id: string; name: string; cat: string },
  ) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? replaceShoppingBaseItemFromPickerOnEntry(current, itemId, vare) : null,
    );
  };

  const removeShoppingBaseItem = async (mealId: string, itemId: string) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? removeShoppingBaseItemFromEntry(current, itemId) : null,
    );
  };

  const updateEntryFields = async (
    mealId: string,
    patch: Partial<Pick<MealLibraryEntry, "name" | "lettvint" | "variationTags">>,
  ) => {
    const currentList = mealLibrary.status === "loaded" ? mealLibrary.data : [];
    const before = currentList.find((m) => m.id === mealId);

    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? updateEntryFieldsOnEntry(current, patch) : null,
    );

    // §Kontrolltårn-review, PR #26, runde 5 — se `backfillMealLibraryIdAcrossWeeks`
    // sin toppkommentar for hvorfor og hva den rører. Kjøres KUN ved en faktisk
    // navneendring, og KUN når det gamle navnet var entydig for akkurat dette
    // konseptet i det øyeblikket omdøpingen skjedde — ved navnekollisjon
    // (to biblioteksmiddager med samme navn) er det ikke trygt å avgjøre hvilket
    // konsept en legacy-referanse mente, så vi rører ingenting fremfor å gjette.
    if (
      before &&
      patch.name !== undefined &&
      before.name.toLowerCase() !== patch.name.toLowerCase()
    ) {
      const oldNameLower = before.name.toLowerCase();
      const nameWasUnique =
        currentList.filter((m) => m.name.toLowerCase() === oldNameLower).length === 1;
      if (nameWasUnique) {
        await backfillMealLibraryIdAcrossWeeks(familyId, before.name, mealId);
      }
    }
  };

  const addVariant = async (mealId: string, variant: NewMealVariant) => {
    const variantId = crypto.randomUUID();
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? addVariantOnEntry(current, variantId, variant) : null,
    );
  };

  const updateVariant = async (mealId: string, variantId: string, patch: MealVariantPatch) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? updateVariantOnEntry(current, variantId, patch) : null,
    );
  };

  const removeVariant = async (mealId: string, variantId: string) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? removeVariantOnEntry(current, variantId) : null,
    );
  };

  // Varer i en variant endres fra den ferske varianten (#20 6754247077). Stopper
  // domenet endringen, skrives ingenting, og utfallet kastes som
  // `VariantvareIkkeLagret` så skjermen kan vise det og beholde utkastet —
  // unntatt en rad som allerede er fjernet, som er det brukeren ønsket.
  const endreVariantvare = async (
    mealId: string,
    beregn: Parameters<typeof transactMealLibraryEntryMedUtfall<VariantvareUtfall>>[2],
  ) => {
    const utfall = await transactMealLibraryEntryMedUtfall<VariantvareUtfall>(
      familyId,
      mealId,
      beregn,
      "middagMangler",
    );
    if (utfall && utfall !== "radMangler") throw new VariantvareIkkeLagret(utfall);
  };

  const addVariantShoppingBaseItem = async (
    mealId: string,
    variantId: string,
    vare: { itemId: string; name: string; cat: string },
  ) => {
    const rowId = crypto.randomUUID();
    await endreVariantvare(mealId, (current) =>
      addVariantShoppingBaseItemOnEntry(current, variantId, rowId, vare),
    );
  };

  const removeVariantShoppingBaseItem = async (
    mealId: string,
    variantId: string,
    rowId: string,
  ) => {
    await endreVariantvare(mealId, (current) =>
      removeVariantShoppingBaseItemOnEntry(current, variantId, rowId),
    );
  };

  return {
    mealLibrary,
    addEntry,
    removeEntry,
    addShoppingBaseItem,
    updateShoppingBaseItemField,
    clearShoppingBaseItemToFreeText,
    replaceShoppingBaseItemFromPicker,
    removeShoppingBaseItem,
    updateEntryFields,
    addVariant,
    updateVariant,
    removeVariant,
    addVariantShoppingBaseItem,
    removeVariantShoppingBaseItem,
  };
}
