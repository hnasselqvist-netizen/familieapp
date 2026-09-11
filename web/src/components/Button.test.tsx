import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("er alltid type=button — ingen eksisterende Mat-bruk er en ekte skjema-submit", () => {
    render(<Button>Lagre</Button>);
    expect(screen.getByRole("button", { name: "Lagre" })).toHaveAttribute("type", "button");
  });

  it("kaller onClick ved trykk", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Lagre</Button>);
    await user.click(screen.getByRole("button", { name: "Lagre" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("respekterer disabled — ingen onClick-kall ved trykk", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Lagre
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Lagre" });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("loading tvinger disabled og viser en spinner, selv uten eksplisitt disabled-prop", () => {
    const { container } = render(<Button loading>Lagre</Button>);
    const btn = screen.getByRole("button", { name: /Lagre/ });
    expect(btn).toBeDisabled();
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
  });

  it("ingen spinner når loading er false/utelatt", () => {
    const { container } = render(<Button>Lagre</Button>);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeInTheDocument();
  });

  it("loading eksponeres tilgjengelig via aria-busy på knappen selv, ikke bare visuelt via spinneren (§Kontrolltårn-review, PR #22)", () => {
    render(<Button loading>Lagre</Button>);
    expect(screen.getByRole("button", { name: /Lagre/ })).toHaveAttribute("aria-busy", "true");
  });

  it("aria-busy er false når loading er utelatt", () => {
    render(<Button>Lagre</Button>);
    expect(screen.getByRole("button", { name: "Lagre" })).toHaveAttribute("aria-busy", "false");
  });

  it("standard variant er primary", () => {
    render(<Button>Lagre</Button>);
    expect(screen.getByRole("button", { name: "Lagre" }).className).toMatch(/primary/);
  });

  it("secondary-variant kan velges eksplisitt", () => {
    render(<Button variant="secondary">Avbryt</Button>);
    const btn = screen.getByRole("button", { name: "Avbryt" });
    expect(btn.className).toMatch(/secondary/);
    expect(btn.className).not.toMatch(/primary/);
  });
});
