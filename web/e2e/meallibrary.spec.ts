import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Smoke-test for Middagsbibliotek — tredje Fase 2-skjerm
 * (§MealLibraryScreen). Kjøres KUN mot en emulator-drevet build
 * (§playwright.config.ts) — aldri mot preview eller produksjon.
 */
test("logger inn, legger til en middag og en vare i handlegrunnlaget", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Bibliotek" }).click();
  await expect(page.getByText("Middagsbibliotek", { exact: true })).toBeVisible();

  // "Legg til middag" åpner nå en modal fra headerhandlingen
  // (§Kontrolltårn-review, PR #26, §5) — var tidligere en alltid-synlig
  // `Card` øverst.
  await page.getByRole("button", { name: "＋ Legg til middag" }).click();

  const middagsnavn = `E2E-test-middag-${Date.now()}`;
  const middagFelt = page.getByPlaceholder("f.eks. Kyllingsuppe");
  await middagFelt.fill(middagsnavn);
  await page.getByRole("button", { name: "Legg til", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "Legg til middag" })).not.toBeVisible();
  await expect(page.getByText(middagsnavn)).toBeVisible();

  // Åpne handlegrunnlaget og legg til en vare.
  await page.getByText(middagsnavn).click();
  const vareFelt = page.getByPlaceholder("Legg til vare…");
  await vareFelt.fill("Kylling");
  await page.getByText("＋ Opprett «Kylling»").click();
  await page.getByRole("button", { name: "Diverse" }).click();

  await expect(page.getByText("Handlegrunnlag")).toBeVisible();
  await expect(page.getByPlaceholder("Søk eller skriv ny vare…")).toHaveValue("Kylling");
});
