import { createBrowserRouter, Navigate } from "react-router-dom";
import { LegacyBridge } from "@features/LegacyBridge";
import { FreezerScreen } from "@features/hverdagsflyt/mat/freezer/FreezerScreen";
import { MatLayout } from "@features/hverdagsflyt/mat/MatLayout";
import { RecipesScreen } from "@features/hverdagsflyt/mat/kokebok/RecipesScreen";
import { AppLayout } from "./AppLayout";

/**
 * Det tiltenkte rutetreet for hele Hverdagsflyt (§Fase 0, punkt 5),
 * satt opp i sin helhet nå — ikke bare for Fryser — slik at neste
 * migrerte modul slår inn i en eksisterende rute i stedet for å kreve
 * en ny routing-diskusjon. Se LegacyBridge for hvordan ikke-migrerte
 * områder håndteres i mellomtiden.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <LegacyBridge label="Gangen (hjem)" /> },
      {
        path: "mat",
        element: <MatLayout />,
        children: [
          { index: true, element: <Navigate to="/mat/fryser" replace /> },
          { path: "plan", element: <LegacyBridge label="Middagsplan" /> },
          { path: "bibliotek", element: <LegacyBridge label="Middagsbibliotek" /> },
          { path: "kokebok", element: <RecipesScreen /> },
          { path: "handle", element: <LegacyBridge label="Handleliste" /> },
          { path: "fryser", element: <FreezerScreen /> },
        ],
      },
      { path: "forvaltning", element: <LegacyBridge label="Forvaltning" /> },
      { path: "hjem-familie", element: <LegacyBridge label="Hjem & familie" /> },
      { path: "verktoy", element: <LegacyBridge label="Verktøy" /> },
    ],
  },
]);
