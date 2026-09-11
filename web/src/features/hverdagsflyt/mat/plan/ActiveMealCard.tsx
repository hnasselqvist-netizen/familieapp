import { useState } from "react";
import { getMealName, getMealRecipes, isEvent } from "@domain/meals/meals";
import { DEFAULT_MEAL_EVENTS } from "@domain/meals/mealEventDefaults";
import { useMealEvents } from "@hooks/useMealEvents";
import { Button } from "@components/Button";
import { Modal } from "@components/Modal";
import type { MealValue } from "@app-types/meal";
import type { Recipe } from "@app-types/recipe";
import type { MealLibraryEntry } from "@app-types/shopping";
import type { MealEventOption } from "@app-types/mealEvent";
import styles from "./ActiveMealCard.module.css";

export interface ActiveMealCardProps {
  dayLabel: string;
  mealVal: MealValue | null | undefined;
  recipes: Recipe[];
  mealLibrary: MealLibraryEntry[];
  onSetRecipe: (recipe: { name: string; recipeId: string | null }) => Promise<void>;
  onSetEvent: (event: { name: string; emoji?: string }) => Promise<void>;
  onAddRecipe: (recipe: { id: string; name: string }) => Promise<void>;
  onRemoveRecipe: (idx: number) => Promise<void>;
  onClearDay: () => Promise<void>;
  onSetVariant: (recipeIndex: number, variantId: string) => Promise<void>;
  onClose: () => void;
}

type Mode = "summary" | "picker" | "addRett" | "newEvent";

/**
 * Det aktive middags-/dagkortet (Middagsplan v1, §Kontrolltårn-handoff,
 * Issue #20, "Byggehandoff — Middagsplan v1"). Erstatter dagens
 * inline-redigering-i-dagcellen fullt ut — "Trykk på middagsnavnet
 * aktiverer dagen/middagen og åpner ett frittstående popup/modal-kort...
 * Kortet skal samle hele endringen slik at brukeren fullfører
 * beslutningen på ett sted." ALLE dagendrende handlinger (velg/bytt
 * middag, legg til/fjern rett, velg variant, velg/opprett/rediger
 * hendelse, fjern middag) bor derfor her — selve dagraden i `PlanScreen`
 * er etter denne skiven en ren, lesbar oppsummering med kun
 * ikke-destruktive snarveier (📖 åpne oppskrift, 💬 tilbakemelding).
 *
 * **Variantvalg er hovedhandlingen** for en bibliotekmiddag med 2+
 * varianter — vises FØRST og mest fremtredende i sammendrags-visningen,
 * foran de sekundære "Bytt middag"/"+ Rett"/"Fjern middag"-handlingene.
 *
 * **Variantvelgeren blir stående etter et valg** (§Kontrolltårn-review,
 * PR #24): slås opp direkte mot `mealLibrary` (ikke via en "uløst"-status)
 * og vises så lenge konseptet har 2+ varianter, uavhengig av om
 * `variantId` er satt — den valgte varianten er tydelig markert, og
 * brukeren kan bytte til en annen variant med ETT klikk, uten å gå via
 * "Bytt middag" (som fortsatt betyr å endre selve middagskonseptet, ikke
 * variant). Første versjon skjulte velgeren helt så snart en variant var
 * valgt — rettet etter review, ikke en del av den opprinnelige handoffen.
 */
export function ActiveMealCard({
  dayLabel,
  mealVal,
  recipes,
  mealLibrary,
  onSetRecipe,
  onSetEvent,
  onAddRecipe,
  onRemoveRecipe,
  onClearDay,
  onSetVariant,
  onClose,
}: ActiveMealCardProps) {
  const { mealEvents, addEvent, updateEvent, removeEvent } = useMealEvents();
  const has = !!mealVal;
  const [mode, setMode] = useState<Mode>(has ? "summary" : "picker");
  const [query, setQuery] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("");

  const mealIsEvent = isEvent(mealVal);
  const mealName = getMealName(mealVal);
  const recRefs = !mealIsEvent ? getMealRecipes(mealVal) : [];

  const hits: Recipe[] =
    query.length > 0
      ? recipes.filter(
          (r) =>
            r.name.toLowerCase().includes(query.toLowerCase()) ||
            r.tags.some((t) => t.toLowerCase().includes(query.toLowerCase())),
        )
      : [];
  const hitNameLower = new Set(hits.map((r) => r.name.toLowerCase()));
  const libraryHits: MealLibraryEntry[] =
    query.length > 0
      ? mealLibrary.filter(
          (m) =>
            m.name.toLowerCase().includes(query.toLowerCase()) &&
            !hitNameLower.has(m.name.toLowerCase()),
        )
      : [];

  const addRettHits: Recipe[] =
    query.length > 0
      ? recipes.filter((r) => r.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
      : [];

  const customEvents = mealEvents.status === "loaded" ? mealEvents.data : [];
  const trimmedQuery = query.trim();
  const exactMatch =
    hits.some((r) => r.name.toLowerCase() === trimmedQuery.toLowerCase()) ||
    libraryHits.some((m) => m.name.toLowerCase() === trimmedQuery.toLowerCase());

  const pickRecipe = async (r: Recipe) => {
    await onSetRecipe({ name: r.name, recipeId: r.id });
    onClose();
  };
  const pickLibraryMeal = async (m: MealLibraryEntry) => {
    await onSetRecipe({ name: m.name, recipeId: null });
    onClose();
  };
  const pickFreeText = async () => {
    await onSetRecipe({ name: trimmedQuery, recipeId: null });
    onClose();
  };
  const pickEvent = async (ev: { name: string; emoji?: string }) => {
    await onSetEvent(ev);
    onClose();
  };

  const startEditEvent = (ev: MealEventOption) => {
    setEditingEventId(ev.id);
    setEditName(ev.name);
    setEditEmoji(ev.emoji ?? "");
  };
  const saveEditEvent = async () => {
    if (!editingEventId || !editName.trim()) return;
    await updateEvent(editingEventId, { name: editName.trim(), emoji: editEmoji || undefined });
    setEditingEventId(null);
  };
  const deleteEditingEvent = async () => {
    if (!editingEventId) return;
    await removeEvent(editingEventId);
    setEditingEventId(null);
  };

  const submitNewEvent = async () => {
    if (!newName.trim()) return;
    const created = await addEvent({ name: newName.trim(), emoji: newEmoji || undefined });
    await onSetEvent({ name: created.name, emoji: created.emoji });
    onClose();
  };

  const addRett = async (r: Recipe) => {
    await onAddRecipe({ id: r.id, name: r.name });
    setQuery("");
    setMode("summary");
  };

  return (
    <Modal title={dayLabel} onClose={onClose}>
      <div className={styles.card}>
        {mode === "summary" && (
          <>
            {mealIsEvent ? (
              <div className={styles.currentEvent}>{mealName}</div>
            ) : (
              <div className={styles.recipeList}>
                {recRefs.map((ref, i) => {
                  const libMeal = mealLibrary.find(
                    (m) => m.name.toLowerCase() === ref.name.toLowerCase(),
                  );
                  const variants = libMeal?.variants;
                  const hasVariants = !!variants && variants.length >= 2;
                  const valgtVariant = ref.variantId
                    ? variants?.find((v) => v.id === ref.variantId)
                    : undefined;
                  return (
                    <div key={`${ref.name}-${i}`} className={styles.recipeRow}>
                      <div className={styles.recipeRowTop}>
                        <span className={styles.recipeName}>{ref.name}</span>
                        {recRefs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => void onRemoveRecipe(i)}
                            aria-label={`Fjern ${ref.name} fra ${dayLabel}`}
                            className={styles.removeRecipeButton}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {hasVariants && (
                        <div className={styles.variantPicker}>
                          <div className={styles.variantHint}>
                            {valgtVariant
                              ? `Løses som ${valgtVariant.name} — bytt om ønskelig:`
                              : `Velg hvordan «${ref.name}» løses:`}
                          </div>
                          <div className={styles.variantOptions}>
                            {variants.map((v) => (
                              <button
                                type="button"
                                key={v.id}
                                onClick={() => void onSetVariant(i, v.id)}
                                aria-pressed={v.id === ref.variantId}
                                className={
                                  v.id === ref.variantId
                                    ? styles.variantOptionActive
                                    : styles.variantOption
                                }
                              >
                                {v.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className={styles.secondaryActions}>
              <button
                type="button"
                onClick={() => {
                  setMode("picker");
                  setQuery("");
                }}
                className={styles.secondaryLink}
              >
                Bytt middag
              </button>
              {!mealIsEvent && (
                <button
                  type="button"
                  onClick={() => {
                    setMode("addRett");
                    setQuery("");
                  }}
                  className={styles.secondaryLink}
                >
                  ＋ Rett
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void onClearDay();
                  onClose();
                }}
                className={styles.secondaryLinkDanger}
              >
                Fjern middag
              </button>
            </div>
          </>
        )}

        {mode === "addRett" && (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Søk etter rett å legge til…"
              className={styles.searchInput}
            />
            <div className={styles.hitList}>
              {addRettHits.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => void addRett(r)}
                  className={styles.hitRow}
                >
                  {r.name}
                </button>
              ))}
              {query.length > 0 && addRettHits.length === 0 && (
                <div className={styles.hint}>Ingen treff i kokeboken.</div>
              )}
            </div>
            <button type="button" onClick={() => setMode("summary")} className={styles.cancelLink}>
              Avbryt
            </button>
          </>
        )}

        {mode === "picker" && (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Søk i kokebok eller biblioteket…"
              className={styles.searchInput}
            />
            {query.length > 0 && (
              <div className={styles.hitList}>
                {hits.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => void pickRecipe(r)}
                    className={styles.hitRow}
                  >
                    {r.name}
                  </button>
                ))}
                {libraryHits.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => void pickLibraryMeal(m)}
                    className={styles.hitRow}
                  >
                    {m.name}
                  </button>
                ))}
                {trimmedQuery.length > 0 && !exactMatch && (
                  <button
                    type="button"
                    onClick={() => void pickFreeText()}
                    className={styles.hitRow}
                  >
                    Bruk «{trimmedQuery}»
                  </button>
                )}
              </div>
            )}

            <div className={styles.eventsSection}>
              <div className={styles.eventsSectionTitle}>Eller velg en hendelse</div>
              <div className={styles.eventsList}>
                {[...DEFAULT_MEAL_EVENTS, ...customEvents].map((ev) => {
                  const isCustom = "id" in ev;
                  const custom = isCustom ? (ev as MealEventOption) : null;
                  if (custom && editingEventId === custom.id) {
                    return (
                      <div key={custom.id} className={styles.eventEditRow}>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Navn"
                          className={styles.eventEditInput}
                        />
                        <input
                          value={editEmoji}
                          onChange={(e) => setEditEmoji(e.target.value)}
                          placeholder="Emoji (valgfritt)"
                          className={styles.eventEditEmojiInput}
                        />
                        <button
                          type="button"
                          onClick={() => void saveEditEvent()}
                          className={styles.eventEditSave}
                        >
                          Lagre
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteEditingEvent()}
                          className={styles.eventEditDelete}
                        >
                          Fjern
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingEventId(null)}
                          className={styles.cancelLink}
                        >
                          Avbryt
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={custom?.id ?? ev.name} className={styles.eventRow}>
                      <button
                        type="button"
                        onClick={() => void pickEvent(ev)}
                        className={styles.eventOption}
                      >
                        {ev.emoji && <span className={styles.eventEmoji}>{ev.emoji}</span>}
                        <span>{ev.name}</span>
                      </button>
                      {custom && (
                        <button
                          type="button"
                          onClick={() => startEditEvent(custom)}
                          aria-label={`Rediger hendelsen ${custom.name}`}
                          className={styles.eventEditButton}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setMode("newEvent")}
                className={styles.secondaryLink}
              >
                ＋ Ny hendelse
              </button>
            </div>

            {has && (
              <button
                type="button"
                onClick={() => setMode("summary")}
                className={styles.cancelLink}
              >
                Avbryt
              </button>
            )}
          </>
        )}

        {mode === "newEvent" && (
          <>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Navn på hendelsen…"
              className={styles.searchInput}
            />
            <input
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
              placeholder="Emoji (valgfritt)"
              className={styles.searchInput}
            />
            <div className={styles.panelActions}>
              <button type="button" onClick={() => setMode("picker")} className={styles.cancelLink}>
                Avbryt
              </button>
              <Button onClick={() => void submitNewEvent()} disabled={!newName.trim()}>
                Legg til hendelse
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
