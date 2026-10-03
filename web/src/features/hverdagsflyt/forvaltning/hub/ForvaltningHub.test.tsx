import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ForvaltningHub } from "./ForvaltningHub";

const gate = vi.hoisted(() => ({ aktiv: false }));
vi.mock("@hooks/forsoningAktivering", () => ({ forsoningSkrivingAktiv: () => gate.aktiv }));

const vis = () =>
  render(
    <MemoryRouter initialEntries={["/forvaltning"]}>
      <ForvaltningHub />
    </MemoryRouter>,
  );

/** `/forvaltning` bytter fra legacy-broen til React samtidig med forsoningsporten (R3b-cutover). */
describe("ForvaltningHub", () => {
  it("porten av: uendret bro til dagens app", () => {
    gate.aktiv = false;
    vis();
    expect(screen.getByText(/er ikke migrert til den nye grunnmuren ennå/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Forvaltning" })).toBeNull();
  });

  it("porten på: alle legacy-fanene (+ RegelSenter og Årsbudsjett) som React-ruter", () => {
    gate.aktiv = true;
    vis();
    const nav = screen.getByRole("navigation", { name: "Forvaltning" });
    const lenker = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(lenker).toEqual([
      "/forvaltning/spillerom",
      "/forvaltning/inntekter",
      "/forvaltning/budsjett",
      "/forvaltning/sparing",
      "/forvaltning/transaksjoner",
      "/forvaltning/kvitteringer",
      "/forvaltning/regelsenter",
      "/forvaltning/arsbudsjett",
    ]);
    expect(screen.queryByText(/ikke migrert/)).toBeNull();
  });
});
