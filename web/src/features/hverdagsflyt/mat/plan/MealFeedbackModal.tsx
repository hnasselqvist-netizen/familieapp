import { useState } from "react";
import { getMealName, getMealRecipes } from "@domain/meals/meals";
import { Modal } from "@components/Modal";
import type { MealRecipeRef, MealValue } from "@app-types/meal";
import type { MealFeedback } from "@app-types/mealFeedback";
import type { Recipe } from "@app-types/recipe";
import type { MealLibraryEntry } from "@app-types/shopping";
import styles from "./MealFeedbackModal.module.css";

export interface MealFeedbackModalProps {
  dayLabel: string;
  plannedMeal: MealValue | undefined;
  existingFeedback: MealFeedback | undefined;
  recipes: Recipe[];
  mealLibrary: MealLibraryEntry[];
  onSave: (feedback: MealFeedback) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

/**
 * Kompakt avviks-/feedbackflyt for én PASSERT dag — erstatter legacy
 * «Bekreft middag»-tankegangen (§Kontrolltårn-handoff, Issue #2,
 * kommentar 5585975593). Normaltilfellet ("planen ble faktisk middag")
 * krever INGEN handling her i det hele tatt — denne modalen er kun et
 * TILBUD om retrospektiv korrigering/tilbakemelding, aldri et krav.
 *
 * Ren lokal draft-tilstand frem til "Lagre" trykkes — skriver da hele
 * dagens feedback-post på én gang (§hooks/useMealFeedback.ts). `wantAgain`/
 * `paused` er bevisst tri-state (`boolean | undefined`, ikke enkel
 * boolean) — kun eksplisitt rørte avkrysningsbokser skrives, slik at et
 * uendret skjema aldri produserer en tom feedback-post (se `lagre()` sin
 * `harInnhold`-sjekk), OG slik at en eksplisitt `paused:false` (gjenåpning
 * av en tidligere pause, §domain/meals/mealFeedback.ts) faktisk kan
 * skrives i stedet for å bli utelatt som "urørt".
 */
export function MealFeedbackModal({
  dayLabel,
  plannedMeal,
  existingFeedback,
  recipes,
  mealLibrary,
  onSave,
  onDelete,
  onClose,
}: MealFeedbackModalProps) {
  const [avvikAapen, setAvvikAapen] = useState(!!existingFeedback?.actual);
  const [avvikRetter, setAvvikRetter] = useState<MealRecipeRef[]>(() =>
    existingFeedback?.actual ? getMealRecipes(existingFeedback.actual) : [],
  );
  const [avvikQuery, setAvvikQuery] = useState("");
  const [wantAgain, setWantAgain] = useState<boolean | undefined>(
    existingFeedback?.feedback?.wantAgain,
  );
  const [paused, setPaused] = useState<boolean | undefined>(existingFeedback?.feedback?.paused);
  const [comment, setComment] = useState(existingFeedback?.feedback?.comment ?? "");
  const [saving, setSaving] = useState(false);

  const plannedName = getMealName(plannedMeal);
  const effectiveName =
    avvikRetter.length > 0 ? avvikRetter.map((r) => r.name).join(" · ") : plannedName;

  const avvikTreff =
    avvikQuery.length > 0
      ? [
          ...recipes
            .filter((r) => r.name.toLowerCase().includes(avvikQuery.toLowerCase()))
            .map((r) => ({ name: r.name, recipeId: r.id as string | null, icon: "🍳" })),
          ...mealLibrary
            .filter(
              (m) =>
                m.name.toLowerCase().includes(avvikQuery.toLowerCase()) &&
                !recipes.some((r) => r.name.toLowerCase() === m.name.toLowerCase()),
            )
            .map((m) => ({ name: m.name, recipeId: null as string | null, icon: "📚" })),
        ]
          .filter(
            (hit) => !avvikRetter.some((r) => r.name.toLowerCase() === hit.name.toLowerCase()),
          )
          .slice(0, 8)
      : [];

  const leggTilAvvik = (hit: { name: string; recipeId: string | null }) => {
    setAvvikRetter((prev) => [...prev, { name: hit.name, recipeId: hit.recipeId }]);
    setAvvikQuery("");
  };

  const fjernAvvik = (idx: number) => {
    setAvvikRetter((prev) => prev.filter((_, i) => i !== idx));
  };

  const lagre = async () => {
    const feedbackObj: NonNullable<MealFeedback["feedback"]> = {};
    if (wantAgain !== undefined) feedbackObj.wantAgain = wantAgain;
    if (paused !== undefined) feedbackObj.paused = paused;
    if (comment.trim()) feedbackObj.comment = comment.trim();

    const harAvvik = avvikRetter.length > 0;
    const harFeedback = Object.keys(feedbackObj).length > 0;

    if (!harAvvik && !harFeedback) {
      setSaving(true);
      if (existingFeedback) await onDelete();
      setSaving(false);
      onClose();
      return;
    }

    const actual: MealValue | undefined = harAvvik
      ? avvikRetter.length === 1
        ? { type: "recipe", name: avvikRetter[0]!.name, recipeId: avvikRetter[0]!.recipeId }
        : { type: "menu", name: avvikRetter.map((r) => r.name).join(" · "), recipes: avvikRetter }
      : undefined;

    setSaving(true);
    await onSave({
      ...(actual !== undefined ? { actual } : {}),
      ...(harFeedback ? { feedback: feedbackObj } : {}),
      recordedAt: Date.now(),
    });
    setSaving(false);
    onClose();
  };

  const nullstill = async () => {
    setSaving(true);
    await onDelete();
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={`Tilbakemelding — ${dayLabel}`} onClose={onClose}>
      <div className={styles.plannedRow}>
        <span className={styles.plannedLabel}>Planlagt:</span>
        <span className={styles.plannedName}>{plannedName || "(ingen middag planlagt)"}</span>
      </div>

      {!avvikAapen && (
        <button type="button" onClick={() => setAvvikAapen(true)} className={styles.avvikToggle}>
          Ble det en annen middag? →
        </button>
      )}

      {avvikAapen && (
        <div className={styles.avvikSection}>
          {avvikRetter.length > 0 && (
            <div className={styles.avvikRetter}>
              {avvikRetter.map((rec, ri) => (
                <span key={`${rec.name}-${ri}`} className={styles.avvikChip}>
                  {rec.name}
                  <button
                    type="button"
                    onClick={() => fjernAvvik(ri)}
                    aria-label={`Fjern ${rec.name} fra faktisk middag`}
                    className={styles.avvikChipRemove}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            value={avvikQuery}
            onChange={(e) => setAvvikQuery(e.target.value)}
            placeholder="Søk i kokebok eller biblioteket…"
            autoComplete="off"
            className={styles.avvikSearchInput}
          />
          {avvikTreff.length > 0 && (
            <div className={styles.avvikDropdown}>
              {avvikTreff.map((hit, hi) => (
                <button
                  type="button"
                  key={`${hit.name}-${hi}`}
                  onClick={() => leggTilAvvik(hit)}
                  className={[styles.dropdownRow, hi > 0 ? styles.dropdownRowBordered : ""].join(
                    " ",
                  )}
                >
                  <span className={styles.dropdownEmoji}>{hit.icon}</span>
                  <span className={styles.dropdownName}>{hit.name}</span>
                </button>
              ))}
            </div>
          )}
          {avvikRetter.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setAvvikRetter([]);
                setAvvikQuery("");
                setAvvikAapen(false);
              }}
              className={styles.avvikReset}
            >
              Tilbakestill til planlagt
            </button>
          )}
        </div>
      )}

      <div className={styles.feedbackSection}>
        <div className={styles.feedbackHint}>Om {effectiveName || "middagen"}:</div>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={wantAgain ?? false}
            onChange={() => setWantAgain((prev) => !(prev ?? false))}
          />
          👍 Ønskes igjen
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={paused ?? false}
            onChange={() => setPaused((prev) => !(prev ?? false))}
          />
          ⏸ Sett på pause (forslås ikke automatisk før du gjenåpner den)
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Kommentar — vises neste gang middagen velges, før shopping…"
          rows={3}
          className={styles.commentInput}
        />
      </div>

      <div className={styles.actions}>
        {existingFeedback && (
          <button
            type="button"
            onClick={() => void nullstill()}
            disabled={saving}
            className={styles.resetButton}
          >
            Nullstill
          </button>
        )}
        <div className={styles.actionsRight}>
          <button type="button" onClick={onClose} className={styles.cancelButton}>
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => void lagre()}
            disabled={saving}
            className={styles.saveButton}
          >
            Lagre
          </button>
        </div>
      </div>
    </Modal>
  );
}
