import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { type RundeGrunnlag, beregnRunde } from "@domain/lonnsdagsrunde/lonnsdagsrunde";
import { LonnsdagsrundeView } from "./LonnsdagsrundeView";

const IDAG = new Date(2026, 9, 7, 12);

function runde(o: Partial<RundeGrunnlag> = {}) {
  return beregnRunde(
    {
      lonnDay: 20,
      sisteImport: "2026-09-22",
      aVurdere: 0,
      kvitteringer: 0,
      saldoOppdatert: new Date(2026, 8, 21).getTime(),
      prognosedatoPassert: false,
      trengerAvklaring: 0,
      ...o,
    },
    IDAG,
  );
}

function vis(r = runde(), transaksjonsko: "vurdering" | "forslag" = "vurdering") {
  return render(
    <MemoryRouter>
      <LonnsdagsrundeView
        runde={r}
        transaksjonsko={transaksjonsko}
        spillerom={12400}
        prognosisDate="2026-10-20"
      />
    </MemoryRouter>,
  );
}

const steg = () => within(screen.getByRole("list", { name: "Steg i runden" })).getAllByRole("link");

describe("LonnsdagsrundeView", () => {
  it("hvert steg åpner skjermen der jobben gjøres, med veien tilbake til runden", () => {
    vis(runde({ sisteImport: null, aVurdere: 2, kvitteringer: 1 }));
    expect(steg().map((a) => a.getAttribute("href"))).toEqual([
      "/forvaltning/transaksjoner?verktoy=import&fra=runde",
      "/forvaltning/transaksjoner?ko=vurdering&fra=runde",
      "/forvaltning/kvitteringer?fra=runde",
      "/forvaltning/spillerom?fra=runde",
    ]);
  });

  it("vurderingssteget åpner forslag-fanen når bare forslag venter", () => {
    vis(runde({ aVurdere: 1 }), "forslag");
    expect(steg()[1]).toHaveAttribute("href", "/forvaltning/transaksjoner?ko=forslag&fra=runde");
  });

  it("det aktive steget er markert, og fremdriften står over listen", () => {
    vis(runde({ aVurdere: 3 }));
    expect(screen.getByText("3 av 4 steg gjort")).toBeInTheDocument();
    const aktivt = steg().find((a) => a.getAttribute("aria-current") === "step");
    expect(aktivt).toHaveTextContent("Vurder transaksjonene");
    expect(aktivt).toHaveTextContent("3 transaksjoner venter.");
    expect(steg()[0]).toHaveTextContent("Importer bankfilen (gjort)");
  });

  it("forklarer hva som gjenstår i Spillerom-steget", () => {
    vis(runde({ saldoOppdatert: null, prognosedatoPassert: true, trengerAvklaring: 2 }));
    expect(steg()[3]).toHaveTextContent(
      "Oppdater disponibelt beløp etter lønn, sett ny prognosedato, 2 poster trenger avklaring.",
    );
  });

  it("import fra forrige periode sies tydelig", () => {
    vis(runde({ sisteImport: "2026-09-10" }));
    expect(steg()[0]).toHaveTextContent("Sist importert 10. september, før lønn 20. september.");
  });

  it("ferdig: rolig avslutning med spillerom og neste runde, ingen fremdriftstekst", () => {
    vis();
    const ferdig = screen.getByRole("region", { name: "Runden er ferdig" });
    expect(ferdig).toHaveTextContent("Ferdig for denne lønnsperioden");
    expect(ferdig).toHaveTextContent(/Spillerom frem til 20\. oktober:\s*12\s400\skr/);
    expect(ferdig).toHaveTextContent("Neste runde: 20. oktober.");
    expect(screen.queryByText(/av 4 steg gjort/)).toBeNull();
    expect(steg().some((a) => a.hasAttribute("aria-current"))).toBe(false);
  });
});

describe("LonnsdagsrundeView — saldoavstemming (#59)", () => {
  it("viser forrige kalendermåneds kontroll som ikke-blokkerende status, ikke som et steg", () => {
    render(
      <MemoryRouter>
        <LonnsdagsrundeView
          runde={runde()}
          transaksjonsko="vurdering"
          spillerom={12400}
          prognosisDate="2026-10-20"
          maanedskontroll={{ maaned: "2026-09", avstemte: 1, totalt: 3, avvik: 0, usikre: 0 }}
        />
      </MemoryRouter>,
    );
    expect(steg()).toHaveLength(4);
    const lenke = screen.getByRole("link", { name: /Månedskontroll september: 1 av 3/ });
    expect(lenke).toHaveAttribute("href", "/forvaltning/avstemming");
    expect(lenke).toHaveTextContent(
      "Kalendermåneden kontrolleres for seg, uavhengig av lønnsperioden.",
    );
    expect(screen.getByText("Ferdig for denne lønnsperioden")).toBeInTheDocument();
  });
});
