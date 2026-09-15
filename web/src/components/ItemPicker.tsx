import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * **Forslagslisten render via en portal til `document.body`** (§Helen-test
 * med reelle data, PR #26, §2): en tidligere `position:absolute`-plassert
 * dropdown relativt til selve inputen ble klippet av enhver scrollende
 * forelder — reelt observert inni en variants handlegrunnlag-flate i
 * `MealLibraryScreen` sin `Modal` (`.panel` har `overflow-y:auto`), som
 * ingen mengde `z-index` kan løse siden `overflow` klipper uavhengig av
 * stableringsrekkefølge. Portalen posisjoneres med `position:fixed` fra
 * inputens `getBoundingClientRect()`, oppdatert på `scroll`
 * (capture-fase — fanger scroll på ENHVER forelder-container, ikke bare
 * `window`) og `resize` mens forslagslisten er åpen. Gjelder alle
 * kallesteder (Handlegrunnlag på måltidsnivå, variantenes egne
 * handlegrunnlag, Fryser, Handleliste) — ikke bare den ene flaten Helen
 * testet, siden problemet er strukturelt i komponenten, ikke i én bruker.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!focused) {
      setDropdownRect(null);
      return;
    }
    const updateRect = () => {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setDropdownRect({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [focused]);

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
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder ?? "Søk eller skriv ny vare…"}
        autoComplete="off"
        className={styles.input}
      />
      {focused &&
        (matches.length > 0 || showCreateOption) &&
        dropdownRect &&
        createPortal(
          <div
            className={styles.suggestions}
            style={{ top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
