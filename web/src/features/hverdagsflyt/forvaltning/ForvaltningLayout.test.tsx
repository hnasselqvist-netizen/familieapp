import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForvaltningLayout } from "./ForvaltningLayout";
import { aktivFane } from "./forvaltningFaner";

const gate = vi.hoisted(() => ({ aktiv: true }));
vi.mock("@hooks/forsoningAktivering", () => ({ forsoningSkrivingAktiv: () => gate.aktiv }));

function vis(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/forvaltning" element={<ForvaltningLayout />}>
          <Route index element={<div>Oversikt-innhold</div>} />
          <Route path="*" element={<div>Del-innhold</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const nav = () => screen.getByRole("navigation", { name: "Forvaltning-navigasjon" });

beforeEach(() => {
  gate.aktiv = true;
});

describe("ForvaltningLayout (#59)", () => {
  it("viser alltid de fem faste delene, med synlig navn og riktig adresse", () => {
    vis("/forvaltning");
    expect(
      within(nav())
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["Oversikt", "/forvaltning"],
      ["Spillerom", "/forvaltning/spillerom"],
      ["Transaksjoner", "/forvaltning/transaksjoner"],
      ["Kvitteringer", "/forvaltning/kvitteringer"],
      ["Økonomi", "/forvaltning/okonomi"],
    ]);
    expect(screen.getByText("Oversikt-innhold")).toBeInTheDocument();
  });

  it.each([
    ["/forvaltning", "Oversikt"],
    ["/forvaltning/spillerom?fra=runde", "Spillerom"],
    ["/forvaltning/transaksjoner?ko=forslag&fra=gangen", "Transaksjoner"],
    ["/forvaltning/kvitteringer?fra=gangen", "Kvitteringer"],
    ["/forvaltning/okonomi?omrade=sparing", "Økonomi"],
    ["/forvaltning/runde", "Oversikt"],
    ["/forvaltning/regelsenter", "Oversikt"],
    ["/forvaltning/arsbudsjett", "Oversikt"],
  ])("%s → aktiv fane «%s»", (url, navn) => {
    vis(url);
    const aktive = within(nav())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(aktive.map((a) => a.textContent)).toEqual([navn]);
  });

  it("med forsoningsporten av (rollback) vises ingen fanerad", () => {
    gate.aktiv = false;
    vis("/forvaltning");
    expect(screen.queryByRole("navigation", { name: "Forvaltning-navigasjon" })).toBeNull();
    expect(screen.getByText("Oversikt-innhold")).toBeInTheDocument();
  });
});

describe("aktivFane", () => {
  it("tåler skråstrek på slutten og ukjente underruter", () => {
    expect(aktivFane("/forvaltning/")).toBe("/forvaltning");
    expect(aktivFane("/forvaltning/spillerom/")).toBe("/forvaltning/spillerom");
    expect(aktivFane("/forvaltning/noe-nytt")).toBe("/forvaltning");
    expect(aktivFane("/forvaltning/avstemming")).toBe("/forvaltning");
    // Prefiks må være et helt ledd: «spillerommet» er ikke Spillerom.
    expect(aktivFane("/forvaltning/spillerommet")).toBe("/forvaltning");
  });
});
