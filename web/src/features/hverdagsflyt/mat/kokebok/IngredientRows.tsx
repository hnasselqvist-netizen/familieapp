import type { Vare } from "@app-types/vare";
import { ItemPicker } from "@components/ItemPicker";
import { emptyIngredientRow, type IngredientRow } from "./ingredientRow";
import styles from "./IngredientRows.module.css";

const UNITS = ["stk", "g", "kg", "ml", "dl", "l", "ss", "ts", "pk", "boks", "pose", "etter behov"];

export interface IngredientRowsProps {
  rows: IngredientRow[];
  setRows: (updater: (rows: IngredientRow[]) => IngredientRow[]) => void;
  items: Vare[];
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
}

/**
 * Redigerbar ingrediensliste — portert 1:1 fra dagens `IngredientRows`
 * (index.html linje ~4076–4147). Legger automatisk til en ny tom rad når
 * siste rad sitt navnefelt fylles ut, slik at brukeren aldri trenger å
 * trykke en "legg til"-knapp for å fortsette å skrive.
 */
export function IngredientRows({ rows, setRows, items, findOrCreateItem }: IngredientRowsProps) {
  const updateRow = (id: string, fields: Partial<IngredientRow>) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...fields } : r));
      const last = next[next.length - 1];
      if (last && last.name.trim() && "name" in fields) return [...next, emptyIngredientRow()];
      return next;
    });
  };

  const moveRow = (idx: number, dir: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev];
      const to = idx + dir;
      if (to < 0 || to >= next.length) return prev;
      const a = next[idx];
      const b = next[to];
      if (!a || !b) return prev;
      next[idx] = b;
      next[to] = a;
      return next;
    });
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };

  return (
    <div>
      <div className={styles.headerRow}>
        <span>Ingrediens</span>
        <span>Mengde</span>
        <span>Enhet</span>
        <span />
      </div>
      <div className={styles.rows}>
        {rows.map((row, idx) => (
          <div key={row.id} className={styles.row}>
            <ItemPicker
              items={items}
              value={row.name}
              onChange={(val) => updateRow(row.id, { name: val, itemId: null, cat: "" })}
              onSelect={(vare) =>
                updateRow(row.id, { name: vare.name, itemId: vare.id, cat: vare.cat })
              }
              onCreate={(vare) =>
                updateRow(row.id, { name: vare.name, itemId: vare.id, cat: vare.cat })
              }
              findOrCreateItem={findOrCreateItem}
              placeholder={idx === 0 ? "f.eks. Kjøttdeig" : ""}
            />
            <input
              value={row.amount}
              onChange={(e) => updateRow(row.id, { amount: e.target.value })}
              placeholder="500"
              type="number"
              min="0"
              className={styles.amountInput}
            />
            <select
              value={row.unit}
              onChange={(e) => updateRow(row.id, { unit: e.target.value })}
              className={styles.unitSelect}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <div className={styles.rowActions}>
              <button
                type="button"
                onClick={() => moveRow(idx, -1)}
                disabled={idx === 0}
                aria-label="Flytt opp"
                className={styles.rowActionButton}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveRow(idx, 1)}
                disabled={idx === rows.length - 1}
                aria-label="Flytt ned"
                className={styles.rowActionButton}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={rows.length <= 1}
                aria-label="Fjern ingrediens"
                className={styles.rowActionButton}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRows((p) => [...p, emptyIngredientRow()])}
        className={styles.addRowButton}
      >
        ＋ Legg til ingrediens
      </button>
    </div>
  );
}
