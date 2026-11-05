import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PrognoseDato } from "./PrognoseDato";

const IDAG = new Date("2026-10-05T12:00:00");
const vis = (prognosisDate: string) => {
  const onSave = vi.fn();
  render(
    <>
      <PrognoseDato prognosisDate={prognosisDate} onSave={onSave} idag={IDAG} />
      <button type="button">et annet sted</button>
    </>,
  );
  return onSave;
};
const felt = () => screen.getByLabelText("Prognose frem til") as HTMLInputElement;
const velg = (dato: string) => fireEvent.change(felt(), { target: { value: dato } });

describe("PrognoseDato — regresjon for «hopper tilbake til 31. august» (#59 6001944213)", () => {
  it("lagrer valgt dato når feltet forlater fokus (datovelgerens «Ferdig» / trykk utenfor)", async () => {
    const user = userEvent.setup();
    const onSave = vis("2026-10-20");
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    velg("2026-10-25");
    await user.click(screen.getByRole("button", { name: "et annet sted" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("2026-10-25");
  });

  it("lagrer med ✓-knappen, uten å miste klikket til blur", async () => {
    const user = userEvent.setup();
    const onSave = vis("2026-10-20");
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    velg("2026-11-20");
    await user.click(screen.getByRole("button", { name: "Lagre dato" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("2026-11-20");
  });

  it("lagrer med Enter, og Escape avbryter uten å lagre", async () => {
    const user = userEvent.setup();
    const onSave = vis("2026-10-20");
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    velg("2026-10-30");
    await user.keyboard("{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    velg("2026-10-30");
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledExactlyOnceWith("2026-10-30");
  });

  it("skriver ikke når datoen er uendret eller tømt", async () => {
    const user = userEvent.setup();
    const onSave = vis("2026-10-20");
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    await user.click(screen.getByRole("button", { name: "et annet sted" }));
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    velg("");
    await user.click(screen.getByRole("button", { name: "et annet sted" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("en passert dato vises som passert, og redigeringen starter på neste lønningsdag", async () => {
    const user = userEvent.setup();
    const onSave = vis("2026-08-31");
    const knapp = screen.getByRole("button", { name: /Endre prognosedato/ });
    expect(knapp).toHaveTextContent("31. aug. · passert");
    expect(knapp).toHaveAccessibleName("Endre prognosedato, nå 31. aug. (passert)");
    await user.click(knapp);
    expect(felt().value).toBe("2026-10-20");
    // Ingenting lagres bare av å åpne feltet; å bekrefte forslaget lagrer det.
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Lagre dato" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("2026-10-20");
  });

  it("i dag er ikke passert", () => {
    vis("2026-10-05");
    expect(screen.getByRole("button", { name: /Endre prognosedato/ })).not.toHaveTextContent(
      "passert",
    );
  });
});

describe("PrognoseDato uten lagret dato (funn H, #59 6669823460)", () => {
  it("viser standarddatoen generatoren bruker, rolig merket, med samsvarende skjermlesertekst", () => {
    vis("");
    const knapp = screen.getByRole("button", { name: /Endre prognosedato/ });
    expect(knapp).toHaveTextContent("20. okt. · standard");
    expect(knapp).not.toHaveTextContent("Velg dato");
    expect(knapp).toHaveAccessibleName("Endre prognosedato, nå 20. okt. (standard, ikke lagret)");
  });

  it("åpne og forlate feltet, eller Escape, lagrer ingenting", async () => {
    const user = userEvent.setup();
    const onSave = vis("");
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    expect(felt().value).toBe("2026-10-20");
    await user.click(screen.getByRole("button", { name: "et annet sted" }));
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    await user.keyboard("{Escape}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("eksplisitt bekreftelse av standarden (✓ eller Enter) lagrer den", async () => {
    const user = userEvent.setup();
    const onSave = vis("");
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledExactlyOnceWith("2026-10-20");
  });

  it("eksplisitt endring lagres som før", async () => {
    const user = userEvent.setup();
    const onSave = vis("");
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    velg("2026-11-05");
    await user.click(screen.getByRole("button", { name: "et annet sted" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("2026-11-05");
  });

  it("passert lagret dato: å åpne og forlate feltet ruller den ikke automatisk", async () => {
    const user = userEvent.setup();
    const onSave = vis("2026-08-31");
    await user.click(screen.getByRole("button", { name: /Endre prognosedato/ }));
    expect(felt().value).toBe("2026-10-20");
    await user.click(screen.getByRole("button", { name: "et annet sted" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Endre prognosedato/ })).toHaveTextContent(
      "31. aug. · passert",
    );
  });

  it("lagret dato vises uten standardmerke", () => {
    vis("2026-11-05");
    const knapp = screen.getByRole("button", { name: /Endre prognosedato/ });
    expect(knapp).toHaveTextContent("5. nov.");
    expect(knapp).not.toHaveTextContent("standard");
    expect(knapp).toHaveAccessibleName("Endre prognosedato, nå 5. nov.");
  });
});
