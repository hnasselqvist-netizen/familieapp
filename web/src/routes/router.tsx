import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { GangenScreen } from "@features/hverdagsflyt/gangen/GangenScreen";
import { LegacyBridge } from "@features/LegacyBridge";
import { MealLibraryScreen } from "@features/hverdagsflyt/mat/bibliotek/MealLibraryScreen";
import { FreezerScreen } from "@features/hverdagsflyt/mat/freezer/FreezerScreen";
import { HandlelisteScreen } from "@features/hverdagsflyt/mat/handleliste/HandlelisteScreen";
import { MatLayout } from "@features/hverdagsflyt/mat/MatLayout";
import { RecipesScreen } from "@features/hverdagsflyt/mat/kokebok/RecipesScreen";
import { PlanScreen } from "@features/hverdagsflyt/mat/plan/PlanScreen";
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
      { path: "forvaltning", element: <LegacyBridge label="Forvaltning" /> },
      { path: "hjem-familie", element: <LegacyBridge label="Hjem & familie" /> },
      { path: "verktoy", element: <LegacyBridge label="Verktøy" /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
