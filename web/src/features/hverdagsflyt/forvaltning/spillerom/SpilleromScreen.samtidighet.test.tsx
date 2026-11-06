/**
 * Samtidighet i React-Spillerom (#59, ordre 6675906923): redigering sender
 * bare endrede felt med grunnlag; konflikt og andre lagringsfeil vises
 * synlig, og dialogen lukkes ikke med en falsk kvittering. Datahook mocket.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Liquidity, LiquidityPost } from "@app-types/liquidity";
import { loaded } from "@app-types/status";

const h = vi.hoisted(() => ({
  editPost: vi.fn(),
  addPost: vi.fn(),
  prognosefeil: null as string | null,
}));

const POST: LiquidityPost = {
  id: "m1",
  name: "Husleie",
  amount: 100,
  direction: "out",
  date: "2026-11-25",
  type: "extra",
  kilde: "manuell",
};
const DATA: Liquidity = {
  saldo: 5000,
  saldoUpdated: Date.now(),
  prognosisDate: "2026-11-30",
  lonnDay: 20,
  posts: { m1: POST },
};

vi.mock("@hooks/useLiquidity", () => ({
  useLiquidity: () => ({
    liquidity: loaded(DATA),
    saveSaldo: async () => {},
    savePrognosisDate: async () => {},
    addPost: h.addPost,
    removePost: async () => {},
    markFulfilled: async () => {},
    unmarkFulfilled: async () => {},
    editPost: h.editPost,
    regenerate: async () => {},
    forfallsdagMangler: loaded([]),
    prognosefeil: h.prognosefeil,
  }),
}));
vi.mock("@hooks/useFamilyId", () => ({ useFamilyId: () => "familie1" }));
vi.mock("@data/budsjettfamilie.repository", () => ({ subscribeBudsjettGrupper: () => () => {} }));

const { SpilleromScreen } = await import("./SpilleromScreen");
const { LikviditetKonflikt } = await import("@data/liquidity.repository");

const vis = () =>
  render(
    <MemoryRouter>
      <SpilleromScreen />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.editPost.mockReset();
  h.addPost.mockReset();
  h.prognosefeil = null;
});

async function aapneRedigering(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Husleie"));
  return screen.getByRole("dialog");
}

describe("SpilleromScreen — samtidighet", () => {
  it("lagrer bare endrede felt, med grunnlaget fra da redigeringen startet", async () => {
    const user = userEvent.setup();
    h.editPost.mockResolvedValue(undefined);
    vis();
    const dialog = await aapneRedigering(user);
    const belop = within(dialog).getByPlaceholderText("Beløp");
    await user.clear(belop);
    await user.type(belop, "150");
    await user.click(within(dialog).getByRole("button", { name: "Lagre" }));
    expect(h.editPost).toHaveBeenCalledExactlyOnceWith("m1", { amount: 150 }, { amount: 100 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ingen endring: ingen skriving", async () => {
    const user = userEvent.setup();
    vis();
    const dialog = await aapneRedigering(user);
    await user.click(within(dialog).getByRole("button", { name: "Lagre" }));
    expect(h.editPost).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("konflikt: synlig feil, dialogen og utkastet står", async () => {
    const user = userEvent.setup();
    h.editPost.mockRejectedValue(
      new LikviditetKonflikt("Posten er endret på en annen enhet siden du åpnet den.", "konflikt"),
    );
    vis();
    const dialog = await aapneRedigering(user);
    const belop = within(dialog).getByPlaceholderText("Beløp");
    await user.clear(belop);
    await user.type(belop, "150");
    await user.click(within(dialog).getByRole("button", { name: "Lagre" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Posten er endret på en annen enhet",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("Beløp")).toHaveValue("150");
  });

  it("feil ved oppretting vises, ingen stille tap", async () => {
    const user = userEvent.setup();
    h.addPost.mockRejectedValue(new Error("permission_denied"));
    vis();
    await user.click(screen.getByRole("button", { name: /Legg til post/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText(/Navn/), "Ny");
    await user.type(within(dialog).getByPlaceholderText(/Beløp/), "50");
    await user.click(within(dialog).getByRole("button", { name: /Legg til|Lagre/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Posten ble ikke lagt til: permission_denied",
    );
  });

  it("feil fra regenerering vises", () => {
    h.prognosefeil = "Prognosen ble ikke oppdatert: nettverksfeil";
    vis();
    expect(screen.getByRole("alert")).toHaveTextContent("Prognosen ble ikke oppdatert");
  });
});
