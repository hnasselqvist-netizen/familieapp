import { expect, test, type Page } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Forvaltning-navigasjon (#59, Kontrolltårnet 2026-10-07): fast fanerad med
 * fem deler. Hver del kan nås fra hver annen del, også når arbeidskøene er
 * tomme, og direkte lenker fra Gangen og Lønnsdagsrunden lander på riktig
 * fane. Ingen data skrives.
 */
async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByText("Det viktigste for deg nå")).toBeVisible();
}

const faner = (page: Page) => page.getByRole("navigation", { name: "Forvaltning-navigasjon" });
const aktivFane = (page: Page) => faner(page).locator('[aria-current="page"]');

test("alle fem delene kan nås fra fanene, også når ingenting venter", async ({ page }) => {
  await loggInn(page);
  await page.goto("/forvaltning");
  await expect(aktivFane(page)).toHaveText("Oversikt");

  const deler: [string, string, RegExp][] = [
    ["Transaksjoner", "Transaksjoner", /\/forvaltning\/transaksjoner$/],
    ["Kvitteringer", "Kvitteringer", /\/forvaltning\/kvitteringer$/],
    ["Økonomi", "Økonomien", /\/forvaltning\/okonomi$/],
    ["Spillerom", "Spillerom", /\/forvaltning\/spillerom$/],
    ["Oversikt", "Forvaltning", /\/forvaltning$/],
  ];
  for (const [fane, tittel, url] of deler) {
    await faner(page).getByRole("link", { name: fane }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1, name: tittel })).toBeVisible();
    await expect(aktivFane(page)).toHaveText(fane);
  }
});

test("lenker fra Gangen og Lønnsdagsrunden lander på riktig fane, med veien tilbake", async ({
  page,
}) => {
  await loggInn(page);

  // Gangen sender til kvitteringsinnboksen med fra=gangen.
  await page.goto("/forvaltning/kvitteringer?fra=gangen");
  await expect(aktivFane(page)).toHaveText("Kvitteringer");
  await expect(page.getByRole("link", { name: "Gangen" })).toBeVisible();

  // Runden er et forløp fra Oversikt; stegene åpner riktig fane.
  await page.goto("/forvaltning/runde");
  await expect(aktivFane(page)).toHaveText("Oversikt");
  await page
    .getByRole("list", { name: "Steg i runden" })
    .getByRole("link", { name: /Oppdater Spillerom/ })
    .click();
  await expect(page).toHaveURL(/\/forvaltning\/spillerom\?fra=runde$/);
  await expect(aktivFane(page)).toHaveText("Spillerom");
  await page.getByRole("link", { name: "Lønnsdagsrunden" }).click();
  await expect(page).toHaveURL(/\/forvaltning\/runde$/);
  await expect(aktivFane(page)).toHaveText("Oversikt");
});
