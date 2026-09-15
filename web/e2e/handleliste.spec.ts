import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Smoke-test for Handleliste — andre Fase 2-skjerm (§HandlelisteScreen).
 * Kjøres KUN mot en emulator-drevet build (§playwright.config.ts) —
 * aldri mot preview eller produksjon.
 */
test("logger inn, legger til en vare og krysser den av som fullført", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Handle" }).click();
  await expect(page.getByText("Handleliste", { exact: true })).toBeVisible();

  const varenavn = `E2E-test-vare-${Date.now()}`;
  const vareFelt = page.getByPlaceholder("Hva trenger du?");
  await vareFelt.fill(varenavn);
  await page.getByText(`＋ Opprett «${varenavn}»`).click();
  await page.getByRole("button", { name: "Diverse" }).click();
  await page.getByRole("button", { name: "Legg til" }).click();

  await expect(vareFelt).toHaveValue("");
  await expect(page.getByText(varenavn)).toBeVisible();

  await page.getByLabel(`Merk ${varenavn} som fullført`).click();
  // Statuslinjen er nå strukturert med et Icon(check) + tekst i stedet for
  // et "✓"-tegn inni strengen (§Kontrolltårn-review, PR #26, design-review
  // runde 2, §5) — teksten alene er fortsatt "1 fullført".
  await expect(page.getByText("1 fullført", { exact: true })).toBeVisible();
});
