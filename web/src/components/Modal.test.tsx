import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("har dialog-rolle med tittelen som tilgjengelig navn — reelt funn, Middagsplan v1 (§Kontrolltårn-handoff, Issue #20)", () => {
    render(
      <Modal title="Mandag" onClose={vi.fn()}>
        Innhold
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Mandag" })).toBeInTheDocument();
  });

  it("er markert aria-modal — skjermlesere skal behandle den som en modal", () => {
    render(
      <Modal title="Mandag" onClose={vi.fn()}>
        Innhold
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("viser tittelen som synlig tekst i tillegg til aria-label — ingen visuell endring", () => {
    render(
      <Modal title="Mandag" onClose={vi.fn()}>
        Innhold
      </Modal>,
    );
    expect(screen.getByText("Mandag")).toBeInTheDocument();
  });
});
