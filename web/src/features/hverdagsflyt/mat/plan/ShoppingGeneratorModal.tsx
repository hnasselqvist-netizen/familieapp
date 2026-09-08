import { useState } from "react";
import { Modal } from "@components/Modal";
import { SHOP_CATS } from "@domain/shared/constants";
import { getMealName, isEvent } from "@domain/meals/meals";
import { addWeeks, getDayDate, getWeekKey } from "@domain/shared/weekKey";
import {
  buildShoppingItems,
  mergeShoppingItems,
  toShoppingListEntry,
} from "@generators/shopping/shopping";
import { useItemHistory } from "@hooks/useItemHistory";
import { useMealLibrary } from "@hooks/useMealLibrary";
import { useMeals } from "@hooks/useMeals";
import { useRecipes } from "@hooks/useRecipes";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { DAYS } from "@app-types/meal";
import type { DayKey, MealValue, WeekMeals } from "@app-types/meal";
import type { MergedShoppingItem } from "@app-types/shopping";
import { DAY_FULL } from "./days";
import styles from "./ShoppingGeneratorModal.module.css";

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

interface Candidate {
  wk: string;
  day: DayKey;
  i: number;
  val: MealValue;
  dayDate: Date;
}

interface ReviewItem extends MergedShoppingItem {
  id: string;
}

type EditField = "amount" | "unit" | "cat";

function buildCandidates(
  weekKey: string,
  nextWeekKey: string,
  thisWeekMeals: WeekMeals,
  nextWeekMeals: WeekMeals,
  todayKey: string,
  todayIdx: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  (
    [
      [weekKey, thisWeekMeals],
      [nextWeekKey, nextWeekMeals],
    ] as const
  ).forEach(([wk, wkMeals]) => {
    DAYS.forEach((day, i) => {
      const val = wkMeals[day];
      if (!val || isEvent(val)) return;
      if (wk === todayKey && i < todayIdx) return;
      candidates.push({ wk, day, i, val, dayDate: getDayDate(wk, i) });
    });
  });
  return candidates;
}

const dayLabel = (c: Candidate) =>
  `${DAY_FULL[c.day]} ${c.dayDate.getDate()}. ${c.dayDate.toLocaleDateString("nb-NO", { month: "short" })}`;

export interface ShoppingGeneratorModalProps {
  weekKey: string;
  onClose: () => void;
}

/**
 * Handlelistegenerator-skjermen — migrert fra `ShoppingGenerator`
 * (index.html linje ~2742–3021), kalt fra Middagsplan sin "🛒 Lag
 * handleliste"-knapp. Ren skjerm-UI over motorlogikken som allerede var
 * migrert og karakterisert i PR #5 (`buildShoppingItems`/
 * `mergeShoppingItems`/`toShoppingListEntry`, §generators/shopping/
 * shopping.ts) — kandidatvalget (hvilke kommende, ikke-hendelse-dager de
 * neste to ukene som vises som avkryssbare) og gjennomgangs-steget
 * (fjern vare, rediger mengde/enhet/kategori, "basisvare?"-spørsmål) er
 * bevisst holdt utenfor generatorens rene lag (§shopping.ts sin
 * toppkommentar), akkurat som i dag.
 *
 * `addBatch` (§data/shopping.repository.ts) er den nye skrivestien denne
 * skiven la til — se dens egen kommentar for hvorfor en concurrency-safe
 * per-post-verifisering ble valgt fremfor én hel-samling-transaksjon.
 */
export function ShoppingGeneratorModal({ weekKey, onClose }: ShoppingGeneratorModalProps) {
  const todayKey = getWeekKey(new Date());
  const nextWeekKey = addWeeks(weekKey, 1);
  const todayIdx = (new Date().getDay() + 6) % 7;

  const { meals: thisWeek } = useMeals(weekKey);
  const { meals: nextWeek } = useMeals(nextWeekKey);
  const { recipes } = useRecipes();
  const { mealLibrary } = useMealLibrary();
  const { itemHistory } = useItemHistory();
  const { staples, markAsStaple } = useStaples();
  const { shopping, addBatch } = useShoppingList();

  const [step, setStep] = useState<"select" | "review">("select");
  const [checked, setChecked] = useState<Set<number> | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [staplePrompt, setStaplePrompt] = useState<{ id: string; name: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Record<EditField, string>>>>({});
  const [showStaples, setShowStaples] = useState(false);

  const ready =
    thisWeek.status === "loaded" &&
    nextWeek.status === "loaded" &&
    recipes.status === "loaded" &&
    mealLibrary.status === "loaded" &&
    itemHistory.status === "loaded" &&
    staples.status === "loaded" &&
    shopping.status === "loaded";

  const candidates = ready
    ? buildCandidates(weekKey, nextWeekKey, thisWeek.data, nextWeek.data, todayKey, todayIdx)
    : [];

  // Initialiserer "alle avkrysset" først når kandidatene faktisk er kjent
  // — samme mønster som å utlede state fra props/data som først er klare
  // etter et senere render (offisielt støttet i React: å kalle en setter
  // betinget UNDER selve renderingen, ikke i en effekt).
  if (ready && checked === null) {
    setChecked(new Set(candidates.map((_, i) => i)));
  }

  if (!ready || checked === null) {
    return (
      <Modal title="Lag handleliste" onClose={onClose}>
        <div className={styles.loading}>Laster…</div>
      </Modal>
    );
  }

  const toggleCandidate = (idx: number) => {
    setChecked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const goToReview = () => {
    const selected = candidates.filter((_, idx) => checked.has(idx)).map((c) => c.val);
    const enriched = buildShoppingItems(selected, {
      recipes: recipes.data,
      mealLibrary: mealLibrary.data,
      itemHistory: itemHistory.data,
      staples: staples.data,
    });
    const merged = mergeShoppingItems(enriched);
    const items: ReviewItem[] = merged.map((m) => ({ ...m, id: crypto.randomUUID() }));
    setRemoved(new Set(items.filter((i) => i.isStaple).map((i) => i.id)));
    setReviewItems(items);
    setStep("review");
  };

  const getEdit = (item: ReviewItem, field: EditField): string =>
    edits[item.id]?.[field] ?? item[field];
  const setEdit = (id: string, field: EditField, value: string) =>
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }));

  const toggleRemove = (id: string, name: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      setStaplePrompt({ id, name });
      next.add(id);
      return next;
    });
  };

  const confirmStaple = async (isStaple: boolean) => {
    if (isStaple && staplePrompt) await markAsStaple(staplePrompt.name);
    setStaplePrompt(null);
  };

  const addToList = async () => {
    const toAdd = reviewItems
      .filter((i) => !removed.has(i.id))
      .map((i) =>
        toShoppingListEntry({
          itemId: i.itemId,
          name: i.name,
          amount: getEdit(i, "amount") || i.amount,
          unit: getEdit(i, "unit") || i.unit,
          cat: getEdit(i, "cat") || i.cat,
        }),
      );
    await addBatch(shopping.data, toAdd);
    onClose();
  };

  const normalItems = reviewItems.filter((i) => !i.isStaple);
  const stapleItems = reviewItems.filter((i) => i.isStaple);
  const activeCount = reviewItems.filter((i) => !removed.has(i.id)).length;
  const categoryOrder = [...new Set(normalItems.map((i) => i.cat))];

  return (
    <Modal title="Lag handleliste" onClose={onClose}>
      {step === "select" && (
        <div>
          <div className={styles.hint}>Velg hvilke middager du vil handle for.</div>
          {candidates.length === 0 ? (
            <div className={styles.empty}>Ingen kommende middager er planlagt.</div>
          ) : (
            <div className={styles.candidateList}>
              {candidates.map((c, idx) => {
                const on = checked.has(idx);
                return (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => toggleCandidate(idx)}
                    className={on ? styles.candidateRowOn : styles.candidateRow}
                  >
                    <span className={on ? styles.checkboxOn : styles.checkbox}>{on && "✓"}</span>
                    <div className={styles.candidateText}>
                      <div className={styles.candidateName}>{getMealName(c.val)}</div>
                      <div className={styles.candidateDate}>{dayLabel(c)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div className={styles.actionsRow}>
            <button type="button" onClick={onClose} className={styles.cancelButton}>
              Avbryt
            </button>
            <button
              type="button"
              onClick={goToReview}
              disabled={checked.size === 0 || candidates.length === 0}
              className={styles.primaryButton}
            >
              Hent ingredienser ({checked.size}) →
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className={styles.reviewWrap}>
          <button type="button" onClick={() => setStep("select")} className={styles.backButton}>
            ← Tilbake
          </button>
          <div className={styles.hint}>
            Trykk på en vare for å fjerne den. Du kan endre mengde, enhet og kategori.
          </div>

          {reviewItems.length === 0 ? (
            <div className={styles.empty}>Ingen ingredienser funnet.</div>
          ) : (
            <div className={styles.itemGroups}>
              {categoryOrder.map((cat) => (
                <div key={cat} className={styles.categoryGroup}>
                  <div className={styles.categoryHeader}>
                    <span className={styles.categoryName}>{cat}</span>
                    <div className={styles.categoryLine} />
                  </div>
                  {normalItems
                    .filter((i) => i.cat === cat)
                    .map((item) => {
                      const rem = removed.has(item.id);
                      return (
                        <div key={item.id} className={rem ? styles.itemRowRemoved : styles.itemRow}>
                          <div
                            className={styles.itemTopRow}
                            onClick={() => toggleRemove(item.id, item.name)}
                          >
                            <span className={rem ? styles.checkbox : styles.checkboxOn}>
                              {!rem && "✓"}
                            </span>
                            <span className={rem ? styles.itemNameRemoved : styles.itemName}>
                              {item.name}
                            </span>
                            <span className={styles.itemSource}>{item.fromRecipes.join(", ")}</span>
                          </div>
                          {!rem && (
                            <div
                              className={styles.itemEditRow}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="number"
                                value={getEdit(item, "amount")}
                                onChange={(e) => setEdit(item.id, "amount", e.target.value)}
                                className={styles.editAmount}
                              />
                              <select
                                value={getEdit(item, "unit")}
                                onChange={(e) => setEdit(item.id, "unit", e.target.value)}
                                className={styles.editUnit}
                              >
                                {SHOP_UNITS.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={getEdit(item, "cat")}
                                onChange={(e) => setEdit(item.id, "cat", e.target.value)}
                                className={styles.editCat}
                              >
                                {SHOP_CATS.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              ))}

              {stapleItems.length > 0 && (
                <div className={styles.stapleSection}>
                  <button
                    type="button"
                    onClick={() => setShowStaples((s) => !s)}
                    className={styles.stapleToggle}
                  >
                    <div className={styles.categoryLine} />
                    <span className={styles.stapleToggleLabel}>
                      {showStaples ? "▴" : "▾"} {stapleItems.length} BASISVARER (har vanligvis
                      hjemme)
                    </span>
                    <div className={styles.categoryLine} />
                  </button>
                  {showStaples &&
                    stapleItems.map((item) => {
                      const rem = removed.has(item.id);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => toggleRemove(item.id, item.name)}
                          className={rem ? styles.stapleRowRemoved : styles.stapleRow}
                        >
                          <span className={rem ? styles.checkbox : styles.checkboxGold}>
                            {!rem && "✓"}
                          </span>
                          <span className={rem ? styles.itemNameRemoved : styles.itemName}>
                            {item.name}
                          </span>
                          <span className={styles.itemSource}>
                            {item.amount}
                            {item.unit ? ` ${item.unit}` : ""}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {staplePrompt && (
            <div className={styles.staplePromptOverlay}>
              <div className={styles.staplePromptCard}>
                <div className={styles.staplePromptTitle}>
                  Har du vanligvis «{staplePrompt.name}» hjemme?
                </div>
                <div className={styles.staplePromptText}>
                  Basisvarer avhukes automatisk neste gang de dukker opp i en handleliste.
                </div>
                <div className={styles.actionsRow}>
                  <button
                    type="button"
                    onClick={() => void confirmStaple(false)}
                    className={styles.cancelButton}
                  >
                    Nei
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmStaple(true)}
                    className={styles.primaryButton}
                  >
                    Ja, basisvare
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className={styles.actionsRow}>
            <button type="button" onClick={onClose} className={styles.cancelButton}>
              Avbryt
            </button>
            <button type="button" onClick={() => void addToList()} className={styles.primaryButton}>
              Legg til {activeCount} varer →
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
