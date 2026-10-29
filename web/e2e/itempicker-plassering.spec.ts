import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * #82: vareforslagene skal ligge ved det aktive feltet i rediger-middag-
 * modalen på en lav mobilskjerm — også etter at modalen er rullet, og når
 * plassen under feltet er for liten. Lav viewport-høyde etterligner at
 * tastaturet tar plassen. Kjøres KUN mot emulatoren (§playwright.config.ts).
 *
 * Dette er Chromium med ekte layout. Selve iOS/WebKit-avviket
 * (`getBoundingClientRect()` relativt til synlig viewport) kan ikke
 * framkalles her; det dekkes av `ItemPicker.test.tsx`.
 */
test.use({ viewport: { width: 390, height: 560 }, hasTouch: true });

async function loggInnOgApneNyMiddag(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Bibliotek" }).click();
  await page.getByRole("button", { name: "＋ Legg til middag" }).click();
  const navn = `E2E-plassering-${Date.now()}`;
  await page.getByPlaceholder("f.eks. Kyllingsuppe").fill(navn);
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await page.getByText(navn).click();
  return page.getByRole("dialog", { name: navn });
}

/** Listen skal ha en kant mot inputen (under eller over) og være helt synlig. */
async function forventForankret(page: Page, felt: Locator, liste: Locator) {
  const f = await felt.boundingBox();
  const l = await liste.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(f && l).toBeTruthy();
  const under = Math.abs(l!.y - (f!.y + f!.height));
  const over = Math.abs(l!.y + l!.height - f!.y);
  expect(Math.min(under, over)).toBeLessThanOrEqual(2);
  expect(l!.y).toBeGreaterThanOrEqual(0);
  expect(l!.y + l!.height).toBeLessThanOrEqual(vh);
}

test("forslag og «Opprett» følger handlegrunnlagsfeltet etter rulling i modalen, og valget treffer", async ({
  page,
}) => {
  const dialog = await loggInnOgApneNyMiddag(page);
  const felt = dialog.getByPlaceholder("Legg til vare…");

  // Rull modalen slik at feltet ligger lavt på skjermen, der det er lite plass under.
  await dialog.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await felt.scrollIntoViewIfNeeded();

  const varenavn = `Løvb${Date.now() % 100000}`;
  await felt.click();
  await felt.fill(varenavn);
  const opprett = page.getByText(`＋ Opprett «${varenavn}»`);
  await expect(opprett).toBeVisible();
  const liste = opprett.locator("..");
  await forventForankret(page, felt, liste);

  // Rull modalen mens listen er åpen: listen skal følge feltet.
  await dialog.evaluate((el) => {
    el.scrollTop = Math.max(0, el.scrollTop - 40);
  });
  await expect(async () => forventForankret(page, felt, liste)).toPass({ timeout: 2000 });

  // Trykket treffer: oppretter riktig vare i handlegrunnlaget.
  await opprett.click();
  await page.getByRole("button", { name: "Diverse" }).click();
  await expect(dialog.getByLabel(`Fjern ${varenavn} fra handlegrunnlaget`)).toBeVisible();
});
