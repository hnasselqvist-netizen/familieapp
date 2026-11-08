import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * `/hjem-familie` på mobil (#20, #128 punkt 1) — KUN mot emulatoren.
 * Inngangen til Gaver og juleplanlegging står, lenken til dagens app
 * (LegacyBridge) er borte, ingen vannrett rulling, og lenken går til
 * /hjem-familie/gaver.
 */
test("Hjem & familie på mobil: bare inngangen til Gaver, ingen lenke til dagens app", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await page.getByRole("link", { name: "Hjem & familie" }).click();
  await expect(page).toHaveURL(/\/hjem-familie$/);
  const gaver = page.getByRole("link", { name: /Gaver og juleplanlegging/ });
  await expect(gaver).toBeVisible();
  await expect(page.getByText(/ikke migrert til den nye grunnmuren/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Åpne i dagens app/ })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "390 px uten vannrett rulling",
  ).toBe(true);
  await page.screenshot({ path: "test-results/hjem-familie-390.png" });

  await gaver.click();
  await expect(page).toHaveURL(/\/hjem-familie\/gaver$/);
  await expect(page.getByRole("heading", { name: "Gaver" })).toBeVisible();
});
