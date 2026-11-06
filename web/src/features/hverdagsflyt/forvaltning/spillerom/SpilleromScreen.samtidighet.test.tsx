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
  posts: {
    m1: POST,
    m2: { ...POST, id: "m2", name: "Strøm", amount: 200 },
  },
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

async function aapneRedigering(user: ReturnType<typeof userEvent.setup>, navn = "Husleie") {
  await user.click(screen.getByText(navn));
  return screen.getByRole("dialog");
}

function utsatt() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Åpner Husleie, endrer beløp til 150, trykker Lagre og lukker med Avbryt mens lagringen pågår. */
async function lagreOgLukk(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await aapneRedigering(user);
  const belop = within(dialog).getByPlaceholderText("Beløp");
  await user.clear(belop);
  await user.type(belop, "150");
  await user.click(within(dialog).getByRole("button", { name: "Lagre" }));
  await user.click(within(dialog).getByRole("button", { name: "Avbryt" }));
  expect(screen.queryByRole("dialog")).toBeNull();
}

async function skrivBelop(user: ReturnType<typeof userEvent.setup>, navn: string, verdi: string) {
  const dialog = await aapneRedigering(user, navn);
  const belop = within(dialog).getByPlaceholderText("Beløp");
  await user.clear(belop);
  await user.type(belop, verdi);
  return dialog;
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

  // #118, R2: et sent lagreutfall gjelder bare økten det ble startet fra.
  it("sen suksess etter lukking og gjenåpning av samme post: det nye utkastet står", async () => {
    const user = userEvent.setup();
    const forste = utsatt();
    h.editPost.mockReturnValueOnce(forste.promise);
    vis();
    await lagreOgLukk(user);
    const ny = await skrivBelop(user, "Husleie", "999");
    forste.resolve();
    await forste.promise;
    await waitFor(() => expect(h.editPost).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBe(ny);
    expect(within(ny).getByPlaceholderText("Beløp")).toHaveValue("999");
    expect(within(ny).queryByRole("alert")).toBeNull();
    expect(within(ny).getByRole("button", { name: "Lagre" })).toBeEnabled();
  });

  it("sen avvisning etter lukking og gjenåpning: ny dialog uten gammel feil, feilen i banneret", async () => {
    const user = userEvent.setup();
    const forste = utsatt();
    h.editPost.mockReturnValueOnce(forste.promise);
    vis();
    await lagreOgLukk(user);
    const ny = await skrivBelop(user, "Husleie", "999");
    forste.reject(new LikviditetKonflikt("Posten er endret på en annen enhet.", "konflikt"));
    expect(await screen.findByText(/Endringen av «Husleie» ble ikke lagret/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBe(ny);
    expect(within(ny).getByPlaceholderText("Beløp")).toHaveValue("999");
    expect(within(ny).queryByRole("alert")).toBeNull();
  });

  it("sen avvisning etter radbytte: den andre postens utkast står, feilen i banneret", async () => {
    const user = userEvent.setup();
    const forste = utsatt();
    h.editPost.mockReturnValueOnce(forste.promise);
    vis();
    await lagreOgLukk(user);
    const strom = await skrivBelop(user, "Strøm", "321");
    forste.reject(new Error("nettverksfeil"));
    expect(
      await screen.findByText(/Endringen av «Husleie» ble ikke lagret: nettverksfeil/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBe(strom);
    expect(within(strom).getByPlaceholderText("Beløp")).toHaveValue("321");
    expect(within(strom).queryByRole("alert")).toBeNull();
  });

  it("sen suksess etter radbytte lukker ikke den andre dialogen", async () => {
    const user = userEvent.setup();
    const forste = utsatt();
    h.editPost.mockReturnValueOnce(forste.promise);
    vis();
    await lagreOgLukk(user);
    const strom = await skrivBelop(user, "Strøm", "321");
    forste.resolve();
    await forste.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("dialog")).toBe(strom);
    expect(within(strom).getByPlaceholderText("Beløp")).toHaveValue("321");
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
