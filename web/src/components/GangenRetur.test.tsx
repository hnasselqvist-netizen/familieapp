import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { GangenRetur } from "./GangenRetur";

function renderPa(url: string, props: Parameters<typeof GangenRetur>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <GangenRetur {...props} />
    </MemoryRouter>,
  );
}

describe("GangenRetur", () => {
  it("rendrer ingenting når brukeren ikke kom fra Gangen", () => {
    const { container } = renderPa("/mat/handle");
    expect(container).toBeEmptyDOMElement();
  });

  it("viser en diskré lenke til Gangen mens beslutningen pågår", () => {
    renderPa("/mat/handle?fra=gangen");
    expect(screen.getByRole("link", { name: "Gangen" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("blir et rolig ferdig-kort når beslutningen er tatt — uten å navigere selv", () => {
    renderPa("/forvaltning/transaksjoner?ko=vurdering&fra=gangen", {
      ferdig: true,
      ferdigTekst: "Alt er vurdert.",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Alt er vurdert.");
    expect(screen.getByRole("link", { name: "Tilbake til Gangen" })).toHaveAttribute("href", "/");
  });
});
