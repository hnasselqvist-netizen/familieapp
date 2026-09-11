import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoomHeader } from "./RoomHeader";

describe("RoomHeader", () => {
  it("viser tittelen — eneste påkrevde felt", () => {
    render(<RoomHeader title="Middagsplan" />);
    expect(screen.getByText("Middagsplan")).toBeInTheDocument();
  });

  it("tittelen er et semantisk h1 — dette er et side-/romnivå-atom, ikke en dekorativ tekstblokk (§Kontrolltårn-review, PR #22)", () => {
    render(<RoomHeader title="Middagsplan" />);
    const heading = screen.getByRole("heading", { level: 1, name: "Middagsplan" });
    expect(heading.tagName).toBe("H1");
  });

  it("viser ingen eyebrow/beskrivelse/aksjoner når de ikke er satt — kallested eier alt innhold", () => {
    const { container } = render(<RoomHeader title="Middagsplan" />);
    expect(container.textContent).toBe("Middagsplan");
  });

  it("viser eyebrow når satt, med nøyaktig den teksten kallestedet ga — ingen standardtekst", () => {
    render(<RoomHeader eyebrow="MAT" title="Middagsplan" />);
    expect(screen.getByText("MAT")).toBeInTheDocument();
  });

  it("viser støttetekst når satt", () => {
    render(<RoomHeader title="Middagsplan" description="Denne ukens middager" />);
    expect(screen.getByText("Denne ukens middager")).toBeInTheDocument();
  });

  it("rendrer en gitt aksjoner-node uendret — kjenner ikke til konkrete knapper", () => {
    render(
      <RoomHeader title="Middagsplan" actions={<button type="button">Lag handleliste</button>} />,
    );
    expect(screen.getByRole("button", { name: "Lag handleliste" })).toBeInTheDocument();
  });
});
