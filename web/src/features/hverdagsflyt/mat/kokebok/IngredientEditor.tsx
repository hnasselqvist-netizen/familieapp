import type { Vare } from "@app-types/vare";
import { IngredientRows } from "./IngredientRows";
import { emptyIngredientRow, type IngredientRow } from "./ingredientRow";
import styles from "./IngredientEditor.module.css";

export interface IngredientGroupDraft {
  id: string;
  name: string;
  rows: IngredientRow[];
}

export interface IngredientEditorProps {
  rows: IngredientRow[];
  setRows: (updater: (rows: IngredientRow[]) => IngredientRow[]) => void;
  groups: IngredientGroupDraft[];
  setGroups: (updater: (groups: IngredientGroupDraft[]) => IngredientGroupDraft[]) => void;
  items: Vare[];
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
}

/**
 * Bytter mellom flat ingrediensliste og navngitte grupper — portert 1:1
 * fra `AddRecipeModal`/`RecipeForm` sin delte gruppe-håndtering (index.html
 * linje ~4208–4223 og ~4531–4540, identisk i begge). Tom gruppeliste
 * betyr "ingen grupper" (flat modus), akkurat som i dag.
 */
export function IngredientEditor({
  rows,
  setRows,
  groups,
  setGroups,
  items,
  findOrCreateItem,
}: IngredientEditorProps) {
  const addGroup = () => {
    if (groups.length === 0) {
      const firstRows = rows.length > 0 && rows[0]?.name.trim() ? rows : [emptyIngredientRow()];
      setGroups(() => [{ id: crypto.randomUUID(), name: "Ingredienser", rows: firstRows }]);
      setRows(() => [emptyIngredientRow()]);
    } else {
      setGroups((p) => [
        ...p,
        { id: crypto.randomUUID(), name: "Ny gruppe", rows: [emptyIngredientRow()] },
      ]);
    }
  };

  const updateGroupName = (gid: string, name: string) => {
    setGroups((p) => p.map((g) => (g.id === gid ? { ...g, name } : g)));
  };

  const removeGroup = (gid: string) => {
    setGroups((p) => p.filter((g) => g.id !== gid));
  };

  const setGroupRows = (gid: string, updater: (rows: IngredientRow[]) => IngredientRow[]) => {
    setGroups((p) => p.map((g) => (g.id === gid ? { ...g, rows: updater(g.rows) } : g)));
  };

  return (
    <div>
      {groups.length === 0 ? (
        <IngredientRows
          rows={rows}
          setRows={setRows}
          items={items}
          findOrCreateItem={findOrCreateItem}
        />
      ) : (
        <div className={styles.groups}>
          {groups.map((g) => (
            <div key={g.id} className={styles.group}>
              <div className={styles.groupHeader}>
                <input
                  value={g.name}
                  onChange={(e) => updateGroupName(g.id, e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className={styles.groupNameInput}
                />
                {groups.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeGroup(g.id)}
                    aria-label={`Fjern gruppen ${g.name}`}
                    className={styles.removeGroupButton}
                  >
                    ✕
                  </button>
                )}
              </div>
              <IngredientRows
                rows={g.rows}
                setRows={(updater) => setGroupRows(g.id, updater)}
                items={items}
                findOrCreateItem={findOrCreateItem}
              />
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={addGroup} className={styles.addGroupButton}>
        ＋ Legg til gruppe
      </button>
    </div>
  );
}
