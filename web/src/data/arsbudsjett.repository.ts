/**
 * Datalag for Årsbudsjett sin egen node (`families/{familyId}/
 * annualBudgetPlans/{year}/{type}`) — KUN for år som ikke er
 * inneværende budsjettår. Inneværende år bruker fortsatt
 * `budget`/`incomeGroups`/`sparingGroups` direkte via
 * `budsjettfamilie.repository.ts` (§Kontrolltårn-beslutning, Issue #34,
 * kommentar 5819881461: "Ingen ny whole-node setter" — se den filens
 * budgetDetails-funksjoner for det speilbildet av dette datalaget).
 *
 * Skrivemønster: samme prinsipp som `budsjettfamilie.repository.ts` —
 * målrettede per-felt-skrivinger der det er mulig (`updateAnnualItemMonth`
 * er et `set()` på nøyaktig `.../months/{i}/budget`, akkurat som
 * `updateItemMonth`). Firebase RTDB oppretter selv manglende
 * mellomliggende noder ved `set()`/`update()` — det trengs derfor INGEN
 * eksplisitt "opprett årsplanen første gang"-skriving her. Dette er en
 * bevisst, dokumentert forenkling fra legacy sin `hentSetter`, som alltid
 * committer en fullstendig, forhåndsbygget scaffold (§index.html linje
 * 13502–13514, `byggTomAarsplanFraStruktur`) til Firebase ved FØRSTE
 * redigering av ÅRET, uansett hvilken post som faktisk ble redigert.
 * Denne porten skriver i stedet KUN det feltet som faktisk endres — en
 * post som aldri redigeres får derfor aldri en fysisk Firebase-oppføring
 * (heller ikke en forhåndsseedet detalj-struktur), men er UOBSERVERBAR
 * forskjell fra brukerens ståsted: `flettAarsplanMedStruktur` (§domain/
 * arsbudsjett/arsbudsjett.ts) håndterer allerede en post uten plan-data
 * ved å vise 0×12 — nøyaktig samme resultat som legacy sin forhåndsseedede,
 * men urørte post ville vist. Selve "vis en detalj-scaffold FØR noe er
 * lagret"-oppførselen (for et år som ikke har noen plan ennå) er et
 * rent VISNINGS-ansvar i hook-laget (`useArsbudsjett`), som beregner en
 * midlertidig, IKKE-lagret visning via `byggTomAarsplanFraStruktur` —
 * nøyaktig samme rolle som legacy sin in-memory `hentGroups()` har før
 * første faktiske redigering.
 *
 * `budgetDetails`-funksjonene under er transaksjoner PÅ ÉN POST (samme
 * mønster/begrunnelse som `budsjettfamilie.repository.ts` sine — en
 * detalj-endring krever alltid ny summering av foreldrepostens
 * `months`, som ikke kan uttrykkes som en enkelt feltskriving).
 *
 * `updateAnnualPlanSliceTransactional` er den ENESTE måten å endre HELE
 * år+type-skiven på (§Kontrolltårn-review, PR #38: en tidligere versjon
 * gjorde dette med et rått `set()` av en skive beregnet fra et
 * React-snapshot som kunne være foreldet ved commit-tidspunkt — samme
 * klasse stale-state-problem som ble fjernet fra Budsjett-familien sin
 * `removeItem` i PR #36. `updater`-callbacken mottar i stedet den
 * FAKTISKE, ferske server-skiven (Firebase kjører den på nytt automatisk
 * ved konflikt), så en samtidig endring fra en annen klient/fane ALDRI
 * overskrives av en handling som startet før den endringen skjedde).
 */
import { onValue, ref, runTransaction, set, update } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { BudgetDetail } from "@app-types/budsjettfamilie";
import type { AnnualPlanSlice, AnnualPlanType, AnnualPlansByYear } from "@app-types/arsbudsjett";

function plansRootPath(familyId: FamilyId): string {
  return `families/${familyId}/annualBudgetPlans`;
}

function sliceRootPath(familyId: FamilyId, year: number, type: AnnualPlanType): string {
  return `${plansRootPath(familyId)}/${year}/${type}`;
}

function annualItemPath(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
): string {
  return `${sliceRootPath(familyId, year, type)}/${groupId}/${itemId}`;
}

const tolvTommeDetaljMaaneder = (): { budget: number }[] =>
  Array.from({ length: 12 }, () => ({ budget: 0 }));

/**
 * Samme invariant som domenelagets `summerBudgetDetails` — duplisert her
 * av samme grunn som i `budsjettfamilie.repository.ts` (`data/` kan ikke
 * importere fra `domain/`, §web/eslint.config.js).
 */
function summerDetaljerTilMaaneder(
  budgetDetails: BudgetDetail[] | undefined,
): { budget: number }[] {
  return Array.from({ length: 12 }, (_, mi) => ({
    budget: (budgetDetails ?? []).reduce((s, d) => s + (d.months[mi]?.budget ?? 0), 0),
  }));
}

function parseAnnualPlanEntry(raw: unknown): {
  months: { budget: number }[];
  budgetDetails?: BudgetDetail[];
} {
  const fields = (raw ?? {}) as Record<string, unknown>;
  const monthsRaw = (fields.months ?? {}) as Record<number, { budget?: number }>;
  const months = Array.from({ length: 12 }, (_, i) => ({ budget: monthsRaw[i]?.budget ?? 0 }));
  const budgetDetailsRaw = fields.budgetDetails as
    { id: string; name: string; months?: Record<number, { budget?: number }> }[] | undefined;
  const budgetDetails: BudgetDetail[] | undefined = budgetDetailsRaw?.map((d) => ({
    id: d.id,
    name: d.name,
    months: Array.from({ length: 12 }, (_, i) => ({ budget: d.months?.[i]?.budget ?? 0 })),
  }));
  return { months, ...(budgetDetails && budgetDetails.length > 0 ? { budgetDetails } : {}) };
}

function parseAnnualPlanSlice(raw: unknown): AnnualPlanSlice {
  const rawObj = (raw ?? {}) as Record<string, Record<string, unknown>>;
  const slice: AnnualPlanSlice = {};
  Object.keys(rawObj).forEach((groupId) => {
    const gruppeRaw = rawObj[groupId] ?? {};
    const gruppe: AnnualPlanSlice[string] = {};
    Object.keys(gruppeRaw).forEach((itemId) => {
      gruppe[itemId] = parseAnnualPlanEntry(gruppeRaw[itemId]);
    });
    slice[groupId] = gruppe;
  });
  return slice;
}

/**
 * Parser rå Firebase-form til `AnnualPlansByYear`. Manglende
 * år/type-kombinasjoner er ganske enkelt fraværende nøkler (aldri en
 * feil) — en post/type/år uten data betyr kun "ingen redigering har
 * skjedd der ennå", se filens toppkommentar.
 */
export function parseAnnualPlans(raw: unknown): AnnualPlansByYear {
  const rawObj = (raw ?? {}) as Record<string, Record<string, unknown>>;
  const plans: AnnualPlansByYear = {};
  Object.keys(rawObj).forEach((yearKey) => {
    const year = Number.parseInt(yearKey, 10);
    if (Number.isNaN(year)) return;
    const typerRaw = rawObj[yearKey] ?? {};
    const typer: Partial<Record<AnnualPlanType, AnnualPlanSlice>> = {};
    (["costs", "income", "savings"] as const).forEach((type) => {
      if (Object.prototype.hasOwnProperty.call(typerRaw, type)) {
        typer[type] = parseAnnualPlanSlice(typerRaw[type]);
      }
    });
    plans[year] = typer;
  });
  return plans;
}

/** Abonnerer på HELE `annualBudgetPlans`-noden (alle år, alle typer). */
export function subscribeAnnualPlans(
  familyId: FamilyId,
  onChange: (plans: AnnualPlansByYear) => void,
): () => void {
  const nodeRef = ref(getFirebaseDatabase(), plansRootPath(familyId));
  return onValue(nodeRef, (snapshot) => {
    onChange(parseAnnualPlans(snapshot.exists() ? snapshot.val() : null));
  });
}

/** Speiler `updMonth`/`updIncMonth`/`updSparingMonth` sin ikke-inneværende-års-gren via `hentSetter`. */
export async function updateAnnualItemMonth(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
  monthIndex: number,
  value: number,
): Promise<void> {
  await set(
    ref(
      getFirebaseDatabase(),
      `${annualItemPath(familyId, year, type, groupId, itemId)}/months/${monthIndex}/budget`,
    ),
    value,
  );
}

/** Speiler `fordelArskostnad` sin ikke-inneværende-års-gren. Kun for poster UTEN detaljer. */
export async function spreadAnnualYearlyAmount(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
  totalAmount: number,
): Promise<void> {
  const total = totalAmount || 0;
  const perManed = Math.floor(total / 12);
  const diff = total - perManed * 12;
  const base = annualItemPath(familyId, year, type, groupId, itemId);
  const updates: Record<string, number> = {};
  for (let mi = 0; mi < 12; mi += 1) {
    updates[`${base}/months/${mi}/budget`] = mi === 11 ? perManed + diff : perManed;
  }
  await update(ref(getFirebaseDatabase()), updates);
}

/** Speiler `anvendResten` sin ikke-inneværende-års-gren uten `detaljId`. Kun for poster UTEN detaljer. */
export async function applyAnnualRestOfYear(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
  fromMonthIndex: number,
  value: number,
): Promise<void> {
  const base = annualItemPath(familyId, year, type, groupId, itemId);
  const updates: Record<string, number> = {};
  for (let mi = fromMonthIndex; mi < 12; mi += 1) {
    updates[`${base}/months/${mi}/budget`] = value;
  }
  await update(ref(getFirebaseDatabase()), updates);
}

/** Speiler `aktiverDetaljer` for et ikke-inneværende år. No-op om posten allerede har detaljer. */
export async function activateAnnualBudgetDetails(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), annualItemPath(familyId, year, type, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      const eksisterende = current?.budgetDetails as BudgetDetail[] | undefined;
      if (eksisterende && eksisterende.length > 0) return current;
      const nyDetalj: BudgetDetail = {
        id: crypto.randomUUID(),
        name: "Ny detalj",
        months: tolvTommeDetaljMaaneder(),
      };
      return { budgetDetails: [nyDetalj], months: summerDetaljerTilMaaneder([nyDetalj]) };
    },
  );
}

/** Speiler `fjernDetaljniva` for et ikke-inneværende år — §10: dagens summerte `months` beholdes. */
export async function removeAnnualBudgetDetailLevel(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
): Promise<void> {
  await update(ref(getFirebaseDatabase(), annualItemPath(familyId, year, type, groupId, itemId)), {
    budgetDetails: null,
  });
}

/** Speiler `leggTilDetalj` for et ikke-inneværende år. */
export async function addAnnualBudgetDetail(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), annualItemPath(familyId, year, type, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      const eksisterende = (current?.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyDetalj: BudgetDetail = {
        id: crypto.randomUUID(),
        name: "Ny detalj",
        months: tolvTommeDetaljMaaneder(),
      };
      const nyeDetaljer = [...eksisterende, nyDetalj];
      return {
        ...current,
        budgetDetails: nyeDetaljer,
        months: summerDetaljerTilMaaneder(nyeDetaljer),
      };
    },
  );
}

/** Speiler `endreDetaljNavn` for et ikke-inneværende år. */
export async function renameAnnualBudgetDetail(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
  detailId: string,
  name: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), annualItemPath(familyId, year, type, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      const eksisterende = (current?.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyeDetaljer = eksisterende.map((d) => (d.id !== detailId ? d : { ...d, name }));
      return { ...current, budgetDetails: nyeDetaljer };
    },
  );
}

/** Speiler `slettDetalj` for et ikke-inneværende år (ikke den siste — se `removeAnnualBudgetDetailLevel`). */
export async function removeAnnualBudgetDetail(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
  detailId: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), annualItemPath(familyId, year, type, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      const eksisterende = (current?.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyeDetaljer = eksisterende.filter((d) => d.id !== detailId);
      return {
        ...current,
        budgetDetails: nyeDetaljer,
        months: summerDetaljerTilMaaneder(nyeDetaljer),
      };
    },
  );
}

/** Speiler `updDetaljMonth` for et ikke-inneværende år. */
export async function updateAnnualBudgetDetailMonth(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
  detailId: string,
  monthIndex: number,
  value: number,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), annualItemPath(familyId, year, type, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      const eksisterende = (current?.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyeDetaljer = eksisterende.map((d) =>
        d.id !== detailId
          ? d
          : {
              ...d,
              months: d.months.map((mo, mi) => (mi !== monthIndex ? mo : { budget: value })),
            },
      );
      return {
        ...current,
        budgetDetails: nyeDetaljer,
        months: summerDetaljerTilMaaneder(nyeDetaljer),
      };
    },
  );
}

/** Speiler `anvendResten` sin `detaljId`-gren for et ikke-inneværende år. */
export async function applyAnnualRestOfYearToDetail(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  groupId: string,
  itemId: string,
  detailId: string,
  fromMonthIndex: number,
  value: number,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), annualItemPath(familyId, year, type, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      const eksisterende = (current?.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyeDetaljer = eksisterende.map((d) =>
        d.id !== detailId
          ? d
          : {
              ...d,
              months: d.months.map((mo, mi) => (mi < fromMonthIndex ? mo : { budget: value })),
            },
      );
      return {
        ...current,
        budgetDetails: nyeDetaljer,
        months: summerDetaljerTilMaaneder(nyeDetaljer),
      };
    },
  );
}

/**
 * Kjører en transaksjonell les-modifiser-skriv på HELE årsplan-skiven for
 * ett år+type — brukes av den guardede, brukerbekreftede "Hent manglende
 * detaljer"-handlingen (§index.html linje 13525–13539,
 * `kjorHentManglendeDetaljer`). Kalleren (hook-laget, som har lov til å
 * importere `domain/`) sender inn en `updater` som beregner den nye
 * skiven FRA `current` — den faktiske server-skiven ved commit-
 * tidspunkt, ikke et tidligere lest React-snapshot (§filens toppkommentar
 * for hvorfor). Samme atomicitetsenhet/begrunnelse som Spillerom sin
 * `regenerateLiquidityPosts` (én eksplisitt, sjelden brukerhandling, ikke
 * en per-tastetrykk-skrivevei) — men transaksjonell i stedet for et rått
 * `set()`, nettopp fordi denne handlingen leser OG skriver samme skive.
 */
export async function updateAnnualPlanSliceTransactional(
  familyId: FamilyId,
  year: number,
  type: AnnualPlanType,
  updater: (current: AnnualPlanSlice) => AnnualPlanSlice,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), sliceRootPath(familyId, year, type)),
    (raw: unknown) => updater(parseAnnualPlanSlice(raw)),
  );
}
