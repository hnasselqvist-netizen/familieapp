/**
 * «Fjern» på en basisvare i Matlager (Mat #20, ordre 6948538722). Datahooks
 * mocket, syntetiske nøkler. Bare gyldige `true`-markeringer vises som
 * fjernbare; den lagrede nøkkelen sendes eksakt; dobbeltaktivering er
 * sperret under venting; «fjernet» sies bare etter bekreftelse.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import type { BasisvareFjerningResultat } from "@hooks/useStaples";

const fjernBasisvare = vi.fn<(nokkel: string) => Promise<BasisvareFjerningResultat>>();
const STAPLES = {
  melk: true,
  "Crème Fraîche": true,
  rar: { ukjent: "råfelt" },
  av: false,
  tekst: "ja",
} as unknown as Record<string, boolean>;

vi.mock("@hooks/useFreezer", () => ({
  useFreezer: () => ({
    freezer: loaded([]),
    addBatch: vi.fn(),
    adjustBatchCount: vi.fn(),
    removeItem: vi.fn(),
  }),
}));
vi.mock("@hooks/useItems", () => ({
  useItems: () => ({ items: loaded([]), findOrCreateItem: vi.fn() }),
}));
vi.mock("@hooks/useStaples", () => ({
  useStaples: () => ({
    staples: loaded(STAPLES),
    // Hookens avgjørelse (eksportform) — se FreezerScreen.basisvarePrioritet.test.tsx.
    fjernbareBasisvarer: ["melk", "Crème Fraîche"],
    markAsStaple: vi.fn(),
    fjernBasisvare,
  }),
}));

const { FreezerScreen } = await import("./FreezerScreen");

async function aapne() {
  const user = userEvent.setup();
  render(<FreezerScreen />);
  await user.click(screen.getByRole("button", { name: /basisvarer \(har vanligvis hjemme\)/ }));
  return user;
}
const fjernKnapp = (n: string) => screen.getByRole("button", { name: `Fjern ${n} som basisvare` });

beforeEach(() => fjernBasisvare.mockReset());

describe("Matlager — fjern basisvare", () => {
  it("viser bare hookens fjernbare nøkler, med lagret nøkkel; uventede verdier tilbys ikke", async () => {
    await aapne();
    expect(screen.getByRole("button", { name: /^2 basisvarer/ })).toBeInTheDocument();
    expect(fjernKnapp("melk")).toBeInTheDocument();
    expect(fjernKnapp("Crème Fraîche")).toBeInTheDocument();
    for (const n of ["rar", "av", "tekst"]) {
      expect(screen.queryByRole("button", { name: `Fjern ${n} som basisvare` })).toBeNull();
    }
  });

  it("vanlig fjerning: dobbeltklikk gir ett kall med eksakt nøkkel; «fjernet» først etter bekreftelse", async () => {
    let svar!: (r: BasisvareFjerningResultat) => void;
    fjernBasisvare.mockReturnValueOnce(new Promise((r) => (svar = r)));
    const user = await aapne();

    await user.dblClick(fjernKnapp("Crème Fraîche"));
    expect(fjernBasisvare).toHaveBeenCalledTimes(1);
    expect(fjernBasisvare).toHaveBeenCalledWith("Crème Fraîche");
    expect(fjernKnapp("Crème Fraîche")).toBeDisabled();
    expect(fjernKnapp("melk")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Fjerner «Crème Fraîche» som basisvare…");
    expect(screen.queryByText(/er fjernet/)).toBeNull();
    await user.click(fjernKnapp("melk"));
    expect(fjernBasisvare).toHaveBeenCalledTimes(1);

    svar({ utfall: "fjernet" });
    expect(await screen.findByText("«Crème Fraîche» er fjernet som basisvare.")).toHaveAttribute(
      "role",
      "status",
    );
    expect(fjernKnapp("melk")).toBeEnabled();
  });

  it("allerede borte: skrivefritt utfall vises som det", async () => {
    fjernBasisvare.mockResolvedValueOnce({ utfall: "borte" });
    const user = await aapne();
    await user.click(fjernKnapp("melk"));
    expect(
      await screen.findByText("«melk» var allerede fjernet som basisvare. Ingenting er endret."),
    ).toBeInTheDocument();
  });

  it("erstattet/uventet verdi: varsel, ikke fjernet", async () => {
    fjernBasisvare.mockResolvedValueOnce({ utfall: "erstattet" });
    const user = await aapne();
    await user.click(fjernKnapp("melk"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("«melk» er endret på en annen enhet");
    expect(alert).toHaveTextContent("Den er ikke fjernet.");
  });

  it("avvist lagring: varsel om at ingenting er endret", async () => {
    fjernBasisvare.mockResolvedValueOnce({ utfall: "avvist" });
    const user = await aapne();
    await user.click(fjernKnapp("melk"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Fjerningen av «melk» ble avvist. Ingenting er endret.",
    );
  });

  it("innloggingen ble endret før fjerningen ble sendt: varsel om at ingenting er endret, knappen frigitt (ordre 6984494940)", async () => {
    fjernBasisvare.mockResolvedValueOnce({ utfall: "byttet" });
    const user = await aapne();
    await user.click(fjernKnapp("melk"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Innloggingen ble endret før «melk» ble fjernet som basisvare. Ingen skriving ble sendt i dette forsøket.",
    );
    expect(fjernKnapp("melk")).toBeEnabled();
  });

  it("uavklart fjerning, så nytt forsøk som stoppes av sesjonsbytte: det første forsøket vises fortsatt som uavklart (review 5961783276)", async () => {
    fjernBasisvare.mockResolvedValueOnce({ utfall: "ukjent" });
    fjernBasisvare.mockResolvedValueOnce({ utfall: "byttet" });
    const user = await aapne();
    await user.click(fjernKnapp("melk"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Fikk ikke bekreftet om «melk» ble fjernet/,
    );
    await user.click(fjernKnapp("melk"));
    await vi.waitFor(() => expect(fjernBasisvare).toHaveBeenCalledTimes(2));
    const alert = await screen.findByRole("alert");
    await vi.waitFor(() =>
      expect(alert).toHaveTextContent(
        "Fortsatt ikke bekreftet om «melk» ble fjernet som basisvare: innloggingen ble endret før kontrollen ble sendt. Ingen skriving ble sendt i dette forsøket. Se listen før du prøver igjen.",
      ),
    );
    expect(alert).not.toHaveTextContent(/Ingenting er endret/);
    expect(fjernKnapp("melk")).toBeEnabled();
  });

  it("ukjent → ikkeLest → byttet holder det første forsøket uavklart; et bekreftet svar frigjør usikkerheten (re-review 5961928535)", async () => {
    fjernBasisvare
      .mockResolvedValueOnce({ utfall: "ukjent" })
      .mockResolvedValueOnce({ utfall: "ikkeLest" })
      .mockResolvedValueOnce({ utfall: "byttet" })
      .mockResolvedValueOnce({ utfall: "borte" })
      .mockResolvedValueOnce({ utfall: "byttet" });
    const user = await aapne();
    const melding = () => screen.getByRole("alert");
    await user.click(fjernKnapp("melk"));
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Fikk ikke bekreftet/));

    await user.click(fjernKnapp("melk"));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Fortsatt ikke bekreftet om «melk» ble fjernet som basisvare: basisvaren kunne ikke leses denne gangen. Se listen før du prøver igjen.",
      ),
    );
    expect(melding()).not.toHaveTextContent(/Ingenting er endret/);

    await user.click(fjernKnapp("melk"));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Fortsatt ikke bekreftet om «melk» ble fjernet som basisvare: innloggingen ble endret før kontrollen ble sendt. Ingen skriving ble sendt i dette forsøket. Se listen før du prøver igjen.",
      ),
    );

    // Bekreftet (allerede borte) avklarer.
    await user.click(fjernKnapp("melk"));
    expect(await screen.findByRole("status")).toHaveTextContent("var allerede fjernet");
    await user.click(fjernKnapp("melk"));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Innloggingen ble endret før «melk» ble fjernet som basisvare. Ingen skriving ble sendt i dette forsøket.",
      ),
    );
    expect(fjernKnapp("melk")).toBeEnabled();
  });

  it.each([
    ["avvist", "databasen nektet tilgang denne gangen"],
    ["samtidig", "basisvaren endres samtidig på en annen enhet"],
  ] as const)("ukjent → %s: usikkerheten består", async (utfall, grunn) => {
    fjernBasisvare.mockResolvedValueOnce({ utfall: "ukjent" }).mockResolvedValueOnce({ utfall });
    const user = await aapne();
    await user.click(fjernKnapp("melk"));
    await screen.findByRole("alert");
    await user.click(fjernKnapp("melk"));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        `Fortsatt ikke bekreftet om «melk» ble fjernet som basisvare: ${grunn}. Se listen før du prøver igjen.`,
      ),
    );
  });

  it("uteblitt svar eller kastet feil: sier aldri at noe er fjernet", async () => {
    fjernBasisvare.mockResolvedValueOnce({ utfall: "ukjent" });
    fjernBasisvare.mockRejectedValueOnce(new Error("nett"));
    const user = await aapne();
    await user.click(fjernKnapp("melk"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Fikk ikke bekreftet om «melk» ble fjernet.",
    );
    await user.click(fjernKnapp("melk"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Fikk ikke bekreftet om «melk» ble fjernet.",
    );
    expect(screen.queryByText(/er fjernet/)).toBeNull();
  });
});
