import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LiquidityPost } from "@app-types/liquidity";
import { HvaHvisKort } from "./HvaHvisKort";

const post = (id: string, o: Partial<LiquidityPost>): LiquidityPost => ({
  id,
  name: id,
  amount: 0,
  direction: "out",
  date: "2026-10-10",
  type: "fast",
  kilde: "manuell",
  ...o,
});
const poster = [
  post("Husleie", { amount: 12000, date: "2026-10-15" }),
  post("Lønn", { amount: 38000, direction: "in", date: "2026-10-20" }),
];
const tall = (t: string | null | undefined) => (t ?? "").replace(/\s/g, " ");

const vis = () => {
  const onLeggInn = vi.fn();
  render(
    <HvaHvisKort
      saldo={15000}
      poster={poster}
      idag="2026-10-06"
      prognosisDate="2026-10-25"
      onLeggInn={onLeggInn}
    />,
  );
  return onLeggInn;
};
const apne = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Hva hvis…?" }));
const settDato = (d: string) =>
  fireEvent.change(screen.getByLabelText("Dato"), { target: { value: d } });

describe("HvaHvisKort (#59)", () => {
  it("er lukket som standard og lagrer ingenting av seg selv", async () => {
    const user = userEvent.setup();
    const onLeggInn = vis();
    expect(screen.queryByRole("region", { name: "Hva hvis" })).toBeNull();
    await apne(user);
    await user.type(screen.getByLabelText("Beløp"), "5000");
    expect(onLeggInn).not.toHaveBeenCalled();
  });

  it("viser nytt spillerom og varsler når kjøpet får saldoen under null før lønn", async () => {
    const user = userEvent.setup();
    vis();
    await apne(user);
    await user.type(screen.getByLabelText("Beløp"), "5000");
    settDato("2026-10-08");
    const svar = within(screen.getByRole("region", { name: "Hva hvis" }));
    expect(tall(svar.getByText(/Spillerommet blir/).textContent)).toBe(
      "Spillerommet blir 36 000 kr (−5 000 kr)",
    );
    expect(tall(svar.getByText(/Saldoen går under null/).textContent)).toBe(
      "Saldoen går under null 15. okt. (−2 000 kr).",
    );
  });

  it("«Vi får inn» øker spillerommet", async () => {
    const user = userEvent.setup();
    vis();
    await apne(user);
    await user.click(screen.getByRole("radio", { name: "Vi får inn" }));
    await user.type(screen.getByLabelText("Beløp"), "2 000");
    expect(tall(screen.getByText(/Spillerommet blir/).textContent)).toBe(
      "Spillerommet blir 43 000 kr (+2 000 kr)",
    );
  });

  it("en dato etter prognosen endrer ikke spillerommet, og det sies tydelig", async () => {
    const user = userEvent.setup();
    vis();
    await apne(user);
    await user.type(screen.getByLabelText("Beløp"), "5000");
    settDato("2026-11-02");
    expect(screen.getByText(/ligger utenfor prognosen/)).toBeInTheDocument();
  });

  it("«Legg inn som post» lagrer scenarioet som en vanlig post, først når brukeren ber om det", async () => {
    const user = userEvent.setup();
    const onLeggInn = vis();
    await apne(user);
    await user.type(screen.getByLabelText("Beløp"), "4999,5");
    settDato("2026-10-09");
    await user.type(screen.getByLabelText("Hva gjelder det? (valgfritt)"), "Sykkel");
    await user.click(screen.getByRole("button", { name: "Legg inn som post" }));
    expect(onLeggInn).toHaveBeenCalledExactlyOnceWith({
      name: "Sykkel",
      amount: 4999.5,
      direction: "out",
      date: "2026-10-09",
      type: "extra",
    });
    expect(screen.getByRole("button", { name: "Hva hvis…?" })).toBeInTheDocument();
  });

  it("uten gyldig beløp vises ikke noe svar", async () => {
    const user = userEvent.setup();
    vis();
    await apne(user);
    await user.type(screen.getByLabelText("Beløp"), "abc");
    expect(screen.queryByText(/Spillerommet blir/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Legg inn som post" })).toBeNull();
  });
});
