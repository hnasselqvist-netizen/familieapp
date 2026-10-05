import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppLayout } from "./AppLayout";
import styles from "./AppLayout.module.css";
import { isHverdagsflytRoom } from "./rom";

/**
 * Rombakgrunnen (`--g-bg`) er skallets ansvar. Regresjon for #59
 * 6001948623: Forvaltning-flatene var hvite fordi bare Gangen og Kjøkken
 * fikk rombakgrunnen.
 */
function rotKlasse(path: string): string {
  const router = createMemoryRouter(
    [{ path: "/", element: <AppLayout />, children: [{ path: "*", element: <div /> }] }],
    { initialEntries: [path] },
  );
  const { container } = render(<RouterProvider router={router} />);
  return (container.firstElementChild as HTMLElement).className;
}

describe("AppLayout — Hverdagsflyt-rombakgrunn", () => {
  it.each(["/", "/mat/plan", "/forvaltning", "/forvaltning/okonomi", "/forvaltning/spillerom"])(
    "%s får rombakgrunnen",
    (path) => {
      expect(isHverdagsflytRoom(path)).toBe(true);
      expect(rotKlasse(path)).toContain(styles.room);
    },
  );

  it.each(["/hjem-familie", "/verktoy"])("%s (LegacyBridge) beholder sitt eget uttrykk", (path) => {
    expect(isHverdagsflytRoom(path)).toBe(false);
    expect(rotKlasse(path)).not.toContain(styles.room);
  });
});
