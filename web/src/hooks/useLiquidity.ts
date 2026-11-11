import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addLiquidityPost,
  regenerateLiquidityPosts,
  removeLiquidityPost,
  saveLiquidityPrognosisDate,
  saveLiquiditySaldo,
  setLiquidityPostFulfilled,
  subscribeForecastInputs,
  subscribeLiquidity,
  updateLiquidityPost,
} from "@data/liquidity.repository";
import { type ForfallsdagMangel, finnForfallsdagMangler } from "@domain/liquidity/forfallsdag";
import { effektivPrognosedato, generateForecastPosts } from "@domain/liquidity/liquidity";
import type { ForecastGroup, Liquidity, LiquidityPost } from "@app-types/liquidity";
import { type Loadable, loadError, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseLiquidityResult {
  liquidity: Loadable<Liquidity>;
  saveSaldo: (saldo: number) => Promise<void>;
  savePrognosisDate: (prognosisDate: string) => Promise<void>;
  addPost: (fields: Omit<LiquidityPost, "id" | "kilde">) => Promise<void>;
  removePost: (id: string) => Promise<void>;
  markFulfilled: (id: string) => Promise<void>;
  unmarkFulfilled: (id: string) => Promise<void>;
  /**
   * Redigerer en post. Med `grunnlag` (verdiene da redigeringen startet)
   * avvises lagringen med `LikviditetKonflikt` hvis et av feltene er endret
   * på serveren i mellomtiden (samtidighet, #59).
   */
  editPost: (
    id: string,
    patch: Partial<LiquidityPost>,
    grunnlag?: Partial<LiquidityPost>,
  ) => Promise<void>;
  regenerate: () => Promise<void>;
  /** Feil fra siste automatiske eller manuelle regenerering (null = ingen). */
  prognosefeil: string | null;
  /**
   * Automatiske kilder uten gyldig forfallsdag (funn F). Skrivefri
   * diagnostikk: `loaded` først når alle tre kildene har svart, `error`
   * når en lytter avvises. Nullstilles ved familiebytte.
   */
  forfallsdagMangler: Loadable<ForfallsdagMangel[]>;
}

interface ForecastInputs {
  budgetGroups: ForecastGroup[];
  incomeGroups: ForecastGroup[];
  sparingGroups: ForecastGroup[];
}

const EMPTY_FORECAST_INPUTS: ForecastInputs = {
  budgetGroups: [],
  incomeGroups: [],
  sparingGroups: [],
};

/**
 * React-binding for Spillerom (`liquidity`). Speiler `SpilleromScreen`
 * sin state-/skrivelogikk (§index.html linje 10381–10556) — se
 * data/liquidity.repository.ts for skrivemønsteret per operasjon.
 *
 * `regenerate()` er den porterte `runGenerator` (§index.html linje
 * 10403–10416): kjører alltid mot FERSKESTE `liquidity`/forecast-input-
 * data fra abonnementene, aldri en potensielt utdatert closure-verdi.
 */
export function useLiquidity(): UseLiquidityResult {
  const familyId = useFamilyId();
  const [liquidity, setLiquidityState] = useState<Loadable<Liquidity>>(notLoaded);
  const [forecastInputs, setForecastInputs] = useState<ForecastInputs>(EMPTY_FORECAST_INPUTS);
  const [prognosefeil, setPrognosefeil] = useState<string | null>(null);

  useEffect(() => {
    setLiquidityState(loading);
    const unsubscribe = subscribeLiquidity(familyId, (data) => setLiquidityState(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const [inputStatus, setInputStatus] = useState<Loadable<true>>(notLoaded);
  useEffect(() => {
    // Familiebytte: ingen rester fra forrige familie. Tomme grupper
    // utløser ikke regenerering (vakten under krever budsjettdata).
    setForecastInputs(EMPTY_FORECAST_INPUTS);
    setInputStatus(loading);
    const unsubscribe = subscribeForecastInputs(familyId, setForecastInputs, {
      onReady: () => setInputStatus((s) => (s.status === "error" ? s : loaded(true))),
      onError: (error) => setInputStatus(loadError(error)),
    });
    return unsubscribe;
  }, [familyId]);

  const forfallsdagMangler = useMemo<Loadable<ForfallsdagMangel[]>>(() => {
    if (inputStatus.status !== "loaded") return inputStatus;
    return loaded(finnForfallsdagMangler(forecastInputs));
  }, [inputStatus, forecastInputs]);

  const saveSaldo = useCallback(
    async (saldo: number) => {
      await saveLiquiditySaldo(familyId, saldo);
    },
    [familyId],
  );

  const savePrognosisDate = useCallback(
    async (prognosisDate: string) => {
      await saveLiquidityPrognosisDate(familyId, prognosisDate);
    },
    [familyId],
  );

  const addPost = useCallback(
    async (fields: Omit<LiquidityPost, "id" | "kilde">) => {
      await addLiquidityPost(familyId, fields);
    },
    [familyId],
  );

  const removePost = useCallback(
    async (id: string) => {
      await removeLiquidityPost(familyId, id);
    },
    [familyId],
  );

  const markFulfilled = useCallback(
    async (id: string) => {
      await setLiquidityPostFulfilled(familyId, id, true);
    },
    [familyId],
  );

  const unmarkFulfilled = useCallback(
    async (id: string) => {
      await setLiquidityPostFulfilled(familyId, id, false);
    },
    [familyId],
  );

  const editPost = useCallback(
    async (id: string, patch: Partial<LiquidityPost>, grunnlag?: Partial<LiquidityPost>) => {
      await updateLiquidityPost(familyId, id, patch, grunnlag);
    },
    [familyId],
  );

  const regenerate = useCallback(async () => {
    if (liquidity.status !== "loaded") return;
    // Samme effektive dato som Spillerom viser og regner med (funn H).
    const prognosisDate = effektivPrognosedato(liquidity.data.prognosisDate, new Date()).dato;
    // Samtidighet (#59): generatoren kjøres på GJELDENDE posts ved commit
    // (transaksjon, ny kjøring ved samtidig endring), aldri på et gammelt
    // snapshot som skrives blindt.
    try {
      await regenerateLiquidityPosts(familyId, (gjeldende) =>
        generateForecastPosts(
          forecastInputs.budgetGroups,
          gjeldende,
          new Date(),
          new Date(prognosisDate),
          forecastInputs.incomeGroups,
          forecastInputs.sparingGroups,
        ),
      );
      setPrognosefeil(null);
    } catch (e) {
      setPrognosefeil(
        `Prognosen ble ikke oppdatert: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }, [familyId, liquidity, forecastInputs]);

  // Automatisk regenerering når budsjett-/inntekts-/sparedata eller
  // prognosisDate endres — speiler legacy sin useEffect (§index.html
  // linje 10434–10437), som kjører `runGenerator` på enhver endring i
  // disse signaturene. Denne versjonen bruker forecastInputs/prognosisDate
  // sin egen objektidentitet (ny på hvert Firebase-snapshot) i stedet for
  // en eksplisitt JSON.stringify-signatur — samme praktiske effekt
  // (regenerer på enhver reell endring), enklere React-idiomatikk. Samme
  // vakt som legacy: ingen kjøring før budsjettdata faktisk er lastet
  // (unngår å tømme genererte poster basert på et tomt førsteøyeblikksbilde).
  useEffect(() => {
    if (liquidity.status !== "loaded") return;
    if (forecastInputs.budgetGroups.length === 0) return;
    regenerate().catch(() => {}); // feilen vises via `prognosefeil`
    // eslint-disable-next-line react-hooks/exhaustive-deps -- regenerate endres hver render (avhenger av liquidity); vi vil kun kjøre på faktisk data-/dato-endring, ikke på hver regenerate-identitet.
  }, [forecastInputs, liquidity.status === "loaded" ? liquidity.data.prognosisDate : null]);

  return {
    liquidity,
    saveSaldo,
    savePrognosisDate,
    addPost,
    removePost,
    markFulfilled,
    unmarkFulfilled,
    editPost,
    regenerate,
    prognosefeil,
    forfallsdagMangler,
  };
}
