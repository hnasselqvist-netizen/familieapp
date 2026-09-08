import { useState } from "react";
import { Card } from "@components/Card";
import { getMealName } from "@domain/meals/meals";
import { addWeeks, getWeekKey } from "@domain/shared/weekKey";
import { DAYS, type DayKey } from "@app-types/meal";
import { useMeals } from "@hooks/useMeals";
import type { Recipe } from "@app-types/recipe";
import styles from "./AddToPlanCard.module.css";

const DAY_SHORT: Record<DayKey, string> = {
  Mon: "Ma",
  Tue: "Ti",
  Wed: "On",
  Thu: "To",
  Fri: "Fr",
  Sat: "Lø",
  Sun: "Sø",
};

export interface AddToPlanCardProps {
  recipe: Recipe;
}

/**
 * Legg-til-i-middagsplanen-kort på oppskriftsdetaljen — portert 1:1 fra
 * `AddToPlanCard` (index.html linje ~4638–4693). Skriver via
 * `useMeals`/`transactMealDay` (§data/meals.repository.ts), ikke den
 * additive `addRecipeToMeal`-sammenslåingen `PlanScreen` bruker: denne
 * kortvisningen setter dagen UBETINGET til akkurat denne oppskriften, og
 * viser derfor kun dager som er tomme eller allerede har den — samme
 * begrensning som i dag.
 */
export function AddToPlanCard({ recipe }: AddToPlanCardProps) {
  const todayIdx = (new Date().getDay() + 6) % 7;
  const [week, setWeek] = useState<"this" | "next">("this");
  const thisWeekKey = getWeekKey(new Date());
  const nextWeekKey = addWeeks(thisWeekKey, 1);
  const thisWeek = useMeals(thisWeekKey);
  const nextWeek = useMeals(nextWeekKey);

  const active = week === "this" ? thisWeek : nextWeek;
  if (active.meals.status !== "loaded") return null;
  const currentMeals = active.meals.data;

  const alreadyPlanned = Object.values(currentMeals).some(
    (m) => getMealName(m).toLowerCase() === recipe.name.toLowerCase(),
  );

  return (
    <Card style={{ marginBottom: 12, padding: "10px 14px" }}>
      <div className={styles.title}>📅 Legg til i middagsplanen</div>

      <div className={styles.weekPicker}>
        {(["this", "next"] as const).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWeek(w)}
            className={week === w ? styles.weekButtonActive : styles.weekButton}
          >
            {w === "this" ? "Denne uken" : "Neste uke"}
          </button>
        ))}
      </div>

      {alreadyPlanned && (
        <div className={styles.warning}>
          ⚠️ Allerede planlagt {week === "this" ? "denne" : "neste"} uke
        </div>
      )}

      <div className={styles.days}>
        {DAYS.map((d, i) => {
          const isThisRecipe =
            getMealName(currentMeals[d]).toLowerCase() === recipe.name.toLowerCase();
          const hasOther = !!currentMeals[d] && !isThisRecipe;
          if (hasOther) return null;
          const isPast = week === "this" && i < todayIdx;
          return (
            <button
              key={d}
              type="button"
              onClick={() =>
                void active.setDayToRecipe(d, { name: recipe.name, recipeId: recipe.id })
              }
              className={
                isThisRecipe
                  ? styles.dayButtonActive
                  : isPast
                    ? styles.dayButtonPast
                    : styles.dayButton
              }
            >
              {DAY_SHORT[d]}
              {isThisRecipe ? " ✓" : ""}
              {isPast ? " (passert)" : ""}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
