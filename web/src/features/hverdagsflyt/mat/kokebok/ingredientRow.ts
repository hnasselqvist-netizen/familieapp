export interface IngredientRow {
  id: string;
  name: string;
  amount: string;
  unit: string;
  itemId: string | null;
  cat: string;
}

export function emptyIngredientRow(): IngredientRow {
  return { id: crypto.randomUUID(), name: "", amount: "", unit: "stk", itemId: null, cat: "" };
}
