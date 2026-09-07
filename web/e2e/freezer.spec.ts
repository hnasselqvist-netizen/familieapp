import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Smoke-test for hele den nye grunnmuren: innlogging → navigasjon →
 * Fryser, som er første ekte vertikale skive. Kjøres KUN mot en
 * emulator-drevet build (§playwright.config.ts) — aldri mot preview
 * eller produksjon.
 */
test("logger inn og legger en vare i fryseren", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await page.getByRole("link", { name: "Mat" }).click();
  await expect(page.getByText("Fryser", { exact: true })).toBeVisible();
  await expect(page.getByText("Fryseren er tom")).toBeVisible();

  const varenavn = `E2E-test-vare-${Date.now()}`;
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill(varenavn);
  await page.getByText(`＋ Opprett «${varenavn}»`).click();
  await page.getByRole("button", { name: "Diverse" }).click();
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();

  await expect(page.getByText(varenavn)).toBeVisible();
});
