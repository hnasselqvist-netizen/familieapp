import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HistorikkSammendrag } from "@domain/forsoning/historikkeksport";
import { HistorikkeksportView } from "./HistorikkeksportView";

const S: HistorikkSammendrag = {
  antallHendelser: 6,
  antallRader: 7,
  forsteDato: "2026-08-15",
  sisteDato: "2026-10-01",
  antallUavklart: 0,
  antallTvetydig: 0,
};

describe("HistorikkeksportView (#59)", () => {
  it("viser sammendraget og eksporterer på ett trykk", async () => {
    const user = userEvent.setup();
    const onEksporter = vi.fn();
    render(<HistorikkeksportView sammendrag={S} onEksporter={onEksporter} />);
    const dl = screen.getByLabelText("Sammendrag");
    expect(
      within(dl)
        .getAllByRole("definition")
        .map((d) => d.textContent),
    ).toEqual(["6", "7", "2026-08-15", "2026-10-01", "0", "0"]);
    expect(screen.queryByText(/eksporteres likevel/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Eksporter historikk (.csv)" }));
    expect(onEksporter).toHaveBeenCalledOnce();
    expect(screen.getByText("Filen er lastet ned.")).toBeInTheDocument();
  });

  it("forklarer uavklarte og tvetydige rader uten å skjule dem", () => {
    render(
      <HistorikkeksportView
        sammendrag={{ ...S, antallUavklart: 2, antallTvetydig: 1 }}
        onEksporter={() => {}}
      />,
    );
    expect(
      screen.getByText(/1 rad\(er\) har en historisk plassering som matcher flere/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 rad\(er\) har en historisk plassering som ikke finnes/),
    ).toBeInTheDocument();
  });

  it("tom historikk: knappen er av, og datoene vises som —", () => {
    render(
      <HistorikkeksportView
        sammendrag={{ ...S, antallHendelser: 0, antallRader: 0, forsteDato: null, sisteDato: null }}
        onEksporter={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Eksporter historikk (.csv)" })).toBeDisabled();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("feil i eksporten gir en rolig melding", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <HistorikkeksportView
        sammendrag={S}
        onEksporter={() => {
          throw new Error("x");
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Eksporter historikk (.csv)" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Noe gikk galt med eksporten.");
  });
});
