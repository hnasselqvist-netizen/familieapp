import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { ItemPicker } from "@components/ItemPicker";
import { Modal } from "@components/Modal";
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
 *
 * **Design-review runde 1: "beholdning som arbeidsflate"**
 * (§Kontrolltårn-review, PR #26, §8): rask registrering er nå en
 * `RoomHeader`-headerhandling som åpner en varm `Modal` i stedet for en
 * alltid-synlig `Card` øverst — normalvisningen er nå beholdningen selv
 * som hovedinnhold. Varenavn i beholdningslisten er 15px (var 14px).
 *
 * **Design-review runde 2** (§Kontrolltårn-review, PR #26, §6): `Totalt`
 * bruker nå `--g-text-soft` (var en frittstående blå `#4a8bbf`) — samme
 * metadata-tone som resten av appens sekundærinformasjon.
 * `+`/`−`-kontrollene har nå et reelt ~44px berøringsmål (var 24px) mens
 * selve glyfen er uendret liten. Sletting er flyttet fra header-raden til
 * en tydelig sekundær "Fjern fra fryseren"-lenke under batch-listen
 * (`trash-2`-ikon), i stedet for et lite `✕` ved siden av varenavnet.
 * Beholdningen bruker fortsatt separate varme `Card`-flater (`variant`
 * standard `"warm"` — samme `--g-furniture`/`--g-line`/skygge som resten
 * av Kjøkkenet) i stedet for ETT samlet møbel — bevisst valg: batch-
 * listen per vare er en egen, potensielt flerlinjes liste, og reviewen
 * åpner selv for "separate vareflater" så lenge de bruker samme
 * materiale/rytme konsekvent, som de allerede gjør via det delte
 * `Card`-atomet.
 */
export function FreezerScreen() {
  const { freezer, addBatch, adjustBatchCount, removeItem } = useFreezer();
  const { items, findOrCreateItem } = useItems();

  const [form, setForm] = useState<FormState>(emptyForm());
  const [selectedVare, setSelectedVare] = useState<Vare | null>(null);
  const [showAdd, setShowAdd] = useState(false);

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
    setShowAdd(false);
  };

  return (
    <div>
      <RoomHeader
        eyebrow="KJØKKEN"
        showDate
        title="Fryser"
        description={`${freezerItems.length} varer registrert`}
        actions={<Button onClick={() => setShowAdd(true)}>＋ Legg til</Button>}
      />

      {showAdd && (
        <Modal
          title="Legg til i fryseren"
          onClose={() => {
            setShowAdd(false);
            setForm(emptyForm());
            setSelectedVare(null);
          }}
        >
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
        </Modal>
      )}

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
              <button
                type="button"
                onClick={() => void removeItem(item.id)}
                className={styles.deleteLink}
                aria-label={`Fjern ${item.name} fra fryseren`}
              >
                <Icon name="trash-2" size={13} />
                Fjern fra fryseren
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
