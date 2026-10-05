import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LEGACY_APP_URL } from "@features/legacyUrl";
import { MerScreen } from "./MerScreen";

const vis = () =>
  render(
    <MemoryRouter>
      <MerScreen />
    </MemoryRouter>,
  );
const lenker = (region: string) =>
  within(screen.getByRole("region", { name: region }))
    .getAllByRole("link")
    .map((a) => [a.textContent, a.getAttribute("href")]);
const rad = (tittel: string, href: string) => [
  expect.stringMatching(new RegExp(`^${tittel}`)),
  href,
];

describe("MerScreen — «Mer» i den nye appen (#59 6001954968)", () => {
  it("verktøy som finnes i React lenker direkte dit, ikke til dagens app", () => {
    vis();
    expect(lenker("Oppsett")).toEqual([
      rad("Regelsenter", "/forvaltning/regelsenter"),
      rad("Årsbudsjett", "/forvaltning/arsbudsjett"),
    ]);
  });

  it("det som ikke er flyttet er tydelig merket og åpnes i dagens app", () => {
    vis();
    expect(lenker("I dagens app")).toEqual([
      rad("Generator", LEGACY_APP_URL),
      rad("Kontoer", LEGACY_APP_URL),
      rad("Historikkeksport", LEGACY_APP_URL),
    ]);
    expect(
      screen.getByText("Disse er ikke flyttet til den nye appen ennå, og åpnes i dagens app."),
    ).toBeInTheDocument();
  });

  it("er ikke lenger bare en bro: ingen «ikke migrert»-plakat", () => {
    vis();
    expect(screen.queryByText(/er ikke migrert til den nye grunnmuren/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Mer", level: 1 })).toBeInTheDocument();
  });
});
