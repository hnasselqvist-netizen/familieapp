import { useState } from "react";
import { Button } from "@components/Button";
import { Icon } from "@components/Icon";
import type { IconName } from "@components/icons";
import { ItemPicker } from "@components/ItemPicker";
import { RoomHeader } from "@components/RoomHeader";
import { SHOP_CATS } from "@domain/shared/constants";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import type { ShoppingItem } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import styles from "./HandlelisteScreen.module.css";

/** Én rolig Lucide-familie for kategoriene (§Kontrolltårn-review, PR #26, design-review runde 2, §5) — nærmeste gode standardikon per kategori, konsistens fremfor bokstavelig treff. */
const CAT_ICON: Record<string, IconName> = {
  "Frukt og grønt": "sprout",
  Kjøtt: "beef",
  "Fisk og sjømat": "fish",
  "Ost og meieri": "milk",
  Tørrvarer: "wheat",
  "Brød og bakst": "sandwich",
  Frysevarer: "snowflake",
  Drikke: "cup-soda",
  Rengjøring: "spray-can",
  Diverse: "package-open",
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
 * `RoomHeader`, med "Fjern fullførte" i dens `actions`-rad, og
 * fargeidentiteten er byttet til Hjem/Kjøkken-paletten (`--g-*`), samme
 * mønster som Middagsplan v1/Middagsbibliotek/Kokebok. Rollen her er
 * "utførerflate i butikk" — mest kompakt og effektiv av de tre
 * Mat-skjermene, derfor UENDRET tetthet/avstand (ingen felt fikk mer
 * luft), kun fargeidentitet.
 *
 * **Design-review runde 1** (§Kontrolltårn-review, PR #26, §7): "Fjern
 * fullførte" bruker nå den delte `Button`-atomen. Fremdriftslinjen og den
 * fullførte avhukingen bruker nå `--g-green` i stedet for kjernepalettens
 * `--color-olive`. Varerader er nå ca. 44px berøringshøyde med 15px navn
 * og 13px sekundær mengde, og kategorilabelen er 12px/600. Der et ekte
 * Lucide-ikon fantes i registeret er emoji byttet ut (✓ → `Icon
 * name="check"`, 🛍️ → `Icon name="shopping-cart"`).
 *
 * **Design-review runde 2: fullført ikonfamilie + strukturert statuslinje**
 * (§Kontrolltårn-review, PR #26, §5): `RoomHeader.description` er nå
 * `ReactNode` (§components/RoomHeader.tsx) slik at statuslinjen kan bruke
 * `check`/`clock`-ikoner + struktur i stedet for `✓`/`⏱` inni én streng.
 * `CAT_EMOJI` er erstattet med `CAT_ICON` — én rolig Lucide-familie
 * (sprout/beef/fish/milk/wheat/sandwich/snowflake/cup-soda/spray-can/
 * package-open) for kategoriene. `.addButton` (→), legg-til-ikonet (＋),
 * fjern-knappene (✕) og utvid/skjul-pilene (▴/▾) bruker nå
 * `arrow-right`/`plus`/`x`/`chevron-up`/`chevron-down`.
 *
 * **Design-review runde 3** (§Helen-review, PR #26, §12 — "Helen opplever
 * Handlelisten som svært god. Bevar dagens struktur/tetthet."): "Fjern
 * fullførte" er nå `size="compact"` (§Button.tsx), samme mønster som
 * Middagsplan/Kokebok. Avhukingen (`.checkbox`/`.checkboxDone`) er nå en
 * rund sirkel i Gangens ikon-/statusspråk i stedet for et avrundet
 * kvadrat — se `HandlelisteScreen.module.css` sin toppkommentar for
 * detaljene. Alt annet (gjennomstreking/demping for ferdige varer,
 * kategoristruktur, tetthet) er UENDRET.
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
        eyebrow="KJØKKEN"
        showDate
        title="Handleliste"
        description={
          <span className={styles.statusLine}>
            <span className={styles.statusItem}>
              <Icon name="check" size={13} />
              {done.length} fullført
            </span>
            <span className={styles.statusItem}>
              <Icon name="clock" size={13} />
              {pending.length} gjenstår
            </span>
          </span>
        }
        actions={
          done.length > 0 && (
            <Button variant="secondary" size="compact" onClick={() => void clearDone(all)}>
              <Icon name="trash-2" size={14} />
              Fjern fullførte
            </Button>
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
        <Icon name="plus" size={15} className={styles.addIcon} />
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
          <Icon name="arrow-right" size={15} />
        </button>
      </div>

      {all.length === 0 && (
        <div className={styles.empty}>
          <Icon name="shopping-cart" size={32} className={styles.emptyIcon} />
          <div className={styles.emptyText}>Listen er tom</div>
        </div>
      )}

      {categoryOrder(pending).map((cat) => {
        const catItems = pending.filter((i) => i.cat === cat);
        return (
          <div key={cat} className={styles.categoryGroup}>
            <div className={styles.categoryHeader}>
              <Icon
                name={CAT_ICON[cat] ?? "package-open"}
                size={14}
                className={styles.categoryIcon}
              />
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
                      <Icon name="x" size={14} />
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
              <Icon name={showDone ? "chevron-up" : "chevron-down"} size={12} />
              {done.length} FULLFØRT
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
                    <Icon name="check" size={12} />
                  </button>
                  <span className={styles.doneName}>{item.name}</span>
                  {item.amount && <span className={styles.itemAmount}>{item.amount}</span>}
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    aria-label={`Fjern ${item.name}`}
                    className={styles.removeButton}
                  >
                    <Icon name="x" size={14} />
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
