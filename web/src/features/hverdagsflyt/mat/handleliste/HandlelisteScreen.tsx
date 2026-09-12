import { useState } from "react";
import { ItemPicker } from "@components/ItemPicker";
import { RoomHeader } from "@components/RoomHeader";
import { SHOP_CATS } from "@domain/shared/constants";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import type { ShoppingItem } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import styles from "./HandlelisteScreen.module.css";

const CAT_EMOJI: Record<string, string> = {
  "Frukt og grønt": "🥦",
  Kjøtt: "🥩",
  "Fisk og sjømat": "🐟",
  "Ost og meieri": "🧀",
  Tørrvarer: "🌾",
  "Brød og bakst": "🍞",
  Frysevarer: "❄️",
  Drikke: "🧃",
  Rengjøring: "🧹",
  Diverse: "📦",
};

/** Grupperingsrekkefølgen skal følge FØRSTE gang hver kategori dukker opp blant de aktive postene — ikke alfabetisk. Speiler dagens `[...new Set(...)]` (index.html linje ~4912). */
function categoryOrder(items: ShoppingItem[]): string[] {
  return [...new Set(items.map((i) => i.cat))];
}

/**
 * Handleliste — andre Fase 2-skjerm migrert fra index.html
 * (`ShoppingScreen`, linje ~4902–5059). Funksjonell paritet mot dagens
 * skjerm: hele datalaget (`shopping.repository.ts`) var allerede fullt
 * migrert med målrettede per-post-operasjoner (PR #6), inkludert
 * `clearDoneShoppingItems` sin stale-read-race-fiks — denne skjermen
 * legger ikke til ny skrivelogikk, kun UI over de eksisterende
 * repository-funksjonene.
 *
 * Generatorens "legg til flere varer samtidig"-flyt (`onAddToList`) er
 * fortsatt bevisst utenfor (§data/shopping.repository.ts sin
 * toppkommentar) — krever en egen batch-skrivestrategi.
 *
 * **Visuell Kjøkken-harmonisering** (§Kontrolltårn-handoff, Issue #20,
 * "visuelt førsteutkast av resten av Kjøkkenet"): sideheaderen bruker nå
 * `RoomHeader`, med "🗑️ Fjern fullførte" i dens `actions`-rad, og
 * fargeidentiteten er byttet til Hjem/Kjøkken-paletten (`--g-*`), samme
 * mønster som Middagsplan v1/Middagsbibliotek/Kokebok. Rollen her er
 * "utførerflate i butikk" — mest kompakt og effektiv av de tre
 * Mat-skjermene, derfor UENDRET tetthet/avstand (ingen felt fikk mer
 * luft), kun fargeidentitet. `.addButton` (pil-ikonet i legg-til-raden)
 * og `CAT_EMOJI`/kategori- og handlingsemoji (🥦🥩🐟🧀🌾🍞❄️🧃🧹📦, ⏱, 🛍️,
 * ✕, ✓) er bevisst IKKE byttet til `Button`/`Icon` — ingen matchende
 * ikonasset finnes i dagens register for disse konseptene uten å lage
 * nye (utenfor denne skiven, rapportert som observasjon i PR-en).
 */
export function HandlelisteScreen() {
  const { shopping, addItem, toggleDone, updateField, removeItem, clearDone } = useShoppingList();
  const { items, findOrCreateItem } = useItems();

  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [selectedVare, setSelectedVare] = useState<Vare | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (shopping.status !== "loaded" || items.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const all = shopping.data;
  const pending = all.filter((i) => !i.done);
  const done = all.filter((i) => i.done);

  const onNameChange = (name: string) => {
    setNewName(name);
    setSelectedVare(null);
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    const vare = await findOrCreateItem(name, selectedVare?.cat ?? "Diverse");
    if (!vare) return;
    await addItem({
      itemId: vare.id,
      name: vare.name,
      amount: newAmount.trim(),
      cat: vare.cat,
      done: false,
    });
    setNewName("");
    setNewAmount("");
    setSelectedVare(null);
  };

  const toggle = (id: string) => {
    void toggleDone(id);
    if (editingId === id) setEditingId(null);
  };

  const remove = (id: string) => {
    void removeItem(id);
    if (editingId === id) setEditingId(null);
  };

  return (
    <div>
      <RoomHeader
        title="Handleliste"
        description={`✓ ${done.length} fullført · ⏱ ${pending.length} gjenstår`}
        actions={
          done.length > 0 && (
            <button
              type="button"
              onClick={() => void clearDone(all)}
              className={styles.clearButton}
            >
              🗑️ Fjern fullførte
            </button>
          )
        }
      />

      {all.length > 0 && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round((done.length / all.length) * 100)}%` }}
            />
          </div>
          <div className={styles.progressLabel}>
            {Math.round((done.length / all.length) * 100)}% ferdig
          </div>
        </div>
      )}

      <div className={styles.addRow}>
        <span className={styles.addIcon}>＋</span>
        <div className={styles.addPicker}>
          <ItemPicker
            items={items.data}
            value={newName}
            onChange={onNameChange}
            onSelect={(vare) => {
              setNewName(vare.name);
              setSelectedVare(vare);
            }}
            onCreate={(vare) => {
              setNewName(vare.name);
              setSelectedVare(vare);
            }}
            findOrCreateItem={findOrCreateItem}
            placeholder="Hva trenger du?"
          />
        </div>
        <input
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          autoComplete="off"
          placeholder="Mengde"
          className={styles.addAmount}
        />
        <button
          type="button"
          onClick={() => void add()}
          aria-label="Legg til"
          className={styles.addButton}
        >
          →
        </button>
      </div>

      {all.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🛍️</div>
          <div className={styles.emptyText}>Listen er tom</div>
        </div>
      )}

      {categoryOrder(pending).map((cat) => {
        const catItems = pending.filter((i) => i.cat === cat);
        return (
          <div key={cat} className={styles.categoryGroup}>
            <div className={styles.categoryHeader}>
              <span>{CAT_EMOJI[cat] ?? "📦"}</span>
              <span className={styles.categoryName}>{cat}</span>
              <div className={styles.categoryLine} />
              <span className={styles.categoryCount}>{catItems.length}</span>
            </div>
            {catItems.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <div key={item.id} className={styles.itemWrap}>
                  <div
                    onClick={() => setEditingId(isEditing ? null : item.id)}
                    className={styles.itemRow}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(item.id);
                      }}
                      aria-label={`Merk ${item.name} som fullført`}
                      className={styles.checkbox}
                    />
                    <span className={styles.itemName}>{item.name}</span>
                    {item.amount && !isEditing && (
                      <span className={styles.itemAmount}>{item.amount}</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(item.id);
                      }}
                      aria-label={`Fjern ${item.name}`}
                      className={styles.removeButton}
                    >
                      ✕
                    </button>
                  </div>
                  {isEditing && (
                    <div className={styles.editRow}>
                      <input
                        value={item.name}
                        onChange={(e) => void updateField(item.id, "name", e.target.value)}
                        autoComplete="off"
                        className={styles.editName}
                      />
                      <div className={styles.editFields}>
                        <input
                          value={item.amount}
                          onChange={(e) => void updateField(item.id, "amount", e.target.value)}
                          placeholder="Mengde"
                          autoComplete="off"
                          className={styles.editAmount}
                        />
                        <select
                          value={item.cat}
                          onChange={(e) => void updateField(item.id, "cat", e.target.value)}
                          className={styles.editCat}
                        >
                          {SHOP_CATS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {done.length > 0 && (
        <div className={styles.doneSection}>
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            className={styles.doneToggle}
          >
            <div className={styles.categoryLine} />
            <span className={styles.doneToggleLabel}>
              {showDone ? "▴" : "▾"} {done.length} FULLFØRT
            </span>
            <div className={styles.categoryLine} />
          </button>
          {showDone && (
            <div className={styles.doneList}>
              {done.map((item) => (
                <div key={item.id} className={styles.doneRow}>
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    aria-label={`Merk ${item.name} som ikke fullført`}
                    className={styles.checkboxDone}
                  >
                    ✓
                  </button>
                  <span className={styles.doneName}>{item.name}</span>
                  {item.amount && <span className={styles.itemAmount}>{item.amount}</span>}
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    aria-label={`Fjern ${item.name}`}
                    className={styles.removeButton}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
