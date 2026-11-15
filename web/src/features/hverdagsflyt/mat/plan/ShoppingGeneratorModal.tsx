import { useRef, useState } from "react";
import { Modal } from "@components/Modal";
import { SHOP_CATS } from "@domain/shared/constants";
import { freezerLabel } from "@domain/freezer/freezer";
import { getMealName, isEvent } from "@domain/meals/meals";
import {
  type GeneratorEffekter,
  type GeneratorPlan,
  lagGeneratorPlan,
} from "@domain/shopping/handlelisteGenerator";
import { sorterKategorier } from "@domain/shopping/kategoriorden";
import { addWeeks, getDayDate, getWeekKey } from "@domain/shared/weekKey";
import {
  buildShoppingItems,
  mergeShoppingItems,
  toShoppingListEntry,
} from "@generators/shopping/shopping";
import { useFreezer } from "@hooks/useFreezer";
import { useItemHistory } from "@hooks/useItemHistory";
import { useMealLibrary } from "@hooks/useMealLibrary";
import { useMeals } from "@hooks/useMeals";
import { useRecipes } from "@hooks/useRecipes";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { DAYS } from "@app-types/meal";
import type { DayKey, MealValue, WeekMeals } from "@app-types/meal";
import type { InnleggingsSkriveutfall } from "@data/shopping.repository";
import type { MergedShoppingItem, ShoppingItem } from "@app-types/shopping";
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

/**
 * «Legg til N varer» med ukjent utfall (Mat #20, ordre 6843084184). Planen
 * og `opId` er de innsendte, uendret: «Prøv igjen» sjekker kvitteringen for
 * samme `opId` uten å skrive, og «Send på nytt» sender samme operasjon, så
 * den aldri får virkning to ganger.
 */
interface Ventende {
  plan: GeneratorPlan;
  tekst: string;
  /** «Send på nytt» er trykket: venter på eksplisitt bekreftelse. */
  bekreftNy?: boolean;
  /** «Lukk» (eller skjemaet lukkes) er trykket: venter på eksplisitt bekreftelse. */
  bekreftLukk?: boolean;
}

/** Første innsending som ikke ble lagret — ingenting er skrevet. */
function avslagTekst(u: InnleggingsSkriveutfall): string {
  switch (u.utfall) {
    case "konflikt":
    case "ubekreftet":
      return `Ingenting er lagt til. ${u.grunn}`;
    case "avvist":
      return "Ingen tilgang til å lagre. Ingenting er lagt til.";
    case "ikkeLest":
      return "Kunne ikke lese handlelisten. Ingenting er lagt til — prøv igjen.";
    default:
      return "";
  }
}

/**
 * Et oppfølgingskall som ikke bekreftet noe. Sier aldri «ingenting er
 * lagt til»: det opprinnelige forsøket kan være lagret (samme regel som
 * sammenslåingen, review 5885013639).
 */
function oppfolgingsTekst(u: InnleggingsSkriveutfall): string {
  switch (u.utfall) {
    case "avvist":
      return "databasen nektet tilgang denne gangen.";
    case "ikkeLest":
      return "handlelisten kunne ikke leses denne gangen.";
    case "ukjent":
      return "svaret uteble igjen.";
    case "ubekreftet":
      return u.grunn;
    case "konflikt":
      return "Det siste forsøket ble stoppet før det skrev noe. Se handlelisten før du prøver igjen.";
    default:
      return "";
  }
}

const UKJENT_TEKST =
  "Vi vet ikke om varene ble lagt til — svaret uteble. «Prøv igjen» sjekker det samme forsøket uten å skrive noe, så varene aldri legges til to ganger.";

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

/** Hva innsendingen gjør mot listen slik den er nå — vist etter en konflikt. */
function EffektListe({ effekter }: { effekter: GeneratorEffekter }) {
  const endret = Object.values(effekter.endret);
  const uendret = Object.values(effekter.uendret);
  return (
    <div className={styles.melding} role="group" aria-label="Slik blir listen nå">
      <p className={styles.ventendeTekst}>Slik blir listen nå:</p>
      <ul className={styles.effektListe}>
        {endret.map((e) => (
          <li key={`e-${e.sett.name}-${e.sett.amount}`}>
            {e.sett.name}: {e.sett.amount} → {e.til} (legges sammen med raden på listen)
          </li>
        ))}
        {uendret.map((r) => (
          <li key={`u-${r.name}-${r.amount}`}>
            {r.name} står allerede på listen{r.amount ? ` (${r.amount})` : ""} og legges ikke til
          </li>
        ))}
        {effekter.nye.length > 0 && (
          <li>
            {effekter.nye.length === 1 ? "1 ny rad" : `${effekter.nye.length} nye rader`}:{" "}
            {effekter.nye.map((n) => n.rad.name).join(", ")}
          </li>
        )}
      </ul>
      <p className={styles.ventendeTekst}>Trykk «Legg til» igjen for å lagre dette.</p>
    </div>
  );
}

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
 * **«Legg til N varer» er én logisk operasjon** (Mat #20, ordre
 * 6843084184): planen lages fra listen slik den var da Helen trykket
 * (`lagGeneratorPlan`), med én stabil `opId`, og lagres med
 * `leggTilFraGenerator` — én versjonsbetinget skriving mot fersk
 * servertilstand med kvittering. Gir den ferske listen andre effekter enn
 * forhåndsvisningen, skrives ingenting, og Helen ber om ny gjennomgang.
 * Knappen er låst mens en innsending pågår (dobbeltklikk). Skjemaet lukkes
 * først ved bekreftet lagring eller Helens eget valg; ved ukjent utfall
 * står utkastet og et ventende varsel med «Prøv igjen» (skrivefritt),
 * «Send på nytt» og «Lukk» (begge med bekreftelse).
 *
 * **Kjøkken v1 — Matlager-bevissthet i gjennomgangen** (§Kontrolltårn-
 * handoff, Issue #20: "brukeren skal kunne justere hva hun faktisk
 * trenger før handlelisten ferdigstilles"): hver vare i gjennomgangs-
 * steget viser nå en ren INFORMASJONS-etikett (`freezerLabel`,
 * §domain/freezer/freezer.ts) når familien allerede har varen registrert
 * i Matlager/fryseren — samme mønster som Kokebokens `RecipeIngredients`
 * allerede viste for enkeltoppskrifter. Bevisst KUN informasjon: ingen
 * automatisk mengdejustering eller fjerning — brukeren bruker den
 * allerede eksisterende fjern-/rediger-flyten selv til å avgjøre. Dette
 * er derfor en ren visningsutvidelse av det eksisterende gjennomgangs-
 * steget, ikke en ny generator-/domenelogikk.
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
  const { shopping, leggTilFraGenerator } = useShoppingList();
  const { freezer } = useFreezer();

  const [step, setStep] = useState<"select" | "review">("select");
  const [checked, setChecked] = useState<Set<number> | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [staplePrompt, setStaplePrompt] = useState<{ id: string; name: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Record<EditField, string>>>>({});
  const [showStaples, setShowStaples] = useState(false);
  // Låsen settes synkront, så to klikk i samme tikk aldri sender to ganger.
  const laas = useRef(false);
  const [lagrer, setLagrer] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  /**
   * Grunnlaget planen bygger på: listen slik den var da gjennomgangen ble
   * åpnet — ikke det abonnementet viser når Helen trykker (review
   * 5912682963 pkt. 2). Endres listen i mellomtiden, avviser serveren
   * planen, og grunnlaget fornyes først etter at den nye effekten er vist.
   */
  const [grunnlag, setGrunnlag] = useState<ShoppingItem[] | null>(null);
  /** Effekten mot den fornyede listen, vist etter en konflikt før neste innsending. */
  const [nyEffekt, setNyEffekt] = useState<GeneratorEffekter | null>(null);
  const sisteListe = useRef<ShoppingItem[]>([]);
  if (shopping.status === "loaded") sisteListe.current = shopping.data;
  const [ventende, setVentende] = useState<Ventende | null>(null);

  /**
   * Lukker skjemaet bare når ingenting er uavklart: under lagring skjer
   * ingenting, og med et ventende forsøk må Helen bekrefte først.
   */
  const lukk = () => {
    if (laas.current) return;
    if (ventende) {
      setVentende({ ...ventende, bekreftNy: false, bekreftLukk: true });
      return;
    }
    onClose();
  };

  const ready =
    thisWeek.status === "loaded" &&
    nextWeek.status === "loaded" &&
    recipes.status === "loaded" &&
    mealLibrary.status === "loaded" &&
    itemHistory.status === "loaded" &&
    staples.status === "loaded" &&
    shopping.status === "loaded" &&
    freezer.status === "loaded";

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
      <Modal title="Lag handleliste" onClose={lukk}>
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
    setGrunnlag(shopping.data);
    setNyEffekt(null);
    setMelding(null);
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

  /** Sender planen; `modus` sier om det er første innsending eller en oppfølging av et ventende forsøk. */
  const send = async (plan: GeneratorPlan, modus: "ny" | "gjenta" | "send") => {
    if (laas.current) return;
    laas.current = true;
    setLagrer(true);
    setMelding(null);
    setNyEffekt(null);
    let u: InnleggingsSkriveutfall;
    try {
      u = await leggTilFraGenerator(plan, modus === "gjenta");
    } catch {
      // Uventet feil: vi vet ikke om noe ble skrevet.
      u = { utfall: "ukjent" };
    } finally {
      laas.current = false;
      setLagrer(false);
    }
    if (u.utfall === "anvendt" || u.utfall === "allerede") {
      setVentende(null);
      onClose();
      return;
    }
    if (modus !== "ny") {
      setVentende({ plan, tekst: `Fortsatt ikke bekreftet: ${oppfolgingsTekst(u)}` });
      return;
    }
    if (u.utfall === "ukjent") {
      setVentende({ plan, tekst: UKJENT_TEKST });
      return;
    }
    setMelding(avslagTekst(u));
    if (u.utfall === "konflikt") {
      // Ny gjennomgang: vis hva innsendingen gjør mot listen slik den er nå.
      // Neste «Legg til» er Helens bekreftelse og bygger på dette grunnlaget.
      const fersk = sisteListe.current;
      setGrunnlag(fersk);
      setNyEffekt(lagGeneratorPlan(fersk, plan.entries, "forhandsvisning").effekter);
    }
  };

  const addToList = () => {
    if (laas.current || ventende) return;
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
    void send(lagGeneratorPlan(grunnlag ?? [], toAdd, crypto.randomUUID()), "ny");
  };

  const normalItems = reviewItems.filter((i) => !i.isStaple);
  const stapleItems = reviewItems.filter((i) => i.isStaple);
  const activeCount = reviewItems.filter((i) => !removed.has(i.id)).length;
  const categoryOrder = sorterKategorier(normalItems.map((i) => i.cat));

  return (
    <Modal title="Lag handleliste" onClose={lukk}>
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
            <button type="button" onClick={lukk} className={styles.cancelButton}>
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
          <button
            type="button"
            onClick={() => setStep("select")}
            disabled={lagrer || ventende !== null}
            className={styles.backButton}
          >
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
                      const haveLabel = !rem ? freezerLabel(item.name, freezer.data) : null;
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
                            {haveLabel && <span className={styles.haveBadge}>{haveLabel}</span>}
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

          {melding && (
            <p className={styles.melding} role="alert">
              {melding}
            </p>
          )}
          {nyEffekt && <EffektListe effekter={nyEffekt} />}

          {ventende && (
            <div className={styles.ventende} role="alert" aria-label="Ikke bekreftet">
              <p className={styles.ventendeTekst}>{ventende.tekst}</p>
              {ventende.bekreftLukk ? (
                <>
                  <p className={styles.ventendeTekst}>
                    Sjekk handlelisten først. Lukker du, forkastes utkastet, og forsøket kan ikke
                    lenger avklares herfra.
                  </p>
                  <div className={styles.ventendeKnapper}>
                    <button
                      type="button"
                      className={styles.ventendeKnapp}
                      disabled={lagrer}
                      onClick={onClose}
                    >
                      Jeg har sjekket listen — lukk
                    </button>
                    <button
                      type="button"
                      className={styles.ventendeKnapp}
                      disabled={lagrer}
                      onClick={() => setVentende({ ...ventende, bekreftLukk: false })}
                    >
                      Ikke lukk
                    </button>
                  </div>
                </>
              ) : ventende.bekreftNy ? (
                <>
                  <p className={styles.ventendeTekst}>
                    Sjekk handlelisten først. Står varene der allerede, ble forrige forsøk lagret —
                    da skal du ikke sende på nytt.
                  </p>
                  <div className={styles.ventendeKnapper}>
                    <button
                      type="button"
                      className={styles.ventendeKnapp}
                      disabled={lagrer}
                      onClick={() => void send(ventende.plan, "send")}
                    >
                      Jeg har sjekket listen — send på nytt
                    </button>
                    <button
                      type="button"
                      className={styles.ventendeKnapp}
                      disabled={lagrer}
                      onClick={() => setVentende({ ...ventende, bekreftNy: false })}
                    >
                      Ikke send
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.ventendeKnapper}>
                  <button
                    type="button"
                    className={styles.ventendeKnapp}
                    disabled={lagrer}
                    onClick={() => void send(ventende.plan, "gjenta")}
                  >
                    Prøv igjen
                  </button>
                  <button
                    type="button"
                    className={styles.ventendeKnapp}
                    disabled={lagrer}
                    onClick={() => setVentende({ ...ventende, bekreftNy: true })}
                  >
                    Send på nytt
                  </button>
                  <button
                    type="button"
                    className={styles.ventendeKnapp}
                    disabled={lagrer}
                    onClick={() => setVentende({ ...ventende, bekreftLukk: true })}
                  >
                    Lukk
                  </button>
                </div>
              )}
            </div>
          )}

          <div className={styles.actionsRow}>
            <button type="button" onClick={lukk} disabled={lagrer} className={styles.cancelButton}>
              Avbryt
            </button>
            <button
              type="button"
              onClick={addToList}
              disabled={lagrer || ventende !== null}
              aria-busy={lagrer}
              className={styles.primaryButton}
            >
              Legg til {activeCount} varer →
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
