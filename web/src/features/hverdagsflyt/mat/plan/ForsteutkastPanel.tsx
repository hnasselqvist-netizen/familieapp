import { useMemo, useState } from "react";
import {
  genererForsteutkast,
  planPeriodeNoekkel,
  sorterBibliotekEtterHistorikk,
} from "@domain/meals/forsteutkast";
import { deriveLastFeedbackForMeal } from "@domain/meals/mealFeedback";
import { getMealName, isEvent } from "@domain/meals/meals";
import { beregnPlanperiodeTilDato } from "@domain/meals/planningPeriod";
import { addWeeks, getWeekKey } from "@domain/shared/weekKey";
import { useMealFeedbackRange } from "@hooks/useMealFeedbackRange";
import { useMealLibrary } from "@hooks/useMealLibrary";
import { useMealsRange } from "@hooks/useMealsRange";
import { useMealsWriter } from "@hooks/useMealsWriter";
import { useRecipes } from "@hooks/useRecipes";
import { Icon } from "@components/Icon";
import { Modal } from "@components/Modal";
import type { ForsteutkastForslag } from "@domain/meals/forsteutkast";
import type { DayKey } from "@app-types/meal";
import { DAY_FULL, DAY_SHORT } from "./days";
import styles from "./ForsteutkastPanel.module.css";

const fmtShort = (d: Date) => d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

/** Historisk vindu for rangering — kun et datahentings-bånd, ikke en forslags-terskel (§forsteutkast.ts). */
const LOOKBACK_WEEKS = 8;

/** Antall dager en myk anbefaling (§panelet under) begynner å vises ved — IKKE en hard grense. */
const SOFT_HORIZON_WARNING_DAYS = 21;

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromISODate(s: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  return new Date(y!, m! - 1, d!);
}

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
 *
 * **Dynamisk planleggingshorisont** (Middagsplan v1, §Kontrolltårn-
 * handoff, Issue #20, "Byggehandoff — Middagsplan v1"): perioden er ikke
 * lenger fast torsdag→torsdag (§domain/meals/planningPeriod.ts sin
 * `beregnAktivPlanperiode`, fortsatt karakterisert og korrekt, men ikke
 * lenger denne komponentens periodekilde). Brukeren velger sluttdato i en
 * kalender, med standard "i dag + 7 dager"; sluttdatoen er autoritativ
 * (§`beregnPlanperiodeTilDato`). Kun redigerbar i "configure"-fasen — når
 * forslagene først er generert, er datoen som lå til grunn låst for den
 * gjennomgangen, samme prinsipp som resten av flyten. Perioden kan nå
 * spenne over VILKÅRLIG mange uker (ikke bare maks 2, slik en fast
 * torsdag→torsdag-periode ga) — skrivingen i `godkjennPlan` bruker derfor
 * `useMealsWriter` (§hooks/useMealsWriter.ts), som tar `weekKey` som
 * parameter per skriving i stedet for å binde den til én/to faste
 * `useMeals`-hook-instanser.
 *
 * **Design-review runde 3: egen arbeidsflate** (§Helen-review, PR #26,
 * §7): panelet render nå inni det delte `Modal`-atomet i stedet for
 * inline i `PlanScreen` sin flyt — "Foreslå middager" er en egen
 * arbeidsflate, ikke en ekstra seksjon som dytter uke-møbelet nedover.
 * Reell endring utover innpakningen: dager som allerede har en middag
 * viser nå den FAKTISKE valgte retten (ikke bare "allerede planlagt")
 * også i konfigureringsfasen, og slike rader får en rolig terrakotta
 * "allerede bestemt"-behandling (`--g-accent-soft`/`--g-terracotta`) i
 * begge faser — generatoren fyller fortsatt kun åpne dager/hull, den
 * skriver ALDRI over en eksisterende dag (§`godkjennPlan` sin
 * dobbeltsikring, uendret). Emoji (🍃/✨/📚/🍳/✕/💬/→) er byttet til
 * `Icon`-komponentens Lucide-familie (`sprout`/`sparkles`/`folder-open`/
 * `book-open`/`x`/`message-circle`/`arrow-right`) — resten av review-/
 * godkjenn-flyten er uendret.
 */
export function ForsteutkastPanel({ onClose }: ForsteutkastPanelProps) {
  const [today] = useState(() => new Date());
  const [sluttdato, setSluttdato] = useState(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return d;
  });
  const periode = useMemo(() => beregnPlanperiodeTilDato(today, sluttdato), [today, sluttdato]);
  const weekKeys = useMemo(() => {
    const todayKey = getWeekKey(new Date());
    const keys = new Set<string>();
    for (let i = -LOOKBACK_WEEKS; i <= 1; i++) keys.add(addWeeks(todayKey, i));
    periode.forEach((d) => keys.add(d.weekKey));
    return Array.from(keys);
  }, [periode]);
  const [phase, setPhase] = useState<"configure" | "review">("configure");
  const [lettvintDager, setLettvintDager] = useState<Set<string>>(new Set());
  const [draftValg, setDraftValg] = useState<ForsteutkastForslag>({});
  const [byttDag, setByttDag] = useState<string | null>(null);
  const [byttSokAapen, setByttSokAapen] = useState(false);
  const [byttQuery, setByttQuery] = useState("");

  const { setDayToRecipeForWeek } = useMealsWriter();

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
      <Modal title="Foreslå middager" onClose={onClose}>
        <div className={styles.loading}>Laster…</div>
      </Modal>
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
      await setDayToRecipeForWeek(wk, dayKey, { name: navn, recipeId: null });
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
            .map((r) => ({ navn: r.name, ikon: "book-open" as const })),
          ...libraryList
            .filter(
              (m) =>
                m.name.toLowerCase().includes(byttQuery.toLowerCase()) &&
                !recipeList.some((r) => r.name.toLowerCase() === m.name.toLowerCase()),
            )
            .map((m) => ({ navn: m.name, ikon: "folder-open" as const })),
        ].slice(0, 8)
      : [];

  const periodeLabel = `${fmtShort(periode[0]?.dato ?? new Date())} til ${fmtShort(periode[periode.length - 1]?.dato ?? new Date())}`;

  return (
    <Modal title="Foreslå middager" onClose={onClose}>
      <div className={styles.panelTitle}>{periodeLabel}</div>

      {phase === "configure" && (
        <>
          <label className={styles.horizonRow}>
            <span>Planlegg til og med</span>
            <input
              type="date"
              value={toISODate(sluttdato)}
              min={toISODate(today)}
              onChange={(e) => {
                const parsed = fromISODate(e.target.value);
                if (parsed) setSluttdato(parsed);
              }}
              className={styles.horizonInput}
            />
          </label>
          {periode.length > SOFT_HORIZON_WARNING_DAYS && (
            <div className={styles.horizonHint}>
              Tips: planlegg noen uker om gangen for best resultat.
            </div>
          )}
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
                    <span className={styles.decidedName}>{getMealName(eksisterende)}</span>
                    <span className={styles.decidedStatus}>
                      {isEvent(eksisterende) ? "hendelse" : "allerede bestemt"}
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
                    <Icon name="sprout" size={13} />
                    Lettvint
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
              Generer forslag
              <Icon name="arrow-right" size={14} />
            </button>
          </div>
        </>
      )}

      {phase === "review" && (
        <>
          <div className={styles.panelHint}>
            Forslag markert med <Icon name="sparkles" size={11} />. Bytt eller fjern det du ikke vil
            ha — resten godtar du bare ved å la det stå.
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
                  <div
                    className={[
                      erBytteDag ? styles.reviewRowOpen : styles.reviewRow,
                      erEksisterende ? styles.decidedRow : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className={styles.reviewDay}>
                      {DAY_SHORT[dayKey]} {dato.getDate()}.
                    </span>
                    <span
                      className={
                        erEksisterende
                          ? styles.decidedName
                          : visningsnavn
                            ? styles.reviewName
                            : styles.reviewNameEmpty
                      }
                    >
                      {!erEksisterende && visningsnavn && (
                        <span className={styles.sparkle}>
                          <Icon name="sparkles" size={12} />{" "}
                        </span>
                      )}
                      {visningsnavn || "Ingen forslag"}
                    </span>
                    {erEksisterende ? (
                      <span className={styles.decidedStatus}>
                        {erHendelseAllerede ? "hendelse" : "allerede bestemt"}
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
                            <Icon name="x" size={13} />
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
                            <span className={styles.dropdownIcon}>
                              <Icon name="folder-open" size={15} />
                            </span>
                            <span className={styles.dropdownText}>
                              <span className={styles.dropdownName}>{m.name}</span>
                              {sisteTilbakemelding?.comment && (
                                <span className={styles.dropdownComment}>
                                  <Icon name="message-circle" size={11} />{" "}
                                  {sisteTilbakemelding.comment}
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
                          Finn en annen
                          <Icon name="arrow-right" size={12} />
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
                            <span className={styles.dropdownIcon}>
                              <Icon name={alt.ikon} size={15} />
                            </span>
                            <span className={styles.dropdownText}>
                              <span className={styles.dropdownName}>{alt.navn}</span>
                              {sisteTilbakemelding?.comment && (
                                <span className={styles.dropdownComment}>
                                  <Icon name="message-circle" size={11} />{" "}
                                  {sisteTilbakemelding.comment}
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
    </Modal>
  );
}
