import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HjemFamilieScreen } from "./HjemFamilieScreen";

describe("HjemFamilieScreen (#20, #128 punkt 1)", () => {
  it("viser inngangen til Gaver og juleplanlegging med lenke til /hjem-familie/gaver", () => {
    render(
      <MemoryRouter>
        <HjemFamilieScreen />
      </MemoryRouter>,
    );
    const lenke = screen.getByRole("link", { name: /Gaver og juleplanlegging/ });
    expect(lenke.getAttribute("href")).toBe("/hjem-familie/gaver");
  });

  it("har ingen lenke til dagens app (LegacyBridge er fjernet)", () => {
    render(
      <MemoryRouter>
        <HjemFamilieScreen />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/ikke migrert/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Åpne i dagens app/ })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
