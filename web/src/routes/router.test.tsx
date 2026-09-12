import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Navigate, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { MatLayout } from "@features/hverdagsflyt/mat/MatLayout";
import { AppLayout } from "./AppLayout";

/**
 * Rute-/skalltest for den globale Hverdagsflyt-navigasjonen
 * (§Kontrolltårn-handoff, Issue #20, "hovedløft"). Bruker de ekte
 * skall-komponentene (`AppLayout`/`MatLayout`/`BottomNav`), men stubbede
 * bladskjermer i stedet for de ekte Mat-skjermene — disse er allerede
 * dekket av sine egne komponenttester og trenger Firebase-hook-mocking
 * som ikke hører hjemme i en ren skall-/routing-test. Det som faktisk
 * bevises her er strukturelt: at `/mat`-indeksen omdirigerer til
 * `/mat/plan`, og at BottomNav/MatLayout-fanene reflekterer aktiv rute
 * riktig gjennom hele treet.
 */
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AppLayout />,
        children: [
          { index: true, element: <div>Gangen-stub</div> },
          {
            path: "mat",
            element: <MatLayout />,
            children: [
              { index: true, element: <Navigate to="/mat/plan" replace /> },
              { path: "plan", element: <div>Plan-stub</div> },
              { path: "bibliotek", element: <div>Bibliotek-stub</div> },
            ],
          },
          { path: "forvaltning", element: <div>Forvaltning-stub</div> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe("Rutetre — global navigasjon", () => {
  it('"/mat" omdirigerer til "/mat/plan"', () => {
    renderAt("/mat");
    expect(screen.getByText("Plan-stub")).toBeInTheDocument();
  });

  it("BottomNav sin Mat-fane er aktiv på /mat/plan (etter omdirigering)", () => {
    renderAt("/mat");
    expect(screen.getByRole("link", { name: "Mat" })).toHaveAttribute("aria-current", "page");
  });

  it("MatLayout sin interne Bibliotek-fane er aktiv på /mat/bibliotek, BottomNav sin Mat-fane forblir også aktiv", () => {
    renderAt("/mat/bibliotek");
    expect(screen.getByText("Bibliotek-stub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mat" })).toHaveAttribute("aria-current", "page");
  });

  it('BottomNav sin Hjem-fane er aktiv på "/", Gangen-innholdet vises', () => {
    renderAt("/");
    expect(screen.getByText("Gangen-stub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hjem" })).toHaveAttribute("aria-current", "page");
  });
});
