import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { fraLenke } from "./fraLenke";
import { Retur } from "./Retur";

function renderPa(url: string, props: Parameters<typeof Retur>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Retur {...props} />
    </MemoryRouter>,
  );
}

describe("Retur", () => {
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

describe("Retur fra Lønnsdagsrunden", () => {
  it("lenker tilbake til runden", () => {
    renderPa("/forvaltning/kvitteringer?fra=runde");
    expect(screen.getByRole("link", { name: "Lønnsdagsrunden" })).toHaveAttribute(
      "href",
      "/forvaltning/runde",
    );
  });

  it("ferdig-kortet sier hvor det går tilbake til", () => {
    renderPa("/forvaltning/spillerom?fra=runde", {
      ferdig: true,
      ferdigTekst: "Spillerom er klart.",
    });
    expect(screen.getByRole("link", { name: "Tilbake til Lønnsdagsrunden" })).toHaveAttribute(
      "href",
      "/forvaltning/runde",
    );
  });

  it("ukjent opphav gir ingen retur", () => {
    const { container } = renderPa("/forvaltning/kvitteringer?fra=et-annet-sted");
    expect(container).toBeEmptyDOMElement();
  });
});

describe("fraLenke", () => {
  it("legger til fra= med riktig skilletegn", () => {
    expect(fraLenke("/mat/handle", "gangen")).toBe("/mat/handle?fra=gangen");
    expect(fraLenke("/forvaltning/transaksjoner?ko=vurdering", "runde")).toBe(
      "/forvaltning/transaksjoner?ko=vurdering&fra=runde",
    );
  });
});
