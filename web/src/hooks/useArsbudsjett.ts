import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activateBudgetDetails as repoActivateBudgetDetails,
  addBudgetDetail as repoAddBudgetDetail,
  applyRestOfYear as repoApplyRestOfYear,
  applyRestOfYearToDetail as repoApplyRestOfYearToDetail,
  removeBudgetDetail as repoRemoveBudgetDetail,
  removeBudgetDetailLevel as repoRemoveBudgetDetailLevel,
  renameBudgetDetail as repoRenameBudgetDetail,
  saveItemMeta as repoSaveItemMeta,
  spreadYearlyAmount as repoSpreadYearlyAmount,
  subscribeBudgetGroups,
  subscribeIncomeGroups,
  subscribeSparingGroups,
  updateBudgetDetailMonth as repoUpdateBudgetDetailMonth,
  updateItemMonth as repoUpdateItemMonth,
} from "@data/budsjettfamilie.repository";
import {
  activateAnnualBudgetDetails as repoActivateAnnualBudgetDetails,
  addAnnualBudgetDetail as repoAddAnnualBudgetDetail,
  applyAnnualRestOfYear as repoApplyAnnualRestOfYear,
  applyAnnualRestOfYearToDetail as repoApplyAnnualRestOfYearToDetail,
  removeAnnualBudgetDetail as repoRemoveAnnualBudgetDetail,
  removeAnnualBudgetDetailLevel as repoRemoveAnnualBudgetDetailLevel,
  renameAnnualBudgetDetail as repoRenameAnnualBudgetDetail,
  spreadAnnualYearlyAmount as repoSpreadAnnualYearlyAmount,
  subscribeAnnualPlans,
  updateAnnualBudgetDetailMonth as repoUpdateAnnualBudgetDetailMonth,
  updateAnnualItemMonth as repoUpdateAnnualItemMonth,
  updateAnnualPlanSliceTransactional,
} from "@data/arsbudsjett.repository";
import {
  byggTomAarsplanFraStruktur,
  finnNaermesteForegaaendeAar,
  flettAarsplanMedStruktur,
  hentManglendeDetaljerFraKilde,
  konverterGroupsTilFlatPlan,
} from "@domain/arsbudsjett/arsbudsjett";
import { currentBudgetYear as beregnCurrentBudgetYear } from "@domain/budsjettfamilie/budsjettfamilie";
import type { AnnualPlanSlice, AnnualPlanType, AnnualPlansByYear } from "@app-types/arsbudsjett";
import type { BudsjettfamilieNode, BudsjettGruppe, PostMeta } from "@app-types/budsjettfamilie";
import { type Loadable, loaded, loading } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

/** Legacy sin type-vokabular ("kostnad"/"inntekt"/"sparing") — se `ANNUAL_TYPE`/`strukturForType`, §index.html linje 13477–13478. */
export type ArsbudsjettPostType = "kostnad" | "inntekt" | "sparing";

const NODE_FOR_TYPE: Record<ArsbudsjettPostType, BudsjettfamilieNode> = {
  kostnad: "budget",
  inntekt: "incomeGroups",
  sparing: "sparingGroups",
};
const ANNUAL_TYPE_FOR_TYPE: Record<ArsbudsjettPostType, AnnualPlanType> = {
  kostnad: "costs",
  inntekt: "income",
  sparing: "savings",
};

interface Grupper {
  kostnader: BudsjettGruppe[];
  inntekter: BudsjettGruppe[];
  sparing: BudsjettGruppe[];
}

export interface UseArsbudsjettResult {
  currentBudgetYear: number;
  valgtAar: number;
  gaTilForrigeAar: () => void;
  gaTilNesteAar: () => void;
  grupper: Loadable<Grupper>;
  /** Gruppene for `type`, slått sammen for `valgtAar` — 0×12 for poster uten plan-data. */
  hentGroups: (type: ArsbudsjettPostType) => BudsjettGruppe[];
  /**
   * Året "Hent manglende detaljer"-handlingen ville hentet fra, eller
   * `null` når knappen ikke skal vises — samme guard som legacy
   * (§index.html linje 13830): kun for et ikke-inneværende år SOM
   * ALLEREDE har en eksisterende plan, og kun når en tidligere
   * detaljkilde faktisk finnes.
   */
  hentManglendeDetaljerKildeAar: number | null;
  hentManglendeDetaljer: () => Promise<void>;
  updateMonth: (
    type: ArsbudsjettPostType,
    groupId: string,
    itemId: string,
    monthIndex: number,
    value: number,
  ) => Promise<void>;
  spreadYear: (
    type: ArsbudsjettPostType,
    groupId: string,
    itemId: string,
    totalAmount: number,
  ) => Promise<void>;
  applyRestOfYear: (
    type: ArsbudsjettPostType,
    groupId: string,
    itemId: string,
    fromMonthIndex: number,
    value: number,
  ) => Promise<void>;
  applyRestOfYearToDetail: (
    type: ArsbudsjettPostType,
    groupId: string,
    itemId: string,
    detailId: string,
    fromMonthIndex: number,
    value: number,
  ) => Promise<void>;
  activateDetails: (type: ArsbudsjettPostType, groupId: string, itemId: string) => Promise<void>;
  addDetail: (type: ArsbudsjettPostType, groupId: string, itemId: string) => Promise<void>;
  renameDetail: (
    type: ArsbudsjettPostType,
    groupId: string,
    itemId: string,
    detailId: string,
    name: string,
  ) => Promise<void>;
  updateDetailMonth: (
    type: ArsbudsjettPostType,
    groupId: string,
    itemId: string,
    detailId: string,
    monthIndex: number,
    value: number,
  ) => Promise<void>;
  removeDetail: (
    type: ArsbudsjettPostType,
    groupId: string,
    itemId: string,
    detailId: string,
  ) => Promise<void>;
  removeDetailLevel: (type: ArsbudsjettPostType, groupId: string, itemId: string) => Promise<void>;
  /**
   * Endrer betalingsmønster (`meta.paymentPattern`) — skriver ALLTID til
   * live `budget`-noden uansett `valgtAar`, samme (bevisste) legacy-
   * kontrakt: `meta` er årsuavhengig strukturdata (§domain/arsbudsjett/
   * arsbudsjett.ts sin toppkommentar). Speiler `updPaymentPattern`
   * (§index.html linje 13783–13787). KUN kostnad — legacy-signaturen har
   * ingen tilsvarende for inntekt/sparing.
   */
  updatePaymentPattern: (groupId: string, itemId: string, pattern: string) => Promise<void>;
}

/**
 * React-binding for Årsbudsjett. Bevisst delt fra `useBudsjettfamilie` —
 * Årsbudsjett trenger `budgetGroups`/`incomeGroups`/`sparingGroups`
 * SAMTIDIG (Helhet-visningen), pluss hele `annualBudgetPlans`-noden, og
 * har sin egen årsvalg-state.
 *
 * For `valgtAar===currentBudgetYear`: skriver til `budget`/`incomeGroups`/
 * `sparingGroups` via `budsjettfamilie.repository.ts` — SAMME noder og
 * samme målrettede skrivekontrakt som Budsjett-familien-sliven allerede
 * eier (§Kontrolltårn-beslutning, Issue #34, kommentar 5819881461: "Ingen
 * ny whole-node setter"). For andre år: skriver til
 * `annualBudgetPlans/{år}/{type}` via `arsbudsjett.repository.ts`.
 */
export function useArsbudsjett(): UseArsbudsjettResult {
  const familyId = useFamilyId();
  const currentYear = useMemo(() => beregnCurrentBudgetYear(new Date()), []);

  const [kostnader, setKostnader] = useState<BudsjettGruppe[] | null>(null);
  const [inntekter, setInntekter] = useState<BudsjettGruppe[] | null>(null);
  const [sparing, setSparing] = useState<BudsjettGruppe[] | null>(null);
  const [annualPlans, setAnnualPlans] = useState<AnnualPlansByYear | null>(null);
  const [valgtAar, setValgtAar] = useState(currentYear);

  useEffect(() => subscribeBudgetGroups(familyId, setKostnader), [familyId]);
  useEffect(() => subscribeIncomeGroups(familyId, setInntekter), [familyId]);
  useEffect(() => subscribeSparingGroups(familyId, setSparing), [familyId]);
  useEffect(() => subscribeAnnualPlans(familyId, setAnnualPlans), [familyId]);

  const grupper: Loadable<Grupper> = useMemo(() => {
    if (kostnader === null || inntekter === null || sparing === null || annualPlans === null) {
      return loading;
    }
    return loaded({ kostnader, inntekter, sparing });
  }, [kostnader, inntekter, sparing, annualPlans]);

  const struktur = useCallback(
    (type: ArsbudsjettPostType): BudsjettGruppe[] =>
      type === "inntekt"
        ? (inntekter ?? [])
        : type === "sparing"
          ? (sparing ?? [])
          : (kostnader ?? []),
    [kostnader, inntekter, sparing],
  );

  const annualPlanAarForType = useCallback(
    (type: ArsbudsjettPostType): number[] =>
      Object.entries(annualPlans ?? {})
        .filter(([, typer]) => typer[ANNUAL_TYPE_FOR_TYPE[type]] !== undefined)
        .map(([aar]) => Number.parseInt(aar, 10)),
    [annualPlans],
  );

  const hentDetaljkilde = useCallback(
    (type: ArsbudsjettPostType, maalAar: number): AnnualPlanSlice | undefined => {
      if (type === "sparing") return undefined; // §11: Sparing har aldri detaljstøtte
      const kildeAar = finnNaermesteForegaaendeAar(
        maalAar,
        annualPlanAarForType(type),
        currentYear,
      );
      if (kildeAar === null) return undefined;
      if (kildeAar === currentYear) return konverterGroupsTilFlatPlan(struktur(type));
      return annualPlans?.[kildeAar]?.[ANNUAL_TYPE_FOR_TYPE[type]];
    },
    [annualPlanAarForType, annualPlans, currentYear, struktur],
  );

  const hentGroups = useCallback(
    (type: ArsbudsjettPostType): BudsjettGruppe[] => {
      const grupperForType = struktur(type);
      if (valgtAar === currentYear) return grupperForType;
      const eksisterendePlan = annualPlans?.[valgtAar]?.[ANNUAL_TYPE_FOR_TYPE[type]];
      const plan =
        eksisterendePlan ??
        byggTomAarsplanFraStruktur(grupperForType, hentDetaljkilde(type, valgtAar));
      return flettAarsplanMedStruktur(grupperForType, plan);
    },
    [annualPlans, currentYear, hentDetaljkilde, struktur, valgtAar],
  );

  const gaTilForrigeAar = useCallback(() => {
    setValgtAar((a) => Math.max(a - 1, currentYear - 1));
  }, [currentYear]);
  const gaTilNesteAar = useCallback(() => {
    setValgtAar((a) => Math.min(a + 1, currentYear + 5));
  }, [currentYear]);

  const hentManglendeDetaljerKildeAar = useMemo(() => {
    if (valgtAar === currentYear) return null;
    if (!annualPlans?.[valgtAar]) return null; // §index.html linje 13830: kun for et år som allerede har en plan
    return finnNaermesteForegaaendeAar(valgtAar, annualPlanAarForType("kostnad"), currentYear);
  }, [annualPlanAarForType, annualPlans, currentYear, valgtAar]);

  const hentManglendeDetaljer = useCallback(async () => {
    const kildeAar = hentManglendeDetaljerKildeAar;
    if (kildeAar === null) return;
    await Promise.all(
      (["kostnad", "inntekt"] as const).map(async (type) => {
        const grupperForType = struktur(type);
        const detaljkilde =
          kildeAar === currentYear
            ? konverterGroupsTilFlatPlan(grupperForType)
            : (annualPlans?.[kildeAar]?.[ANNUAL_TYPE_FOR_TYPE[type]] ?? {});
        // v-mat-varebase-1.1-presisering (§Kontrolltårn-review, PR #38):
        // `current` her er den FAKTISKE server-skiven ved commit-
        // tidspunkt (Firebase kjører updateren på nytt ved konflikt) —
        // ALDRI `annualPlans` sitt React-snapshot, som kan være foreldet
        // om en annen fane/klient skrev til samme år+type mellom
        // knappetrykket og commit. Se `updateAnnualPlanSliceTransactional`
        // sin dokumentasjon i arsbudsjett.repository.ts.
        await updateAnnualPlanSliceTransactional(
          familyId,
          valgtAar,
          ANNUAL_TYPE_FOR_TYPE[type],
          (current) => hentManglendeDetaljerFraKilde(current, grupperForType, detaljkilde),
        );
      }),
    );
  }, [currentYear, familyId, hentManglendeDetaljerKildeAar, struktur, valgtAar, annualPlans]);

  const nodeAndYear = useCallback(
    (type: ArsbudsjettPostType) => ({
      erInneverendeAar: valgtAar === currentYear,
      node: NODE_FOR_TYPE[type],
      annualType: ANNUAL_TYPE_FOR_TYPE[type],
    }),
    [currentYear, valgtAar],
  );

  const updateMonth = useCallback(
    async (
      type: ArsbudsjettPostType,
      groupId: string,
      itemId: string,
      monthIndex: number,
      value: number,
    ) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoUpdateItemMonth(familyId, node, groupId, itemId, monthIndex, "budget", value);
      } else {
        await repoUpdateAnnualItemMonth(
          familyId,
          valgtAar,
          annualType,
          groupId,
          itemId,
          monthIndex,
          value,
        );
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const spreadYear = useCallback(
    async (type: ArsbudsjettPostType, groupId: string, itemId: string, totalAmount: number) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoSpreadYearlyAmount(familyId, node, groupId, itemId, totalAmount);
      } else {
        await repoSpreadAnnualYearlyAmount(
          familyId,
          valgtAar,
          annualType,
          groupId,
          itemId,
          totalAmount,
        );
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const applyRestOfYear = useCallback(
    async (
      type: ArsbudsjettPostType,
      groupId: string,
      itemId: string,
      fromMonthIndex: number,
      value: number,
    ) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoApplyRestOfYear(familyId, node, groupId, itemId, fromMonthIndex, value);
      } else {
        await repoApplyAnnualRestOfYear(
          familyId,
          valgtAar,
          annualType,
          groupId,
          itemId,
          fromMonthIndex,
          value,
        );
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const applyRestOfYearToDetail = useCallback(
    async (
      type: ArsbudsjettPostType,
      groupId: string,
      itemId: string,
      detailId: string,
      fromMonthIndex: number,
      value: number,
    ) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoApplyRestOfYearToDetail(
          familyId,
          node,
          groupId,
          itemId,
          detailId,
          fromMonthIndex,
          value,
        );
      } else {
        await repoApplyAnnualRestOfYearToDetail(
          familyId,
          valgtAar,
          annualType,
          groupId,
          itemId,
          detailId,
          fromMonthIndex,
          value,
        );
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const activateDetails = useCallback(
    async (type: ArsbudsjettPostType, groupId: string, itemId: string) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoActivateBudgetDetails(familyId, node, groupId, itemId);
      } else {
        await repoActivateAnnualBudgetDetails(familyId, valgtAar, annualType, groupId, itemId);
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const addDetail = useCallback(
    async (type: ArsbudsjettPostType, groupId: string, itemId: string) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoAddBudgetDetail(familyId, node, groupId, itemId);
      } else {
        await repoAddAnnualBudgetDetail(familyId, valgtAar, annualType, groupId, itemId);
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const renameDetail = useCallback(
    async (
      type: ArsbudsjettPostType,
      groupId: string,
      itemId: string,
      detailId: string,
      name: string,
    ) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoRenameBudgetDetail(familyId, node, groupId, itemId, detailId, name);
      } else {
        await repoRenameAnnualBudgetDetail(
          familyId,
          valgtAar,
          annualType,
          groupId,
          itemId,
          detailId,
          name,
        );
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const updateDetailMonth = useCallback(
    async (
      type: ArsbudsjettPostType,
      groupId: string,
      itemId: string,
      detailId: string,
      monthIndex: number,
      value: number,
    ) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoUpdateBudgetDetailMonth(
          familyId,
          node,
          groupId,
          itemId,
          detailId,
          monthIndex,
          value,
        );
      } else {
        await repoUpdateAnnualBudgetDetailMonth(
          familyId,
          valgtAar,
          annualType,
          groupId,
          itemId,
          detailId,
          monthIndex,
          value,
        );
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const removeDetail = useCallback(
    async (type: ArsbudsjettPostType, groupId: string, itemId: string, detailId: string) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoRemoveBudgetDetail(familyId, node, groupId, itemId, detailId);
      } else {
        await repoRemoveAnnualBudgetDetail(
          familyId,
          valgtAar,
          annualType,
          groupId,
          itemId,
          detailId,
        );
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const removeDetailLevel = useCallback(
    async (type: ArsbudsjettPostType, groupId: string, itemId: string) => {
      const { erInneverendeAar, node, annualType } = nodeAndYear(type);
      if (erInneverendeAar) {
        await repoRemoveBudgetDetailLevel(familyId, node, groupId, itemId);
      } else {
        await repoRemoveAnnualBudgetDetailLevel(familyId, valgtAar, annualType, groupId, itemId);
      }
    },
    [familyId, nodeAndYear, valgtAar],
  );

  const updatePaymentPattern = useCallback(
    async (groupId: string, itemId: string, pattern: string) => {
      const post = (kostnader ?? [])
        .find((g) => g.id === groupId)
        ?.items.find((it) => it.id === itemId);
      const meta: PostMeta = { ...(post?.meta ?? {}), paymentPattern: pattern };
      await repoSaveItemMeta(familyId, "budget", groupId, itemId, meta);
    },
    [familyId, kostnader],
  );

  return {
    currentBudgetYear: currentYear,
    valgtAar,
    gaTilForrigeAar,
    gaTilNesteAar,
    grupper,
    hentGroups,
    hentManglendeDetaljerKildeAar,
    hentManglendeDetaljer,
    updateMonth,
    spreadYear,
    applyRestOfYear,
    applyRestOfYearToDetail,
    activateDetails,
    addDetail,
    renameDetail,
    updateDetailMonth,
    removeDetail,
    removeDetailLevel,
    updatePaymentPattern,
  };
}
