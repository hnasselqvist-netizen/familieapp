import { useState } from "react";
import {
  genererForsteutkast,
  planPeriodeNoekkel,
  sorterBibliotekEtterHistorikk,
} from "@domain/meals/forsteutkast";
import { deriveLastFeedbackForMeal } from "@domain/meals/mealFeedback";
import { getMealName, isEvent } from "@domain/meals/meals";
import { beregnAktivPlanperiode } from "@domain/meals/planningPeriod";
import { addWeeks, getWeekKey } from "@domain/shared/weekKey";
import { useMealFeedbackRange } from "@hooks/useMealFeedbackRange";
import { useMealLibrary } from "@hooks/useMealLibrary";
import { useMeals } from "@hooks/useMeals";
import { useMealsRange } from "@hooks/useMealsRange";
import { useRecipes } from "@hooks/useRecipes";
import type { ForsteutkastForslag } from "@domain/meals/forsteutkast";
import type { DayKey } from "@app-types/meal";
import { DAY_FULL, DAY_SHORT } from "./days";
import styles from "./ForsteutkastPanel.module.css";

const fmtShort = (d: Date) => d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

/** Historisk vindu for rangering — kun et datahentings-bånd, ikke en forslags-terskel (§forsteutkast.ts). */
const LOOKBACK_WEEKS = 8;

export interface ForsteutkastPanelProps {
  onClose: () => void;
}

/**
 * Førsteutkast — auto-forslagspanel for Middagsplan, migrert fra
 * index.html sitt draft-panel (linje ~3445–3578) MED en ny
 * rangeringsalgoritme (§domain/meals/forsteutkast.ts sin toppkommentar
 * for hvorfor). Ny "konfigurer lettvint-dager"-fase lagt til FØR
 * generering, per §Kontrolltårn-handoff (Issue #2, kommentar
 * 5584010648): "Lettvint middag" er et pre-planleggingsinput/dagskrav,
 * IKKE en hendelse — skal være kjent FØR forslagene genereres.
 *
 * Rent lokal draft-tilstand frem til "Bruk denne planen" trykkes —
 * `godkjennPlan` skriver KUN da, én gang per berørt uke, og ALDRI en dag
 * som allerede har en eksisterende middag (dobbel sikring, samme
 * prinsipp som index.html sin `godkjennPlan`).
 *
 * **Måltidsavvik/feedback-integrasjon** (§Kontrolltårn-handoff, kommentar
 * 5585975593): abonnerer nå på `useMealFeedbackRange` over samme
 * datahentings-vindu som `useMealsRange`, slik at rangeringen og
 * bytte-alternativene (§forsteutkast.ts) bruker FAKTISK historikk og
 * ekskluderer pausede middager. Bytte-alternativene viser i tillegg
 * siste registrerte kommentar for hver kandidat (`lastFeedbackFor`) —
 * "familieerfaring vises neste gang middagen velges, før shopping".
 */
export function ForsteutkastPanel({ onClose }: ForsteutkastPanelProps) {
  const [periode] = useState(() => beregnAktivPlanperiode(new Date()));
  const [weekKeys] = useState(() => {
    const todayKey = getWeekKey(new Date());
    const keys = new Set<string>();
    for (let i = -LOOKBACK_WEEKS; i <= 1; i++) keys.add(addWeeks(todayKey, i));
    periode.forEach((d) => keys.add(d.weekKey));
    return Array.from(keys);
  });
  const [phase, setPhase] = useState<"configure" | "review">("configure");
  const [lettvintDager, setLettvintDager] = useState<Set<string>>(new Set());
  const [draftValg, setDraftValg] = useState<ForsteutkastForslag>({});
  const [byttDag, setByttDag] = useState<string | null>(null);
  const [byttSokAapen, setByttSokAapen] = useState(false);
  const [byttQuery, setByttQuery] = useState("");

  const firstWeekKey = periode[0]?.weekKey ?? getWeekKey(new Date());
  const lastWeekKey = periode[periode.length - 1]?.weekKey ?? firstWeekKey;
  const firstWeek = useMeals(firstWeekKey);
  const lastWeek = useMeals(lastWeekKey);

  const { allMeals } = useMealsRange(weekKeys);
  const { allFeedback } = useMealFeedbackRange(weekKeys);
  const { mealLibrary } = useMealLibrary();
  const { recipes } = useRecipes();

  const ready =
    allMeals.status === "loaded" &&
    allFeedback.status === "loaded" &&
    mealLibrary.status === "loaded" &&
    recipes.status === "loaded";

  if (!ready) {
    return (
      <div className={styles.panel}>
        <div className={styles.loading}>Laster…</div>
      </div>
    );
  }

  const historicalMeals = allMeals.data;
  const historicalFeedback = allFeedback.data;
  const libraryList = mealLibrary.data;
  const recipeList = recipes.data;
  const lastFeedbackFor = (navn: string) =>
    deriveLastFeedbackForMeal(navn, historicalMeals, historicalFeedback);

  const toggleLettvint = (noekkel: string) => {
    setLettvintDager((prev) => {
      const next = new Set(prev);
      if (next.has(noekkel)) next.delete(noekkel);
      else next.add(noekkel);
      return next;
    });
  };

  const generate = () => {
    const forslag = genererForsteutkast({
      planDager: periode,
      mealLibrary: libraryList,
      recipes: recipeList,
      allMeals: historicalMeals,
      allFeedback: historicalFeedback,
      lettvintDager,
    });
    setDraftValg(forslag);
    setPhase("review");
  };

  const fjernDraftForslag = (noekkel: string) => {
    setDraftValg((prev) => {
      const next = { ...prev };
      delete next[noekkel];
      return next;
    });
  };

  const settDraftValg = (noekkel: string, navn: string) => {
    setDraftValg((prev) => ({ ...prev, [noekkel]: navn }));
    setByttDag(null);
    setByttSokAapen(false);
    setByttQuery("");
  };

  const godkjennPlan = async () => {
    for (const [noekkel, navn] of Object.entries(draftValg)) {
      const [wk, dayKeyStr] = noekkel.split("|");
      if (!wk || !dayKeyStr) continue;
      const dayKey = dayKeyStr as DayKey;
      const eksisterende = historicalMeals[wk]?.[dayKey];
      if (eksisterende) continue; // dobbel sikring — overskriv aldri en dag som fikk innhold i mellomtiden
      const api = wk === firstWeekKey ? firstWeek : lastWeek;
      await api.setDayToRecipe(dayKey, { name: navn, recipeId: null });
    }
    onClose();
  };

  const bibliotekAlternativer = (() => {
    if (!byttDag) return [];
    const naavaerendeNavn = draftValg[byttDag] ?? "";
    const brukAndreSteder = new Set(
      Object.entries(draftValg)
        .filter(([k]) => k !== byttDag)
        .map(([, v]) => v.toLowerCase()),
    );
    return sorterBibliotekEtterHistorikk(libraryList, historicalMeals, historicalFeedback)
      .filter(
        (m) =>
          m.name.toLowerCase() !== naavaerendeNavn.toLowerCase() &&
          !brukAndreSteder.has(m.name.toLowerCase()),
      )
      .slice(0, 6);
  })();

  const byttSokTreff =
    byttQuery.length > 0
      ? [
          ...recipeList
            .filter((r) => r.name.toLowerCase().includes(byttQuery.toLowerCase()))
            .map((r) => ({ navn: r.name, ikon: "🍳" })),
          ...libraryList
            .filter(
              (m) =>
                m.name.toLowerCase().includes(byttQuery.toLowerCase()) &&
                !recipeList.some((r) => r.name.toLowerCase() === m.name.toLowerCase()),
            )
            .map((m) => ({ navn: m.name, ikon: "📚" })),
        ].slice(0, 8)
      : [];

  const periodeLabel = `${fmtShort(periode[0]?.dato ?? new Date())} til ${fmtShort(periode[periode.length - 1]?.dato ?? new Date())}`;

  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Førsteutkast — {periodeLabel}</div>

      {phase === "configure" && (
        <>
          <div className={styles.panelHint}>
            Merk dager som trenger en lettvint middag før forslagene genereres.
          </div>
          <div className={styles.configureList}>
            {periode.map(({ dato, weekKey, dayKey }) => {
              const noekkel = planPeriodeNoekkel(weekKey, dayKey);
              const eksisterende = historicalMeals[weekKey]?.[dayKey];
              if (eksisterende) {
                return (
                  <div key={noekkel} className={styles.configureRowExisting}>
                    <span className={styles.configureDay}>
                      {DAY_SHORT[dayKey]} {dato.getDate()}.
                    </span>
                    <span className={styles.reviewStatus}>
                      {isEvent(eksisterende) ? "hendelse" : "allerede planlagt"}
                    </span>
                  </div>
                );
              }
              const kreverLettvint = lettvintDager.has(noekkel);
              return (
                <label key={noekkel} className={styles.configureRow}>
                  <span className={styles.configureDay}>
                    {DAY_SHORT[dayKey]} {dato.getDate()}.
                  </span>
                  <span className={styles.configureCheckbox}>
                    <input
                      type="checkbox"
                      checked={kreverLettvint}
                      onChange={() => toggleLettvint(noekkel)}
                      aria-label={`Krev lettvint middag ${DAY_FULL[dayKey]}`}
                    />
                    🍃 Lettvint
                  </span>
                </label>
              );
            })}
          </div>
          <div className={styles.panelActions}>
            <button type="button" onClick={onClose} className={styles.cancelButton}>
              Avbryt
            </button>
            <button type="button" onClick={generate} className={styles.primaryButton}>
              Generer forslag →
            </button>
          </div>
        </>
      )}

      {phase === "review" && (
        <>
          <div className={styles.panelHint}>
            Forslag markert med ✨. Bytt eller fjern det du ikke vil ha — resten godtar du bare ved
            å la det stå.
          </div>
          <div className={styles.reviewList}>
            {periode.map(({ dato, weekKey, dayKey }) => {
              const noekkel = planPeriodeNoekkel(weekKey, dayKey);
              const eksisterende = historicalMeals[weekKey]?.[dayKey];
              const erEksisterende = !!eksisterende;
              const visningsnavn = erEksisterende
                ? getMealName(eksisterende)
                : (draftValg[noekkel] ?? "");
              const erHendelseAllerede = erEksisterende && isEvent(eksisterende);
              const erBytteDag = byttDag === noekkel;

              return (
                <div key={noekkel}>
                  <div className={erBytteDag ? styles.reviewRowOpen : styles.reviewRow}>
                    <span className={styles.reviewDay}>
                      {DAY_SHORT[dayKey]} {dato.getDate()}.
                    </span>
                    <span className={visningsnavn ? styles.reviewName : styles.reviewNameEmpty}>
                      {!erEksisterende && visningsnavn && (
                        <span className={styles.sparkle}>✨ </span>
                      )}
                      {visningsnavn || "Ingen forslag"}
                    </span>
                    {erEksisterende ? (
                      <span className={styles.reviewStatus}>
                        {erHendelseAllerede ? "hendelse" : "allerede planlagt"}
                      </span>
                    ) : (
                      <div className={styles.reviewActions}>
                        {visningsnavn && (
                          <button
                            type="button"
                            onClick={() => {
                              setByttDag(noekkel);
                              setByttSokAapen(false);
                              setByttQuery("");
                            }}
                            className={styles.byttButton}
                          >
                            Bytt
                          </button>
                        )}
                        {visningsnavn && (
                          <button
                            type="button"
                            onClick={() => fjernDraftForslag(noekkel)}
                            aria-label={`Fjern forslag for ${DAY_FULL[dayKey]}`}
                            className={styles.removeSuggestionButton}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {erBytteDag && !byttSokAapen && (
                    <div className={styles.byttDropdown}>
                      {bibliotekAlternativer.map((m, mi) => {
                        const sisteTilbakemelding = lastFeedbackFor(m.name);
                        return (
                          <button
                            type="button"
                            key={m.id}
                            onClick={() => settDraftValg(noekkel, m.name)}
                            className={[
                              styles.dropdownRow,
                              mi > 0 ? styles.dropdownRowBordered : "",
                            ].join(" ")}
                          >
                            <span className={styles.dropdownEmoji}>📚</span>
                            <span className={styles.dropdownText}>
                              <span className={styles.dropdownName}>{m.name}</span>
                              {sisteTilbakemelding?.comment && (
                                <span className={styles.dropdownComment}>
                                  💬 {sisteTilbakemelding.comment}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                      {bibliotekAlternativer.length === 0 && (
                        <div className={styles.dropdownHint}>
                          Ingen flere alternativer i biblioteket akkurat nå.
                        </div>
                      )}
                      <div className={styles.byttFooter}>
                        <button
                          type="button"
                          onClick={() => setByttDag(null)}
                          className={styles.cancelLink}
                        >
                          Avbryt
                        </button>
                        <button
                          type="button"
                          onClick={() => setByttSokAapen(true)}
                          className={styles.findAnotherLink}
                        >
                          Finn en annen →
                        </button>
                      </div>
                    </div>
                  )}

                  {erBytteDag && byttSokAapen && (
                    <div className={styles.byttDropdown}>
                      <div className={styles.byttSearchRow}>
                        <input
                          autoFocus
                          value={byttQuery}
                          onChange={(e) => setByttQuery(e.target.value)}
                          placeholder="Søk i kokebok eller biblioteket…"
                          autoComplete="off"
                          className={styles.byttSearchInput}
                        />
                      </div>
                      {byttSokTreff.map((alt, ai) => {
                        const sisteTilbakemelding = lastFeedbackFor(alt.navn);
                        return (
                          <button
                            type="button"
                            key={`${alt.navn}-${ai}`}
                            onClick={() => settDraftValg(noekkel, alt.navn)}
                            className={[styles.dropdownRow, styles.dropdownRowBordered].join(" ")}
                          >
                            <span className={styles.dropdownEmoji}>{alt.ikon}</span>
                            <span className={styles.dropdownText}>
                              <span className={styles.dropdownName}>{alt.navn}</span>
                              {sisteTilbakemelding?.comment && (
                                <span className={styles.dropdownComment}>
                                  💬 {sisteTilbakemelding.comment}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                      <div className={styles.byttFooter}>
                        <button
                          type="button"
                          onClick={() => {
                            setByttDag(null);
                            setByttSokAapen(false);
                            setByttQuery("");
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
          <div className={styles.panelActions}>
            <button type="button" onClick={onClose} className={styles.cancelButton}>
              Avbryt
            </button>
            <button
              type="button"
              onClick={() => void godkjennPlan()}
              className={styles.primaryButton}
            >
              Bruk denne planen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
