import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { ItemPicker } from "@components/ItemPicker";
import { RoomHeader } from "@components/RoomHeader";
import { batchLabel, totalGrams } from "@domain/freezer/freezer";
import { useFreezer } from "@hooks/useFreezer";
import { useItems } from "@hooks/useItems";
import type { Vare } from "@app-types/vare";
import styles from "./FreezerScreen.module.css";

const FREEZER_UNITS = ["stk", "g", "kg", "ml", "dl", "l", "pk", "boks", "pose"] as const;

interface FormState {
  name: string;
  count: string;
  unit: (typeof FREEZER_UNITS)[number];
  gramsPerUnit: string;
}

function emptyForm(): FormState {
  return { name: "", count: "1", unit: "pk", gramsPerUnit: "" };
}

/**
 * Fryser — første vertikale skive migrert fra index.html. Funksjonelt
 * uendret fra dagens FreezerScreen (§linje ~5062–5238): domenelogikk i
 * @domain/freezer, Firebase-tilgang i @data/*.repository.ts via hooks,
 * ikke inline i komponenten.
 *
 * **Kjøkken-familien, siste flate** (§Kontrolltårn-handoff, Issue #20,
 * "hovedløft": "Fryser inngår også i Kjøkken-familien i denne
 * leveransen"): sideheaderen bruker nå `RoomHeader`, "Legg til"-knappen
 * er `Button`, ❄️ i listen/tom-tilstanden er byttet til
 * `Icon name="snowflake"`, og fargeidentiteten er byttet fra den
 * nøytrale kjernepaletten til Hjem/Kjøkken-paletten (`--g-*`) — samme
 * mønster som Middagsbibliotek/Kokebok/Handleliste (PR #25). Rask
 * registrering og beholdningsoversikt er UENDRET strukturert/tett —
 * kun fargeidentitet og delte atomer der de faktisk passer.
 */
export function FreezerScreen() {
  const { freezer, addBatch, adjustBatchCount, removeItem } = useFreezer();
  const { items, findOrCreateItem } = useItems();

  const [form, setForm] = useState<FormState>(emptyForm());
  const [selectedVare, setSelectedVare] = useState<Vare | null>(null);

  if (freezer.status !== "loaded" || items.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const freezerItems = freezer.data;
  const showGrams = ["pk", "boks", "pose", "g", "kg"].includes(form.unit);

  const onNameChange = (name: string) => {
    setForm((f) => ({ ...f, name }));
    setSelectedVare(null);
  };

  const submit = async () => {
    const name = form.name.trim();
    if (!name) return;
    const vare = await findOrCreateItem(name, selectedVare?.cat ?? "Diverse");
    if (!vare) return;
    await addBatch(vare, {
      count: Number.parseInt(form.count, 10) || 1,
      unit: form.unit,
      gramsPerUnit: form.gramsPerUnit ? Number.parseInt(form.gramsPerUnit, 10) : null,
    });
    setForm(emptyForm());
    setSelectedVare(null);
  };

  return (
    <div>
      <RoomHeader title="Fryser" description={`${freezerItems.length} varer registrert`} />

      <Card style={{ marginBottom: 20, padding: "12px 14px" }}>
        <div className={styles.formLabel}>Legg til i fryseren</div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>Varenavn</div>
          <ItemPicker
            items={items.data}
            value={form.name}
            onChange={onNameChange}
            onSelect={(vare) => {
              setForm((f) => ({ ...f, name: vare.name }));
              setSelectedVare(vare);
            }}
            onCreate={(vare) => {
              setForm((f) => ({ ...f, name: vare.name }));
              setSelectedVare(vare);
            }}
            findOrCreateItem={findOrCreateItem}
            placeholder="f.eks. Karbonadedeig"
          />
        </div>

        <div className={styles.grid2}>
          <div>
            <div className={styles.fieldLabel}>Antall</div>
            <input
              value={form.count}
              onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))}
              type="number"
              min={1}
              className={styles.countInput}
            />
          </div>
          <div>
            <div className={styles.fieldLabel}>Enhet</div>
            <select
              value={form.unit}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  unit: e.target.value as FormState["unit"],
                  gramsPerUnit: "",
                }))
              }
              className={styles.unitSelect}
            >
              {FREEZER_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showGrams && (
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              Gram per {form.unit} <span className={styles.optional}>(valgfritt)</span>
            </div>
            <div className={styles.gramsRow}>
              <input
                value={form.gramsPerUnit}
                onChange={(e) => setForm((f) => ({ ...f, gramsPerUnit: e.target.value }))}
                type="number"
                placeholder="f.eks. 500"
                className={styles.gramsInput}
              />
              <span className={styles.gramsUnit}>g</span>
            </div>
          </div>
        )}

        {form.name.trim() && (
          <div className={styles.preview}>
            Lagres som: <strong>{form.name.trim()}</strong> — {form.count || "1"} {form.unit}
            {form.gramsPerUnit ? ` à ${form.gramsPerUnit} g` : ""}
          </div>
        )}

        <Button
          onClick={() => void submit()}
          disabled={!form.name.trim()}
          className={styles.submitButton}
        >
          ＋ Legg til i fryseren
        </Button>
      </Card>

      {freezerItems.length === 0 && (
        <div className={styles.empty}>
          <Icon name="snowflake" size={32} className={styles.emptyIcon} />
          <div className={styles.emptyText}>Fryseren er tom</div>
        </div>
      )}

      <div className={styles.list}>
        {freezerItems.map((item) => {
          const total = totalGrams(item);
          return (
            <Card key={item.id} style={{ padding: "10px 14px" }}>
              <div className={styles.itemHeader}>
                <Icon name="snowflake" size={14} className={styles.itemIcon} />
                <span className={styles.itemName}>{item.name}</span>
                {total !== null && <span className={styles.itemTotal}>Totalt: {total} g</span>}
                <button
                  type="button"
                  onClick={() => void removeItem(item.id)}
                  className={styles.removeButton}
                  aria-label={`Fjern ${item.name} fra fryseren`}
                >
                  ✕
                </button>
              </div>
              <div className={styles.batchList}>
                {item.batches.map((batch) => (
                  <div key={batch.id} className={styles.batchRow}>
                    <span className={styles.batchLabel}>{batchLabel(batch)}</span>
                    <button
                      type="button"
                      onClick={() => void adjustBatchCount(item.id, batch.id, -1)}
                      className={styles.stepButton}
                      aria-label={`Reduser antall for ${batchLabel(batch)}`}
                    >
                      −
                    </button>
                    <span className={styles.batchCount}>{batch.count}</span>
                    <button
                      type="button"
                      onClick={() => void adjustBatchCount(item.id, batch.id, 1)}
                      className={styles.stepButton}
                      aria-label={`Øk antall for ${batchLabel(batch)}`}
                    >
                      ＋
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
