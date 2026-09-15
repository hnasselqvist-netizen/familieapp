import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Smoke-test for Gangen — Hverdagsflyts native `web/`-inngang
 * (§GangenScreen.tsx, §Kontrolltårn-handoff, Issue #20, "hovedløft").
 * Sjekker kun det som er sant UANSETT hvilken data de andre e2e-
 * spesifikasjonene har skrevet til den delte emulator-databasen i denne
 * kjøringen (samme emulatorinstans for hele suiten, §playwright.config.ts)
 * — ikke "Det viktigste"/"Vi ordner" sitt konkrete innhold, som er
 * avhengig av rekkefølgen andre spesifikasjoner kjører i.
 */
test("logger inn og lander på Gangen med forventet struktur", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await expect(page.getByText("HJEM", { exact: true })).toBeVisible();
  await expect(page.getByText("Det viktigste for deg nå")).toBeVisible();
  await expect(page.getByText("Resten kan vente litt.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Hjem", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("link", { name: "Mat", exact: true }).click();
  await expect(page.getByText("Middagsplan", { exact: true })).toBeVisible();
});
