import { useState } from "react";
import { SHOP_CATS } from "@domain/shared/constants";
import type { Vare } from "@app-types/vare";
import styles from "./ItemPicker.module.css";

export interface ItemPickerProps {
  items: Vare[];
  value: string;
  onChange: (name: string) => void;
  onSelect: (vare: Vare) => void;
  onCreate: (vare: Vare) => void;
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
  placeholder?: string;
}

/**
 * Felles, gjenbrukbar vare-søker/-velger — portert 1:1 fra dagens
 * `ItemPicker` (index.html, "v-mat-varebase-1.1"). Viser forslag fra den
 * felles varebasen mens brukeren skriver, og tilbyr "Opprett <navn>" når
 * ingen eksakt treff finnes.
 */
export function ItemPicker({
  items,
  value,
  onChange,
  onSelect,
  onCreate,
  findOrCreateItem,
  placeholder,
}: ItemPickerProps) {
  const [focused, setFocused] = useState(false);
  const [pendingNewName, setPendingNewName] = useState<string | null>(null);

  const trimmedValue = value.trim();
  const matches =
    trimmedValue.length >= 1
      ? items.filter((i) => i.name.toLowerCase().includes(trimmedValue.toLowerCase())).slice(0, 6)
      : [];
  const exactMatch = items.some((i) => i.name.toLowerCase() === trimmedValue.toLowerCase());
  const showCreateOption = trimmedValue.length >= 2 && !exactMatch;

  const selectVare = (vare: Vare) => {
    onChange(vare.name);
    onSelect(vare);
    setFocused(false);
  };

  const completeCreate = (cat: string) => {
    if (!pendingNewName) return;
    void findOrCreateItem(pendingNewName, cat).then((vare) => {
      if (!vare) return; // Skriving feilet — la kategorivelgeren stå åpen, brukeren kan prøve igjen.
      onChange(vare.name);
      onCreate(vare);
      setPendingNewName(null);
      setFocused(false);
    });
  };

  if (pendingNewName) {
    return (
      <div className={styles.createBox}>
        <div className={styles.createLabel}>Velg kategori for «{pendingNewName}»</div>
        <div className={styles.createCats}>
          {SHOP_CATS.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => completeCreate(cat)}
              className={styles.catButton}
            >
              {cat}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPendingNewName(null)}
          className={styles.cancelButton}
        >
          Avbryt
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder ?? "Søk eller skriv ny vare…"}
        autoComplete="off"
        className={styles.input}
      />
      {focused && (matches.length > 0 || showCreateOption) && (
        <div className={styles.suggestions}>
          {matches.map((i) => (
            <div key={i.id} onMouseDown={() => selectVare(i)} className={styles.suggestionRow}>
              <span>{i.name}</span>
              <span className={styles.suggestionCat}>{i.cat}</span>
            </div>
          ))}
          {showCreateOption && (
            <div onMouseDown={() => setPendingNewName(trimmedValue)} className={styles.createRow}>
              ＋ Opprett «{trimmedValue}»
            </div>
          )}
        </div>
      )}
    </div>
  );
}
