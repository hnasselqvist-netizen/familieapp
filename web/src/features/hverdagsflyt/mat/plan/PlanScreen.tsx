import { useState } from "react";
import { Link } from "react-router-dom";
import { getDayDate, addWeeks, getWeekKey } from "@domain/shared/weekKey";
import { getMealName, getMealRecipes, isEvent } from "@domain/meals/meals";
import { useMealLibrary } from "@hooks/useMealLibrary";
import { useMeals } from "@hooks/useMeals";
import { useRecipes } from "@hooks/useRecipes";
import { Modal } from "@components/Modal";
import { DAYS } from "@app-types/meal";
import type { DayKey } from "@app-types/meal";
import type { Recipe } from "@app-types/recipe";
import type { MealLibraryEntry } from "@app-types/shopping";
import { DAY_FULL, DAY_SHORT } from "./days";
import { ForsteutkastPanel } from "./ForsteutkastPanel";
import { ShoppingGeneratorModal } from "./ShoppingGeneratorModal";
import styles from "./PlanScreen.module.css";

/** Speiler dagens `MEAL_EVENTS` (index.html linje ~403–413) — faste hendelser som markerer en dag uten å generere handleliste-varer. */
const MEAL_EVENTS = [
  { name: "Middag hos svigermor", emoji: "🏡" },
  { name: "Middag hos foreldrene", emoji: "🏠" },
  { name: "Enkel middag", emoji: "🍳" },
  { name: "Grandiosa", emoji: "🍕" },
  { name: "Rester", emoji: "♻️" },
  { name: "Spiser ute", emoji: "🍽️" },
  { name: "Hytta", emoji: "🌲" },
  { name: "Ingen middag hjemme", emoji: "❌" },
  { name: "Annet", emoji: "⭐" },
];

const fmtShort = (d: Date) => d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

/** Finner en annen dag i samme uke som allerede har `name` planlagt — grunnlag for "⚠️ Planlagt {dag}"-varselet. */
function findPlannedElsewhere(
  weekMeals: ReturnType<typeof useMeals>["meals"]["data"],
  currentDay: DayKey,
  name: string,
): DayKey | undefined {
  if (!weekMeals) return undefined;
  return DAYS.find(
    (d) => d !== currentDay && getMealName(weekMeals[d]).toLowerCase() === name.toLowerCase(),
  );
}

/**
 * Middagsplan — kjerneskive migrert fra `PlanScreen` (index.html linje
 * ~3285–3887). Dekker teknisk/skjermmessig paritet for uke-navigasjon og
 * dag-CRUD (velg oppskrift/bibliotekmiddag, flere retter på samme dag
 * («menu»), fritekst, marker som hendelse, fjern dag) — alt bygget på
 * allerede karakteriserte og portede motorfunksjoner
 * (`domain/meals/meals.ts`, PR #4).
 *
 * Bevisst UTENFOR denne skiven (samme grense som meals.ts sin egen
 * toppkommentar opprinnelig satte): "✓ Bekreft middag"
 * (bekreft+vurder-flyten, som logger `events` og oppdaterer
 * oppskriftens `lastCooked`/`timesCooked` — en automatisk
 * historikk/feedback-mekanikk som IKKE er låst produktfasit ennå,
 * §Kontrolltårn-handoff Issue #2). Ingen teknisk erstatning her; utelatt,
 * ikke fjernet som konsept.
 *
 * "🛒 Lag handleliste" (`ShoppingGeneratorModal`) og "✨ Foreslå
 * middager" (`ForsteutkastPanel`) ble lagt til i senere, egne
 * Fase-2-/produktintegrasjons-skiver — se deres egne toppkommentarer.
 *
 * **Kjent regresjon rettet, ikke bevart:** dagens "＋ Rett"-knapp (legg
 * til enda en rett på en dag som allerede har middag) vises i
 * `index.html` KUN på dager ANNET enn i dag (`!isToday`-vakt, linje
 * ~3671) — en ren UI-innsnevring uten grunnlag i domenelaget
 * (`addRecipeToMeal` har ingen slik vakt). §Kontrolltårn-handoff:
 * `menu`/flere retter er en gyldig, allerede karakterisert modell og
 * skal IKKE begrenses videre — knappen vises derfor her på ALLE dager.
 *
 * "📖"-snarveien for å åpne en oppskrift direkte fra en dagcelle (kun
 * synlig når dagens første rett har en konkret `recipeId` — aldri for
 * bibliotekmiddager, som ikke har noen Kokebok-oppskrift å åpne) ble
 * lagt til i en senere, egen skive — se `RecipesScreen.tsx` sin egen
 * kommentar om `?apne=<recipeId>`-søkeparameteret som erstatter dagens
 * `window.__openRecipe`/`setTimeout`-bridge.
 */
export function PlanScreen() {
  const todayKey = getWeekKey(new Date());
  const [weekKey, setWeekKey] = useState(todayKey);
  const [editing, setEditing] = useState<DayKey | null>(null);
  const [query, setQuery] = useState("");
  const [addingRec, setAddingRec] = useState<DayKey | null>(null);
  const [addQuery, setAddQuery] = useState("");
  const [showEvents, setShowEvents] = useState<DayKey | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showForsteutkast, setShowForsteutkast] = useState(false);

  const {
    meals,
    setDayToRecipe,
    setDayToText,
    addRecipeToDay,
    removeRecipeFromDay,
    setDayToEvent,
    clearDay,
  } = useMeals(weekKey);
  const { recipes } = useRecipes();
  const { mealLibrary } = useMealLibrary();

  if (meals.status !== "loaded" || recipes.status !== "loaded" || mealLibrary.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const weekMeals = meals.data;
  const recipeList: Recipe[] = recipes.data;
  const libraryList: MealLibraryEntry[] = mealLibrary.data;
  const isCurrentWeek = weekKey === todayKey;
  const todayIdx = (new Date().getDay() + 6) % 7;
  const mon = getDayDate(weekKey, 0);
  const sun = getDayDate(weekKey, 6);

  const startEdit = (day: DayKey) => {
    setEditing(day);
    setQuery(getMealName(weekMeals[day]));
  };
  const closeEdit = () => {
    setEditing(null);
    setQuery("");
  };

  const onQueryChange = (day: DayKey, value: string) => {
    setQuery(value);
    void setDayToText(day, value);
  };

  const pickRecipe = async (day: DayKey, r: Recipe) => {
    await setDayToRecipe(day, { name: r.name, recipeId: r.id });
    closeEdit();
  };
  const pickLibraryMeal = async (day: DayKey, m: MealLibraryEntry) => {
    await setDayToRecipe(day, { name: m.name, recipeId: null });
    closeEdit();
  };

  /** Speiler at `addRecToMenu` (index.html linje ~3327–3336) selv lukker søket etter et vellykket (eller avvist duplikat-)forsøk. */
  const addRecToDayAndClose = async (day: DayKey, r: Recipe) => {
    await addRecipeToDay(day, { id: r.id, name: r.name });
    setAddingRec(null);
    setAddQuery("");
  };

  const hits: Recipe[] =
    query.length > 0
      ? recipeList.filter(
          (r) =>
            r.name.toLowerCase().includes(query.toLowerCase()) ||
            r.tags.some((t) => t.toLowerCase().includes(query.toLowerCase())),
        )
      : [];
  const hitNameLower = new Set(hits.map((r) => r.name.toLowerCase()));
  const libraryHits: MealLibraryEntry[] =
    query.length > 0
      ? libraryList.filter(
          (m) =>
            m.name.toLowerCase().includes(query.toLowerCase()) &&
            !hitNameLower.has(m.name.toLowerCase()),
        )
      : [];

  const addRecipeHits: Recipe[] =
    addQuery.length > 0
      ? recipeList.filter((r) => r.name.toLowerCase().includes(addQuery.toLowerCase())).slice(0, 6)
      : [];

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.title}>Middagsplan</div>
        <div className={styles.headerActions}>
          {!showForsteutkast && (
            <button
              type="button"
              onClick={() => setShowForsteutkast(true)}
              className={styles.forsteutkastButton}
            >
              ✨ Foreslå middager
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowGenerator(true)}
            className={styles.generatorButton}
          >
            🛒 Lag handleliste
          </button>
        </div>
      </div>

      {showForsteutkast && <ForsteutkastPanel onClose={() => setShowForsteutkast(false)} />}

      <div className={styles.weekNav}>
        <div className={styles.weekNavRow}>
          <button
            type="button"
            onClick={() => setWeekKey(addWeeks(weekKey, -1))}
            className={styles.weekNavButton}
          >
            ‹
          </button>
          <div className={styles.weekLabel}>
            <div className={isCurrentWeek ? styles.weekLabelCurrent : styles.weekLabelOther}>
              {isCurrentWeek ? "Denne uken" : weekKey.replace("-W", " · Uke ")}
            </div>
            <div className={styles.weekDates}>
              {fmtShort(mon)} – {fmtShort(sun)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWeekKey(addWeeks(weekKey, 1))}
            className={styles.weekNavButton}
          >
            ›
          </button>
        </div>
        {!isCurrentWeek && (
          <button
            type="button"
            onClick={() => setWeekKey(todayKey)}
            className={styles.goToTodayButton}
          >
            📅 Gå til denne uken
          </button>
        )}
      </div>

      <div className={styles.days}>
        {DAYS.map((day, i) => {
          const isEd = editing === day;
          const mealVal = weekMeals[day];
          const mealName = getMealName(mealVal);
          const mealIsEvent = isEvent(mealVal);
          const has = !!mealVal;
          const isToday = isCurrentWeek && i === todayIdx;
          const isPast = isCurrentWeek && i < todayIdx;
          const dayDate = getDayDate(weekKey, i);
          const recs = getMealRecipes(mealVal);
          const showDropdown = isEd && (hits.length > 0 || libraryHits.length > 0);

          return (
            <div key={day}>
              <div
                onClick={() => !isEd && startEdit(day)}
                aria-label={DAY_FULL[day]}
                className={[
                  styles.dayCard,
                  isEd ? styles.dayCardEditing : isToday ? styles.dayCardToday : "",
                  isPast ? styles.dayCardPast : "",
                  showDropdown ? styles.dayCardWithDropdown : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className={styles.dayRow}>
                  <div className={isToday ? styles.dayBadgeToday : styles.dayBadge}>
                    <span className={styles.dayBadgeShort}>{DAY_SHORT[day]}</span>
                    <span className={styles.dayBadgeDate}>{dayDate.getDate()}</span>
                  </div>
                  <div className={styles.dayContent}>
                    {isEd ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={query}
                          onChange={(e) => onQueryChange(day, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") closeEdit();
                            if (e.key === "Enter" && hits.length === 0) closeEdit();
                          }}
                          placeholder="Søk i kokebok eller skriv inn…"
                          className={styles.editInput}
                        />
                      </div>
                    ) : (
                      <>
                        {!has && <div className={styles.emptyLabel}>Legg til middag…</div>}
                        {has && mealIsEvent && (
                          <div className={styles.eventRow}>
                            <div className={styles.mealName}>{mealName}</div>
                            <span className={styles.eventBadge}>hendelse</span>
                          </div>
                        )}
                        {has && !mealIsEvent && (
                          <div>
                            {recs.map((rec, ri) => (
                              <div key={ri} className={styles.recipeRow}>
                                <span className={styles.mealName}>{rec.name}</span>
                                {recs.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void removeRecipeFromDay(day, ri);
                                    }}
                                    aria-label={`Fjern ${rec.name} fra ${DAY_FULL[day]}`}
                                    className={styles.removeRecipeButton}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className={styles.dayActions}>
                    {isEd ? (
                      <div className={styles.editActions}>
                        <button
                          type="button"
                          onClick={() => {
                            setShowEvents(day);
                            setEditing(null);
                            setQuery("");
                          }}
                          className={styles.eventButton}
                        >
                          🏡 Hendelse
                        </button>
                        <button type="button" onClick={closeEdit} className={styles.doneButton}>
                          Ferdig
                        </button>
                      </div>
                    ) : (
                      <>
                        {has && !mealIsEvent && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAddingRec(day);
                              setAddQuery("");
                            }}
                            className={styles.addDishButton}
                          >
                            ＋ Rett
                          </button>
                        )}
                        {has && !mealIsEvent && recs[0]?.recipeId && (
                          <Link
                            to={`/mat/kokebok?apne=${recs[0].recipeId}`}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Åpne oppskrift for ${DAY_FULL[day]}`}
                            className={styles.openRecipeButton}
                          >
                            📖
                          </Link>
                        )}
                        {has && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void clearDay(day);
                            }}
                            aria-label={`Fjern middag for ${DAY_FULL[day]}`}
                            className={styles.clearButton}
                          >
                            ✕
                          </button>
                        )}
                        {!has && <span className={styles.emptyIcon}>＋</span>}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {showDropdown && (
                <div className={styles.dropdown}>
                  {hits.map((r, ri) => {
                    const plannedDay = findPlannedElsewhere(weekMeals, day, r.name);
                    return (
                      <button
                        type="button"
                        key={r.id}
                        onClick={() => !plannedDay && void pickRecipe(day, r)}
                        disabled={!!plannedDay}
                        className={[
                          styles.dropdownRow,
                          ri > 0 ? styles.dropdownRowBordered : "",
                          plannedDay ? styles.dropdownRowDisabled : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className={styles.dropdownEmoji}>🍳</span>
                        <div className={styles.dropdownText}>
                          <div className={styles.dropdownName}>{r.name}</div>
                          <div className={styles.dropdownMeta}>
                            {plannedDay ? (
                              <span className={styles.plannedWarning}>
                                ⚠️ Planlagt {DAY_FULL[plannedDay].toLowerCase()}
                              </span>
                            ) : (
                              <span>
                                ⏱ {r.time} min · 👥 {r.servings} pers
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {libraryHits.map((m, mi) => {
                    const plannedDay = findPlannedElsewhere(weekMeals, day, m.name);
                    return (
                      <button
                        type="button"
                        key={`libhit-${m.id}`}
                        onClick={() => !plannedDay && void pickLibraryMeal(day, m)}
                        disabled={!!plannedDay}
                        className={[
                          styles.dropdownRow,
                          hits.length > 0 || mi > 0 ? styles.dropdownRowBordered : "",
                          plannedDay ? styles.dropdownRowDisabled : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className={styles.dropdownEmoji}>📚</span>
                        <div className={styles.dropdownText}>
                          <div className={styles.dropdownName}>{m.name}</div>
                          <div className={styles.dropdownMeta}>
                            {plannedDay ? (
                              <span className={styles.plannedWarning}>
                                ⚠️ Planlagt {DAY_FULL[plannedDay].toLowerCase()}
                              </span>
                            ) : (
                              <span>fra biblioteket</span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {addingRec === day && (
                <div className={styles.dropdown} onClick={(e) => e.stopPropagation()}>
                  <div className={styles.addRecSearch}>
                    <input
                      autoFocus
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                      placeholder="Søk etter rett å legge til…"
                      className={styles.editInput}
                    />
                  </div>
                  {addRecipeHits.map((r, ri) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => void addRecToDayAndClose(day, r)}
                      className={[styles.dropdownRow, ri > 0 ? styles.dropdownRowBordered : ""]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className={styles.dropdownEmoji}>🍳</span>
                      <div className={styles.dropdownText}>
                        <div className={styles.dropdownName}>{r.name}</div>
                        <div className={styles.dropdownMeta}>
                          ⏱ {r.time} min · 👥 {r.servings} pers
                        </div>
                      </div>
                    </button>
                  ))}
                  {addQuery.length === 0 && (
                    <div className={styles.dropdownHint}>Skriv for å søke i kokebok</div>
                  )}
                  <div className={styles.addRecCancelRow}>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingRec(null);
                        setAddQuery("");
                      }}
                      className={styles.cancelLink}
                    >
                      Avbryt
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showEvents && (
        <Modal title="Velg hendelse" onClose={() => setShowEvents(null)}>
          <div className={styles.eventsHint}>
            Hendelser markerer dagen som planlagt, men genererer ikke ingredienser til handlelisten.
          </div>
          <div className={styles.eventsList}>
            {MEAL_EVENTS.map((ev) => (
              <button
                type="button"
                key={ev.name}
                onClick={() => {
                  void setDayToEvent(showEvents, { name: ev.name, emoji: ev.emoji });
                  setShowEvents(null);
                }}
                className={styles.eventOption}
              >
                <span className={styles.eventOptionEmoji}>{ev.emoji}</span>
                <span>{ev.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {showGenerator && (
        <ShoppingGeneratorModal weekKey={weekKey} onClose={() => setShowGenerator(false)} />
      )}
    </div>
  );
}
