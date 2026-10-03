import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { GangenScreen } from "@features/hverdagsflyt/gangen/GangenScreen";
import { LegacyBridge } from "@features/LegacyBridge";
import { MealLibraryScreen } from "@features/hverdagsflyt/mat/bibliotek/MealLibraryScreen";
import { FreezerScreen } from "@features/hverdagsflyt/mat/freezer/FreezerScreen";
import { HandlelisteScreen } from "@features/hverdagsflyt/mat/handleliste/HandlelisteScreen";
import { MatLayout } from "@features/hverdagsflyt/mat/MatLayout";
import { RecipesScreen } from "@features/hverdagsflyt/mat/kokebok/RecipesScreen";
import { PlanScreen } from "@features/hverdagsflyt/mat/plan/PlanScreen";
import { ArsbudsjettScreen } from "@features/hverdagsflyt/forvaltning/arsbudsjett/ArsbudsjettScreen";
import { BudsjettScreen } from "@features/hverdagsflyt/forvaltning/budsjett/BudsjettScreen";
import { InntekterScreen } from "@features/hverdagsflyt/forvaltning/inntekter/InntekterScreen";
import { KvitteringsinnboksScreen } from "@features/hverdagsflyt/forvaltning/kvitteringer/KvitteringsinnboksScreen";
import { TransaksjonsoversiktScreen } from "@features/hverdagsflyt/forvaltning/transaksjoner/TransaksjonsoversiktScreen";
import { RegelsenterScreen } from "@features/hverdagsflyt/forvaltning/regelsenter/RegelsenterScreen";
import { SparingScreen } from "@features/hverdagsflyt/forvaltning/sparing/SparingScreen";
import { ForvaltningHub } from "@features/hverdagsflyt/forvaltning/hub/ForvaltningHub";
import { SpilleromOversiktScreen } from "@features/hverdagsflyt/forvaltning/spillerom/SpilleromOversiktScreen";
import { SpilleromScreen } from "@features/hverdagsflyt/forvaltning/spillerom/SpilleromScreen";
import { AppLayout } from "./AppLayout";

/**
 * Det tiltenkte rutetreet for hele Hverdagsflyt (§Fase 0, punkt 5),
 * satt opp i sin helhet nå — ikke bare for Fryser — slik at neste
 * migrerte modul slår inn i en eksisterende rute i stedet for å kreve
 * en ny routing-diskusjon. Se LegacyBridge for hvordan ikke-migrerte
 * områder håndteres i mellomtiden.
 *
 * Eksportert som en egen `routes`-liste (§Kontrolltårn-handoff, Issue #20,
 * "hovedløft") slik at `router.test.tsx` kan bygge en `createMemoryRouter`
 * av NØYAKTIG samme rutetre i stedet for å duplisere det — kun
 * `createBrowserRouter` (produksjon) vs. `createMemoryRouter` (test)
 * skiller seg.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <GangenScreen /> },
      {
        path: "mat",
        element: <MatLayout />,
        children: [
          { index: true, element: <Navigate to="/mat/plan" replace /> },
          { path: "plan", element: <PlanScreen /> },
          { path: "bibliotek", element: <MealLibraryScreen /> },
          { path: "kokebok", element: <RecipesScreen /> },
          { path: "handle", element: <HandlelisteScreen /> },
          { path: "fryser", element: <FreezerScreen /> },
        ],
      },
      {
        path: "forvaltning",
        children: [
          // Indeksen er broen til legacy til R3b-cutover, og blir React-
          // inngangen i samme steg som forsoningsporten slås på (legacy-
          // setterne sperres da samtidig) — se ForvaltningHub.
          { index: true, element: <ForvaltningHub /> },
          // Spillerom-dashbordet (legacy-fanen «Spillerom»); detaljene ligger på /spillerom.
          { path: "oversikt", element: <SpilleromOversiktScreen /> },
          { path: "spillerom", element: <SpilleromScreen /> },
          { path: "budsjett", element: <BudsjettScreen /> },
          { path: "inntekter", element: <InntekterScreen /> },
          { path: "sparing", element: <SparingScreen /> },
          { path: "arsbudsjett", element: <ArsbudsjettScreen /> },
          // R1: kun visning til R3b-cutover (§hooks/regelsenterAktivering.ts).
          { path: "regelsenter", element: <RegelsenterScreen /> },
          // R2: kun visning; legacy er eneste skriver av receipts til R3 (ADR 0002).
          { path: "kvitteringer", element: <KvitteringsinnboksScreen /> },
          // R3-les: kun visning; legacy-Bankimport er eneste skriver av
          // transaksjoner/hendelser til R3b-cutover (ADR 0002).
          { path: "transaksjoner", element: <TransaksjonsoversiktScreen /> },
        ],
      },
      { path: "hjem-familie", element: <LegacyBridge label="Hjem & familie" /> },
      { path: "verktoy", element: <LegacyBridge label="Verktøy" /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
