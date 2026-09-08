import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Smoke-test for Kokebok — første Fase 2-skjerm (§RecipesScreen).
 * Kjøres KUN mot en emulator-drevet build (§playwright.config.ts) —
 * aldri mot preview eller produksjon.
 */
test("logger inn, legger til en hurtig-oppskrift og ser den i listen", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Kokebok" }).click();
  await expect(page.getByText("Kokebok", { exact: true })).toBeVisible();

  const oppskriftsnavn = `E2E-test-oppskrift-${Date.now()}`;
  await page.getByRole("button", { name: "＋ Legg til" }).click();
  await page.getByPlaceholder("Navn på retten…").fill(oppskriftsnavn);

  const ingrediensFelt = page.getByPlaceholder("f.eks. Kjøttdeig");
  await ingrediensFelt.fill("Løk");
  await page.getByText("＋ Opprett «Løk»").click();
  await page.getByRole("button", { name: "Diverse" }).click();

  await page.getByRole("button", { name: `Lagre «${oppskriftsnavn}»` }).click();

  await expect(page.getByText(oppskriftsnavn)).toBeVisible();

  // Åpne detaljvisningen og bekreft at ingrediensen ble lagret.
  await page.getByText(oppskriftsnavn).click();
  await expect(page.getByText("Løk")).toBeVisible();
});
