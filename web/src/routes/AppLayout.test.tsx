import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppLayout } from "./AppLayout";
import styles from "./AppLayout.module.css";
import { erBredFlate, isHverdagsflytRoom } from "./rom";

/**
 * Rombakgrunnen (`--g-bg`) er skallets ansvar. Regresjon for #59
 * 6001948623: Forvaltning-flatene var hvite fordi bare Gangen og Kjøkken
 * fikk rombakgrunnen.
 */
function mainKlasse(path: string): string {
  const router = createMemoryRouter(
    [{ path: "/", element: <AppLayout />, children: [{ path: "*", element: <div /> }] }],
    { initialEntries: [path] },
  );
  const { container } = render(<RouterProvider router={router} />);
  return container.querySelector("main")!.className;
}

function rotKlasse(path: string): string {
  const router = createMemoryRouter(
    [{ path: "/", element: <AppLayout />, children: [{ path: "*", element: <div /> }] }],
    { initialEntries: [path] },
  );
  const { container } = render(<RouterProvider router={router} />);
  return (container.firstElementChild as HTMLElement).className;
}

describe("AppLayout — Hverdagsflyt-rombakgrunn", () => {
  it.each([
    "/",
    "/mat/plan",
    "/forvaltning",
    "/forvaltning/okonomi",
    "/forvaltning/spillerom",
    "/verktoy",
  ])("%s får rombakgrunnen", (path) => {
    expect(isHverdagsflytRoom(path)).toBe(true);
    expect(rotKlasse(path)).toContain(styles.room);
  });

  it.each(["/hjem-familie"])("%s (LegacyBridge) beholder sitt eget uttrykk", (path) => {
    expect(isHverdagsflytRoom(path)).toBe(false);
    expect(rotKlasse(path)).not.toContain(styles.room);
  });
});

describe("AppLayout — bred arbeidsflate (#59, PC-1)", () => {
  it.each(["/forvaltning/transaksjoner", "/forvaltning/transaksjoner/"])(
    "%s får den brede flaten",
    (path) => {
      expect(erBredFlate(path)).toBe(true);
      expect(mainKlasse(path)).toContain(styles.mainBred);
    },
  );

  it.each(["/", "/mat/plan", "/forvaltning", "/forvaltning/kvitteringer", "/forvaltning/okonomi"])(
    "%s beholder den smale kolonnen",
    (path) => {
      expect(erBredFlate(path)).toBe(false);
      expect(mainKlasse(path)).not.toContain(styles.mainBred);
    },
  );
});
