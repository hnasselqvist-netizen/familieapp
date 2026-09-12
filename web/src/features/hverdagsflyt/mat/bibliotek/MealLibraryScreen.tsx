import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { ItemPicker } from "@components/ItemPicker";
import { Modal } from "@components/Modal";
import { RoomHeader } from "@components/RoomHeader";
import { useItems } from "@hooks/useItems";
import { useMealLibrary } from "@hooks/useMealLibrary";
import type { ShoppingBaseItem } from "@app-types/shopping";
import styles from "./MealLibraryScreen.module.css";

const SHOP_UNITS = [
  "stk",
  "g",
  "kg",
  "ml",
  "dl",
  "l",
  "ss",
  "ts",
  "pk",
  "boks",
  "pose",
  "etter behov",
];

/**
 * Middagsbibliotek — tredje Fase 2-skjerm migrert fra index.html
 * (`MealLibraryScreen`, linje ~3090–3282). Funksjonell paritet mot
 * dagens skjerm: rolig administrasjon av familiens faste repertoar, med
 * et enkelt handlegrunnlag (`shoppingBase`) per middag. Ingen ny
 * produktfunksjonalitet — datalaget (`mealLibrary.repository.ts`,
 * `domain/mealLibrary/mealLibrary.ts`) var allerede fullt migrert i
 * PR #7, inkludert den transaksjons-abort-fellen som ble funnet der.
 *
 * **Visuell Kjøkken-harmonisering** (§Kontrolltårn-handoff, Issue #20,
 * "visuelt førsteutkast av resten av Kjøkkenet"): sideheaderen bruker nå
 * `RoomHeader`, "Legg til"-knappen er `Button` (`variant="primary"`), og
 * fargeidentiteten er byttet fra den nøytrale kjernepaletten til
 * Hjem/Kjøkken-paletten (`--g-*`), samme mønster som Middagsplan v1.
 * Rollen her er "familiens repertoar" — oversiktlig og lett å forvalte,
 * derfor UENDRET listestruktur/tetthet, kun fargeidentitet og delte
 * atomer der de faktisk passer. Ingen domenelogikk, datamodell eller
 * produktflyt er endret.
 */
export function MealLibraryScreen() {
  const {
    mealLibrary,
    addEntry,
    removeEntry,
    addShoppingBaseItem,
    updateShoppingBaseItemField,
    clearShoppingBaseItemToFreeText,
    replaceShoppingBaseItemFromPicker,
    removeShoppingBaseItem,
    updateEntryFields,
  } = useMealLibrary();
  const { items, findOrCreateItem } = useItems();

  const [name, setName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [openMealId, setOpenMealId] = useState<string | null>(null);
  const [newVareName, setNewVareName] = useState("");

  if (mealLibrary.status !== "loaded" || items.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const entries = mealLibrary.data;
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name, "no"));
  const deleteTarget = deleteId ? entries.find((m) => m.id === deleteId) : null;
  const openMeal = openMealId ? entries.find((m) => m.id === openMealId) : null;

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await addEntry(trimmed);
    setName("");
  };

  const remove = async (id: string) => {
    await removeEntry(id);
    setDeleteId(null);
  };

  return (
    <div>
      <RoomHeader
        eyebrow="KJØKKEN"
        title="Middagsbibliotek"
        description={`Familiens faste repertoar — ${sorted.length} middager.`}
      />

      <Card style={{ marginBottom: 20, padding: "12px 14px" }}>
        <div className={styles.formLabel}>Legg til middag</div>
        <div className={styles.addRow}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="f.eks. Kyllingsuppe"
            autoComplete="off"
            className={styles.nameInput}
          />
          <Button onClick={() => void add()} disabled={!name.trim()}>
            Legg til
          </Button>
        </div>
      </Card>

      <div className={styles.list}>
        {sorted.map((m) => (
          <div key={m.id} onClick={() => setOpenMealId(m.id)} className={styles.listRow}>
            <span className={styles.listName}>{m.name}</span>
            {m.shoppingBase && m.shoppingBase.length > 0 && (
              <span className={styles.listCount}>{m.shoppingBase.length} varer</span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteId(m.id);
              }}
              aria-label={`Fjern ${m.name}`}
              className={styles.removeButton}
            >
              ✕
            </button>
          </div>
        ))}
        {sorted.length === 0 && (
          <div className={styles.empty}>Ingen middager i biblioteket ennå.</div>
        )}
      </div>

      {deleteId && (
        <Modal title="Slette middag?" onClose={() => setDeleteId(null)}>
          <div className={styles.confirmText}>
            {deleteTarget && `«${deleteTarget.name}»`} fjernes fra biblioteket. Ukeplaner som
            allerede bruker denne middagen påvirkes ikke.
          </div>
          <div className={styles.confirmActions}>
            <button type="button" onClick={() => setDeleteId(null)} className={styles.cancelButton}>
              Avbryt
            </button>
            <button
              type="button"
              onClick={() => void remove(deleteId)}
              className={styles.deleteButton}
            >
              Slett
            </button>
          </div>
        </Modal>
      )}

      {openMeal && (
        <Modal
          title={openMeal.name}
          onClose={() => {
            setOpenMealId(null);
            setNewVareName("");
          }}
        >
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={openMeal.lettvint ?? false}
              onChange={(e) => void updateEntryFields(openMeal.id, { lettvint: e.target.checked })}
            />
            🍃 Lettvint middag
          </label>
          <div className={styles.formLabel}>
            Variasjonstagger <span className={styles.optional}>(valgfritt)</span>
          </div>
          <input
            value={(openMeal.variationTags ?? []).join(", ")}
            onChange={(e) =>
              void updateEntryFields(openMeal.id, {
                variationTags: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            autoComplete="off"
            placeholder="fisk, pasta, pizza…"
            className={styles.variationTagsInput}
          />
          <div className={styles.fieldHint}>
            Brukes KUN av Førsteutkast for å unngå at like middager havner rett etter hverandre.
          </div>

          <div className={styles.formLabel}>Handlegrunnlag</div>
          <div className={styles.vareList}>
            {(openMeal.shoppingBase ?? []).map((vare: ShoppingBaseItem) => (
              <div key={vare.id} className={styles.vareRow}>
                <div className={styles.varePicker}>
                  <ItemPicker
                    items={items.data}
                    value={vare.name}
                    onChange={(val) =>
                      void clearShoppingBaseItemToFreeText(openMeal.id, vare.id, val)
                    }
                    onSelect={(nyVare) =>
                      void replaceShoppingBaseItemFromPicker(openMeal.id, vare.id, nyVare)
                    }
                    onCreate={(nyVare) =>
                      void replaceShoppingBaseItemFromPicker(openMeal.id, vare.id, nyVare)
                    }
                    findOrCreateItem={findOrCreateItem}
                  />
                </div>
                <input
                  value={vare.amount}
                  onChange={(e) =>
                    void updateShoppingBaseItemField(openMeal.id, vare.id, "amount", e.target.value)
                  }
                  placeholder="mengde"
                  className={styles.vareAmount}
                />
                <select
                  value={vare.unit || ""}
                  onChange={(e) =>
                    void updateShoppingBaseItemField(openMeal.id, vare.id, "unit", e.target.value)
                  }
                  className={styles.vareUnit}
                >
                  <option value="">enhet</option>
                  {SHOP_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void removeShoppingBaseItem(openMeal.id, vare.id)}
                  aria-label={`Fjern ${vare.name} fra handlegrunnlaget`}
                  className={styles.removeButton}
                >
                  ✕
                </button>
              </div>
            ))}
            {(!openMeal.shoppingBase || openMeal.shoppingBase.length === 0) && (
              <div className={styles.emptyVare}>Ingen varer registrert ennå.</div>
            )}
          </div>
          <div className={styles.newVareRow}>
            <ItemPicker
              items={items.data}
              value={newVareName}
              onChange={setNewVareName}
              onSelect={(vare) => {
                void addShoppingBaseItem(openMeal.id, {
                  itemId: vare.id,
                  name: vare.name,
                  cat: vare.cat,
                });
                setNewVareName("");
              }}
              onCreate={(vare) => {
                void addShoppingBaseItem(openMeal.id, {
                  itemId: vare.id,
                  name: vare.name,
                  cat: vare.cat,
                });
                setNewVareName("");
              }}
              findOrCreateItem={findOrCreateItem}
              placeholder="Legg til vare…"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
