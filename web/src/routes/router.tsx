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
import { KvitteringsinnboksScreen } from "@features/hverdagsflyt/forvaltning/kvitteringer/KvitteringsinnboksScreen";
import { TransaksjonsoversiktScreen } from "@features/hverdagsflyt/forvaltning/transaksjoner/TransaksjonsoversiktScreen";
import { RegelsenterScreen } from "@features/hverdagsflyt/forvaltning/regelsenter/RegelsenterScreen";
import { ForvaltningHub } from "@features/hverdagsflyt/forvaltning/hub/ForvaltningHub";
import { HistorikkeksportScreen } from "@features/hverdagsflyt/mer/HistorikkeksportScreen";
import { MerScreen } from "@features/hverdagsflyt/mer/MerScreen";
import { OkonomiScreen } from "@features/hverdagsflyt/forvaltning/okonomi/OkonomiScreen";
import { okonomiLenke } from "@features/hverdagsflyt/forvaltning/okonomi/okonomiLenke";
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
          // Indeksen er React-inngangen etter R3b-cutover (forsoningsporten
          // PÅ, legacy-setterne sperret); med porten AV (rollback) er den
          // broen til legacy — se ForvaltningHub.
          { index: true, element: <ForvaltningHub /> },
          // Spillerom er ett rom (#59): oversikten og detaljene er slått sammen
          // på /spillerom; den gamle oversikt-adressen sender dit.
          { path: "oversikt", element: <Navigate to="/forvaltning/spillerom" replace /> },
          { path: "spillerom", element: <SpilleromScreen /> },
          // Inntekter, kostnader og sparing som én flate (#59). De tidligere
          // separate skjermene sender hit med riktig område valgt.
          { path: "okonomi", element: <OkonomiScreen /> },
          { path: "budsjett", element: <Navigate to={okonomiLenke("kostnader")} replace /> },
          { path: "inntekter", element: <Navigate to={okonomiLenke("inntekter")} replace /> },
          { path: "sparing", element: <Navigate to={okonomiLenke("sparing")} replace /> },
          { path: "arsbudsjett", element: <ArsbudsjettScreen /> },
          // Skriver bak forsoningsporten (§hooks/regelsenterAktivering.ts).
          { path: "regelsenter", element: <RegelsenterScreen /> },
          // Skriver receipts bak forsoningsporten (ADR 0002).
          { path: "kvitteringer", element: <KvitteringsinnboksScreen /> },
          // Bankimport/behandling: skriver transaksjoner/hendelser bak
          // forsoningsporten (ADR 0002).
          { path: "transaksjoner", element: <TransaksjonsoversiktScreen /> },
        ],
      },
      { path: "hjem-familie", element: <LegacyBridge label="Hjem & familie" /> },
      // «Mer» (#59): React-meny med direkte lenker til flyttede verktøy og
      // en merket vei til dagens app for resten.
      { path: "verktoy", element: <MerScreen /> },
      { path: "verktoy/historikkeksport", element: <HistorikkeksportScreen /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
