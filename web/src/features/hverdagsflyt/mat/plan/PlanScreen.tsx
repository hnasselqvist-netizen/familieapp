import { useState } from "react";
import { Link } from "react-router-dom";
import { getDayDate, addWeeks, getWeekKey } from "@domain/shared/weekKey";
import { getMealName, getMealRecipes, isEvent } from "@domain/meals/meals";
import { isPastDay } from "@domain/meals/mealFeedback";
import { useMealFeedback } from "@hooks/useMealFeedback";
import { useMealLibrary } from "@hooks/useMealLibrary";
import { useMeals } from "@hooks/useMeals";
import { useRecipes } from "@hooks/useRecipes";
import { Button } from "@components/Button";
import { Icon } from "@components/Icon";
import { RoomHeader } from "@components/RoomHeader";
import { DAYS } from "@app-types/meal";
import type { DayKey } from "@app-types/meal";
import { ActiveMealCard } from "./ActiveMealCard";
import { DAY_FULL, DAY_SHORT } from "./days";
import { ForsteutkastPanel } from "./ForsteutkastPanel";
import { MealFeedbackModal } from "./MealFeedbackModal";
import { ShoppingGeneratorModal } from "./ShoppingGeneratorModal";
import styles from "./PlanScreen.module.css";

const fmtShort = (d: Date) => d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

/**
 * Middagsplan — kjerneskive migrert fra `PlanScreen` (index.html linje
 * ~3285–3887), senere bygget videre med produktintegrasjonsskiver
 * (Førsteutkast, måltidsavvik/feedback, delt UI-grunnmur) — se
 * `git log`/Issue #20 for den fulle historikken bak hver enkelt skive.
 *
 * **Middagsplan v1: "Kjøkkenets uke" + aktivt middagskort**
 * (§Kontrolltårn-handoff, Issue #20, "Byggehandoff — Middagsplan v1").
 * Dette er en REDESIGN-skive, ikke en paritetsskive: interaksjonsmodellen
 * er byttet fra inline-redigering-i-dagcellen til ett frittstående
 * modal-kort (`ActiveMealCard`) som samler ALLE dagendrende handlinger
 * (velg/bytt middag, legg til/fjern rett, velg variant, velg/opprett/
 * rediger hendelse, fjern middag) på ett sted. Dagraden selv er etter
 * denne skiven en ren, lesbar oppsummering — kun ikke-destruktive
 * snarveier (📖 åpne oppskrift, 💬 tilbakemelding) er igjen direkte på
 * raden; klikk på raden åpner kortet.
 *
 * **Variantmodellen tas i bruk** (§types/meal.ts sin `MealRecipeRef.
 * variantId`, §generators/shopping/shopping.ts sin variant-bevisste
 * `resolveLibraryConcept`, begge additive/bakoverkompatible fra
 * variantmodell-skivene, PR #18/#19): et bibliotekskonsept med 2+
 * varianter og ingen valgt ennå vises nå som "uløst" i `ActiveMealCard`,
 * med variantvalget som hovedhandlingen — se komponentens egen
 * toppkommentar.
 *
 * **Hendelsesmodellen ryddet** (§domain/meals/mealEventDefaults.ts):
 * "Grandiosa" er fjernet fra standardhendelsene — en konkret, nevnbar
 * rett planlegges nå som enhver annen middag, ikke som en hendelse uten
 * handleliste. Hendelser er i tillegg blitt brukerforvaltbare —
 * `families/{familyId}/mealEvents` (§data/mealEvents.repository.ts) lar
 * brukeren opprette/redigere/fjerne egne hendelser ved siden av
 * standardsettet, uten at selve dagverdiens lagrede form
 * (`{type:"event",name,emoji?}`) endres i det hele tatt.
 *
 * **Hendelser er visuelt likestilt med middager i dagraden**
 * (§Kontrolltårn-review, PR #24): ingen egen "hendelse"-badge eller
 * annen visuell klassifisering — `mealName` vises likt uansett type.
 * Forskjellen mellom en hendelse og en middag ligger i teknisk
 * behandling (ingen ingredienser, ingen konkret oppskrift å åpne) og
 * brukerens involvering, ikke i at planflaten klassifiserer den
 * annerledes. Første versjon av denne skiven viste en egen badge — rettet
 * etter review, ikke en del av den opprinnelige handoffen.
 *
 * **Kjent regresjon rettet, ikke bevart:** dagens "＋ Rett"-knapp (legg
 * til enda en rett på en dag som allerede har middag) vises i
 * `index.html` KUN på dager ANNET enn i dag — en ren UI-innsnevring uten
 * grunnlag i domenelaget. `menu`/flere retter er en gyldig modell og skal
 * IKKE begrenses videre — tilgjengelig på ALLE dager, nå fra
 * `ActiveMealCard`.
 *
 * **Bevisst parkert i denne skiven** (§Kontrolltårn-handoff): "Hvem
 * lager" (familiedeling), utvidelser av måltidsavvik/feedback-flyten
 * (`MealFeedbackModal` under er urørt), og egne Mat-illustrasjoner.
 */
export function PlanScreen() {
  const todayKey = getWeekKey(new Date());
  const [weekKey, setWeekKey] = useState(todayKey);
  const [activeDay, setActiveDay] = useState<DayKey | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const [showForsteutkast, setShowForsteutkast] = useState(false);
  const [feedbackDay, setFeedbackDay] = useState<DayKey | null>(null);

  const {
    meals,
    setDayToRecipe,
    addRecipeToDay,
    removeRecipeFromDay,
    setDayToEvent,
    clearDay,
    setVariantForRecipe,
  } = useMeals(weekKey);
  const { recipes } = useRecipes();
  const { mealLibrary } = useMealLibrary();
  const { feedback, setFeedback, deleteFeedback } = useMealFeedback(weekKey);

  if (
    meals.status !== "loaded" ||
    recipes.status !== "loaded" ||
    mealLibrary.status !== "loaded" ||
    feedback.status !== "loaded"
  ) {
    return <div className={styles.loading}>Laster…</div>;
  }

  const weekMeals = meals.data;
  const recipeList = recipes.data;
  const libraryList = mealLibrary.data;
  const weekFeedback = feedback.data;
  const isCurrentWeek = weekKey === todayKey;
  const todayIdx = (new Date().getDay() + 6) % 7;
  const mon = getDayDate(weekKey, 0);
  const sun = getDayDate(weekKey, 6);

  return (
    <div>
      <RoomHeader
        eyebrow="KJØKKEN"
        title="Middagsplan"
        actions={
          <>
            {!showForsteutkast && (
              <button
                type="button"
                onClick={() => setShowForsteutkast(true)}
                className={styles.forsteutkastButton}
              >
                ✨ Foreslå middager
              </button>
            )}
            <Button onClick={() => setShowGenerator(true)}>🛒 Lag handleliste</Button>
          </>
        }
      />

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
            <Icon name="calendar-days" size={13} />
            Gå til denne uken
          </button>
        )}
      </div>

      {/*
       * "Uken er ett møbel, dagene er radene i møbelet" (§Kontrolltårn-
       * handoff, Issue #20, "hovedløft") — ÉN samlet, kantet flate med
       * innrykkede skillelinjer mellom radene, samme mønster som Gangens
       * "Det viktigste for deg nå"-kort, i stedet for syv separate,
       * mellomromsatskilte `.dayCard`-er. Visuell tidsretning (fortid
       * dempet/i dag tydeligst/fremtid mellomnivå) uttrykkes nå PER RAD
       * (bakgrunn/venstre kant), ikke lenger som en egen, frittstående
       * kortstil — selve møbelets ytre kant/radius/skygge er identisk for
       * alle rader.
       */}
      <div className={styles.weekCard}>
        {DAYS.map((day, i) => {
          const mealVal = weekMeals[day];
          const mealName = getMealName(mealVal);
          const mealIsEvent = isEvent(mealVal);
          const has = !!mealVal;
          const isToday = isCurrentWeek && i === todayIdx;
          const isPast = isCurrentWeek && i < todayIdx;
          const dayDate = getDayDate(weekKey, i);
          const recs = getMealRecipes(mealVal);
          const existingFeedback = weekFeedback[day];
          const canGiveFeedback = has && !mealIsEvent && isPastDay(weekKey, day, new Date());

          return (
            <div key={day}>
              <div
                onClick={() => setActiveDay(day)}
                aria-label={DAY_FULL[day]}
                className={[
                  styles.dayRow,
                  isToday ? styles.dayRowToday : "",
                  isPast ? styles.dayRowPast : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className={isToday ? styles.dayBadgeToday : styles.dayBadge}>
                  <span className={styles.dayBadgeShort}>{DAY_SHORT[day]}</span>
                  <span className={styles.dayBadgeDate}>{dayDate.getDate()}</span>
                </div>
                <div className={styles.dayContent}>
                  {!has && <div className={styles.emptyLabel}>Velg middag</div>}
                  {has && <div className={styles.mealName}>{mealName}</div>}
                </div>
                <div className={styles.dayActions}>
                  {has && !mealIsEvent && recs[0]?.recipeId && (
                    <Link
                      to={`/mat/kokebok?apne=${recs[0].recipeId}`}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Åpne oppskrift for ${DAY_FULL[day]}`}
                      className={styles.openRecipeButton}
                    >
                      <Icon name="book-open" size={14} />
                    </Link>
                  )}
                  {canGiveFeedback && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFeedbackDay(day);
                      }}
                      aria-label={`Tilbakemelding for ${DAY_FULL[day]}`}
                      className={
                        existingFeedback ? styles.feedbackButtonActive : styles.feedbackButton
                      }
                    >
                      💬
                    </button>
                  )}
                </div>
              </div>
              {i < DAYS.length - 1 && <div className={styles.dayDivider} />}
            </div>
          );
        })}
      </div>

      {activeDay && (
        <ActiveMealCard
          dayLabel={DAY_FULL[activeDay]}
          mealVal={weekMeals[activeDay]}
          recipes={recipeList}
          mealLibrary={libraryList}
          onSetRecipe={(recipe) => setDayToRecipe(activeDay, recipe)}
          onSetEvent={(event) => setDayToEvent(activeDay, event)}
          onAddRecipe={(recipe) => addRecipeToDay(activeDay, recipe)}
          onRemoveRecipe={(idx) => removeRecipeFromDay(activeDay, idx)}
          onClearDay={() => clearDay(activeDay)}
          onSetVariant={(recipeIndex, variantId) =>
            setVariantForRecipe(activeDay, recipeIndex, variantId)
          }
          onClose={() => setActiveDay(null)}
        />
      )}

      {showGenerator && (
        <ShoppingGeneratorModal weekKey={weekKey} onClose={() => setShowGenerator(false)} />
      )}

      {feedbackDay && (
        <MealFeedbackModal
          dayLabel={DAY_FULL[feedbackDay]}
          plannedMeal={weekMeals[feedbackDay]}
          existingFeedback={weekFeedback[feedbackDay]}
          recipes={recipeList}
          mealLibrary={libraryList}
          onSave={(value) => setFeedback(feedbackDay, value)}
          onDelete={() => deleteFeedback(feedbackDay)}
          onClose={() => setFeedbackDay(null)}
        />
      )}
    </div>
  );
}
