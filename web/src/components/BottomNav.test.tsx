import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BottomNav } from "./BottomNav";

/**
 * Regresjonstester for aktiv-tilstanden i den globale BottomNav
 * (§Kontrolltårn-handoff, Issue #20, "hovedløft") — beviser at "Mat"
 * forblir aktiv på tvers av hele `/mat/*`-treet selv om lenken selv
 * peker til `/mat/plan`, og at "Hjem" kun er aktiv på eksakt `/`.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>,
  );
}

describe("BottomNav", () => {
  it("viser alle fem fanene med lenker til riktige ruter", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Hjem" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Mat" })).toHaveAttribute("href", "/mat/plan");
    expect(screen.getByRole("link", { name: "Forvaltning" })).toHaveAttribute(
      "href",
      "/forvaltning",
    );
    expect(screen.getByRole("link", { name: "Hjem & familie" })).toHaveAttribute(
      "href",
      "/hjem-familie",
    );
    expect(screen.getByRole("link", { name: "Mer" })).toHaveAttribute("href", "/verktoy");
  });

  it('"Hjem" er kun aktiv (aria-current) på eksakt "/"', () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Hjem" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Mat" })).not.toHaveAttribute("aria-current");
  });

  it('"Mat" forblir aktiv på hele /mat/*-treet, ikke bare /mat/plan', () => {
    renderAt("/mat/bibliotek");
    expect(screen.getByRole("link", { name: "Mat" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Hjem" })).not.toHaveAttribute("aria-current");
  });

  it('"Hjem" er IKKE aktiv på andre ruter, selv om alle paths starter med "/"', () => {
    renderAt("/forvaltning");
    expect(screen.getByRole("link", { name: "Hjem" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Forvaltning" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
