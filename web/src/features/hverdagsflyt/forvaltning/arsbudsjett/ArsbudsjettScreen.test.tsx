import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BudgetDetail,
  BudsjettGruppe,
  BudsjettPost,
  MaanedTall,
} from "@app-types/budsjettfamilie";
import type { ArsbudsjettPostType, UseArsbudsjettResult } from "@hooks/useArsbudsjett";
import { ArsbudsjettScreen } from "./ArsbudsjettScreen";

/**
 * Årsbudsjett (#59, 6541936120/6541958938): etter «Ja, resten av året»
 * skal ALLE berørte måneder vise det nye beløpet med én gang — uten
 * refresh. Syntetiske data. Den falske hooken oppfører seg som
 * subscriptionen: skrivingen lagres, og nye grupper kommer inn som props.
 */
const MND = ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"];
const tolv = (v = 0) => Array.from({ length: 12 }, () => ({ budget: v, spent: 0 }));
const tolvD = (v = 0) => Array.from({ length: 12 }, () => ({ budget: v }));

const start = (): BudsjettGruppe[] => [
  {
    id: "fritid",
    label: "Fritid",
    items: [
      {
        id: "hobby",
        name: "Hobby",
        months: tolv(0),
        budgetDetails: [
          { id: "nycha", name: "NyCha", months: tolvD(0) },
          { id: "annet", name: "Annet", months: tolvD(50) },
        ],
      },
      { id: "kino", name: "Kino", months: tolv(100), meta: { oppforsel: "fast" } },
    ],
  } as unknown as BudsjettGruppe,
];

const summer = (g: BudsjettGruppe[]) =>
  g.map((gr) => ({
    ...gr,
    items: gr.items.map((it) =>
      it.budgetDetails && it.budgetDetails.length > 0
        ? {
            ...it,
            months: it.months.map((_, mi) => ({
              budget: it.budgetDetails!.reduce((s, d) => s + d.months[mi]!.budget, 0),
              spent: 0,
            })),
          }
        : it,
    ),
  }));

let lagret: BudsjettGruppe[] = [];
let feilNeste = false;
/** Simulerer en ekstern oppdatering (annen enhet / subscription). */
let ekstern: (fn: (g: BudsjettGruppe[]) => BudsjettGruppe[]) => void = () => {};
const skrevet: string[] = [];

vi.mock("@hooks/useArsbudsjett", () => ({
  useArsbudsjett: (): Partial<UseArsbudsjettResult> => {
    const [grupper, setGrupper] = useState(() => summer(start()));
    ekstern = (fn) => {
      lagret = summer(fn(lagret));
      setGrupper(lagret);
    };
    const endre = async (navn: string, fn: (g: BudsjettGruppe[]) => BudsjettGruppe[]) => {
      // Asynkron som RTDB: lagringen kommer etter at kalleren har gått videre.
      await Promise.resolve();
      if (feilNeste) {
        feilNeste = false;
        throw new Error("permission_denied");
      }
      skrevet.push(navn);
      lagret = summer(fn(lagret));
      setGrupper(lagret);
    };
    const post = (g: BudsjettGruppe[], itemId: string, fn: (it: BudsjettPost) => BudsjettPost) =>
      g.map((gr) => ({ ...gr, items: gr.items.map((it) => (it.id === itemId ? fn(it) : it)) }));
    const detalj = (
      it: BudsjettPost,
      detailId: string,
      fn: (mo: { budget: number }, mi: number) => { budget: number },
    ): BudsjettPost => ({
      ...it,
      budgetDetails: (it.budgetDetails ?? []).map((d: BudgetDetail) =>
        d.id === detailId ? { ...d, months: d.months.map(fn) } : d,
      ),
    });
    return {
      currentBudgetYear: 2026,
      valgtAar: 2026,
      gaTilForrigeAar: () => {},
      gaTilNesteAar: () => {},
      grupper: { status: "loaded", data: {} } as UseArsbudsjettResult["grupper"],
      hentGroups: (type: ArsbudsjettPostType) => (type === "kostnad" ? grupper : []),
      hentManglendeDetaljerKildeAar: null,
      updateMonth: (_t, _g, itemId, mi, v) =>
        endre(`month:${itemId}:${mi}`, (g) =>
          post(g, itemId, (it) => ({
            ...it,
            months: it.months.map((mo: MaanedTall, i: number) =>
              i === mi ? { ...mo, budget: v } : mo,
            ),
          })),
        ),
      applyRestOfYear: (_t, _g, itemId, fra, v) =>
        endre(`rest:${itemId}:${fra}`, (g) =>
          post(g, itemId, (it) => ({
            ...it,
            months: it.months.map((mo: MaanedTall, i: number) =>
              i < fra ? mo : { ...mo, budget: v },
            ),
          })),
        ),
      updateDetailMonth: (_t, _g, itemId, detailId, mi, v) =>
        endre(`detail:${detailId}:${mi}`, (g) =>
          post(g, itemId, (it) => detalj(it, detailId, (mo, i) => (i === mi ? { budget: v } : mo))),
        ),
      applyRestOfYearToDetail: (_t, _g, itemId, detailId, fra, v) =>
        endre(`detailrest:${detailId}:${fra}`, (g) =>
          post(g, itemId, (it) => detalj(it, detailId, (mo, i) => (i < fra ? mo : { budget: v }))),
        ),
    };
  },
}));

beforeEach(() => {
  lagret = summer(start());
  feilNeste = false;
  skrevet.length = 0;
});

const celle = (navn: string, mi: number) =>
  screen.getByRole("spinbutton", { name: `${navn} — ${MND[mi]}` });
const verdier = (navn: string) => MND.map((_, mi) => (celle(navn, mi) as HTMLInputElement).value);

async function aapneKostnader(user: ReturnType<typeof userEvent.setup>) {
  render(<ArsbudsjettScreen />);
  await user.click(screen.getByRole("button", { name: "Kostnader" }));
  await user.click(screen.getByText("Fritid"));
}

async function endre(
  user: ReturnType<typeof userEvent.setup>,
  navn: string,
  mi: number,
  v: string,
) {
  const c = celle(navn, mi);
  await user.click(c);
  await user.keyboard(`{Control>}a{/Control}${v}`);
  await user.tab();
}

describe("Årsbudsjett — «samme beløp resten av året» vises uten refresh", () => {
  it("detalj, januar: alle tolv detaljmåneder, foreldreposten og summen oppdateres med én gang", async () => {
    const user = userEvent.setup();
    await aapneKostnader(user);
    await user.click(screen.getByRole("row", { name: /Hobby/ }).querySelector("button")!);

    await endre(user, "NyCha", 0, "265");
    await user.click(screen.getByRole("button", { name: "Ja, resten av året" }));

    await vi.waitFor(() => expect(verdier("NyCha")).toEqual(Array(12).fill("265")));
    // Andre detaljer og foreldreposten (sum av detaljene).
    expect(verdier("Annet")).toEqual(Array(12).fill("50"));
    const hobby = screen.getByRole("row", { name: /Hobby/ });
    expect(within(hobby).getAllByText("315")).toHaveLength(12);
    expect(within(hobby).getByText(/^3\s780$/)).toBeInTheDocument();
    // Lagret = vist.
    const nycha = lagret[0]!.items[0]!.budgetDetails![0]!;
    expect(nycha.months.map((m) => String(m.budget))).toEqual(verdier("NyCha"));
  });

  it("fast post midt i året: tidligere måneder urørt, juni–desember vises med én gang", async () => {
    const user = userEvent.setup();
    await aapneKostnader(user);
    await endre(user, "Kino", 5, "175");
    await user.click(screen.getByRole("button", { name: "Ja, resten av året" }));
    await vi.waitFor(() =>
      expect(verdier("Kino")).toEqual([...Array(5).fill("100"), ...Array(7).fill("175")]),
    );
    expect(lagret[0]!.items[1]!.months.map((m) => String(m.budget))).toEqual(verdier("Kino"));
  });

  it("«Nei, kun juni» endrer bare juni", async () => {
    const user = userEvent.setup();
    await aapneKostnader(user);
    await endre(user, "Kino", 5, "175");
    await user.click(screen.getByRole("button", { name: "Nei, kun juni" }));
    await vi.waitFor(() => expect(skrevet).toEqual(["month:kino:5"]));
    expect(verdier("Kino")).toEqual([...Array(5).fill("100"), "175", ...Array(6).fill("100")]);
  });

  it("desember spør ikke om resten av året", async () => {
    const user = userEvent.setup();
    await aapneKostnader(user);
    await endre(user, "Kino", 11, "300");
    expect(screen.queryByRole("button", { name: "Ja, resten av året" })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(verdier("Kino")[11]).toBe("300"));
  });

  it("raske handlinger: bekreftelse rett etter blur gir riktig resultat i begge måneder", async () => {
    const user = userEvent.setup();
    await aapneKostnader(user);
    await endre(user, "Kino", 2, "120");
    await user.click(screen.getByRole("button", { name: "Ja, resten av året" }));
    await endre(user, "Kino", 0, "90");
    await user.click(screen.getByRole("button", { name: /Nei, kun januar/ }));
    await vi.waitFor(() =>
      expect(verdier("Kino")).toEqual(["90", "100", ...Array(10).fill("120")]),
    );
  });

  it("pågående inntasting overlever en ekstern oppdatering av samme post", async () => {
    const user = userEvent.setup();
    await aapneKostnader(user);
    await user.click(celle("Kino", 8));
    await user.keyboard("{Control>}a{/Control}99");
    // En annen enhet endrer posten mens september redigeres.
    act(() =>
      ekstern((g) =>
        g.map((gr) => ({
          ...gr,
          items: gr.items.map((it) =>
            it.id === "kino"
              ? { ...it, months: it.months.map((mo) => ({ ...mo, budget: 130 })) }
              : it,
          ),
        })),
      ),
    );
    expect(verdier("Kino")[3]).toBe("130");
    expect(verdier("Kino")[8]).toBe("99");
    await user.tab();
    await vi.waitFor(() => expect(lagret[0]!.items[1]!.months[8]!.budget).toBe(99));
    expect(verdier("Kino")[8]).toBe("99");
  });

  it("lagringsfeil vises ærlig, og feltet viser det som faktisk er lagret", async () => {
    const user = userEvent.setup();
    await aapneKostnader(user);
    feilNeste = true;
    await endre(user, "Kino", 11, "300");
    expect(await screen.findByRole("alert")).toHaveTextContent(/ble ikke lagret/);
    expect(verdier("Kino")[11]).toBe("100");
  });
});
