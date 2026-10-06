import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { saldoforlop } from "@domain/liquidity/saldoforlop";
import type { LiquidityPost } from "@app-types/liquidity";
import { SaldoforlopKort } from "./SaldoforlopKort";

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
const tall = (t: string | null) => (t ?? "").replace(/\s/g, " ");
const vis = (saldo: number, poster: LiquidityPost[]) =>
  render(<SaldoforlopKort forlop={saldoforlop(saldo, poster, "2026-10-05", "2026-10-25")} />);

describe("SaldoforlopKort", () => {
  it("vises ikke uten poster i perioden", () => {
    const { container } = vis(5000, []);
    expect(container).toBeEmptyDOMElement();
  });

  it("sier fra når saldoen går under null før lønn, selv om spillerommet er positivt", () => {
    vis(10000, [
      post("Husleie", { amount: 12000, date: "2026-10-15" }),
      post("Lønn", { amount: 38000, direction: "in", date: "2026-10-20" }),
    ]);
    const kort = screen.getByRole("region", { name: "Saldoforløp" });
    expect(tall(kort.textContent)).toContain(
      "Saldoen går under null 15. okt. (−2 000 kr) før den tar seg opp igjen.",
    );
  });

  it("ellers én rolig linje med laveste saldo", () => {
    vis(10000, [post("Strøm", { amount: 1800, date: "2026-10-12" })]);
    expect(tall(screen.getByRole("region").textContent)).toContain(
      "Laveste saldo i perioden: 8 200 kr, 12. okt.",
    );
  });

  it("bare innbetalinger: saldoen går ikke under dagens nivå", () => {
    vis(10000, [post("Lønn", { amount: 100, direction: "in" })]);
    expect(screen.getByText("Saldoen går ikke under dagens nivå i perioden.")).toBeInTheDocument();
  });

  it("dag for dag ved behov, med løpende saldo og laveste dag markert", async () => {
    const user = userEvent.setup();
    vis(10000, [
      post("Strøm", { amount: 1800, date: "2026-10-12" }),
      post("Husleie", { amount: 12000, date: "2026-10-15" }),
      post("Lønn", { amount: 38000, direction: "in", date: "2026-10-20" }),
    ]);
    expect(screen.queryByRole("list", { name: "Dag for dag" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Vis dag for dag" }));
    const rader = within(screen.getByRole("list", { name: "Dag for dag" })).getAllByRole(
      "listitem",
    );
    expect(rader.map((r) => tall(r.textContent))).toEqual([
      "man. 12. okt.Strøm−1 800 kr8 200 kr",
      "tor. 15. okt.Husleie−12 000 kr−3 800 kr",
      "tir. 20. okt.Lønn+38 000 kr34 200 kr",
    ]);
    expect(screen.getByRole("button", { name: "Skjul dag for dag" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
