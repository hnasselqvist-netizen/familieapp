import { expect, test, type Locator, type Page } from "@playwright/test";
import { DATABASE_URL, E2E_USER, FAMILY_ID } from "./seed-config.mjs";

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

/**
 * #83-review: lang liste med egen rulling. Touch-rulling i listen skal
 * verken velge en rad eller lukke listen, og et trykk på et treff som
 * først lå utenfor rulleområdet skal velge akkurat det.
 */
test("touch-rulling i lang forslagsliste velger ikke, og et trykk på treffet lenger ned velger riktig vare", async ({
  page,
  request,
}) => {
  // Seks varer med felles prefiks, seedet direkte i EMULATOREN (aldri produksjon).
  const prefiks = `Rull${Date.now() % 1000000}`;
  const navn = Array.from({ length: 6 }, (_, i) => `${prefiks} vare ${i + 1}`);
  const db = new URL(DATABASE_URL);
  for (const [i, n] of navn.entries()) {
    const url = `${db.origin}/families/${FAMILY_ID}/items/e2e-${prefiks}-${i}.json?ns=${db.searchParams.get("ns")}`;
    const svar = await request.put(url, {
      headers: { Authorization: "Bearer owner" },
      data: { name: n, cat: "Diverse" },
    });
    expect(svar.ok()).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 260 });
  const dialog = await loggInnOgApneNyMiddag(page);
  const felt = dialog.getByPlaceholder("Legg til vare…");
  await felt.scrollIntoViewIfNeeded();
  await felt.click();
  await felt.fill(prefiks);

  const siste = page.getByText(navn[5]!, { exact: true });
  const liste = page.getByText(navn[0]!, { exact: true }).locator("../..");
  await expect(page.getByText(navn[0]!, { exact: true })).toBeVisible();
  await forventForankret(page, felt, liste);

  // Forutsetning: listen er faktisk rullbar, og siste treff ligger utenfor.
  const { scrollHeight, clientHeight } = await liste.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  // Midten av siste treff ligger under listens synlige kant: må rulles fram.
  const listeBoks = (await liste.boundingBox())!;
  const sisteBoks = (await siste.boundingBox())!;
  expect(sisteBoks.y + sisteBoks.height / 2).toBeGreaterThan(listeBoks.y + listeBoks.height);

  // Touch-rulling i listen: rå berøringshendelser via CDP (fingeren drar
  // oppover). `Input.synthesizeScrollGesture` ga ingen rulling i headless
  // Chromium her, så det brukes ikke.
  const boks = (await liste.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = Math.round(boks.x + boks.width / 2);
  const startY = Math.round(boks.y + boks.height - 10);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: startY }],
  });
  for (let steg = 1; steg <= 10; steg += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: startY - steg * 12 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect.poll(() => liste.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // Rullingen valgte ingenting og lukket ikke listen.
  await expect(liste).toBeVisible();
  await expect(felt).toHaveValue(prefiks);
  await expect(felt).toBeFocused();
  for (const n of navn) {
    await expect(dialog.getByLabel(`Fjern ${n} fra handlegrunnlaget`)).toHaveCount(0);
  }

  // Trykk på treffet som lå utenfor rulleområdet.
  await siste.tap();
  await expect(dialog.getByLabel(`Fjern ${navn[5]} fra handlegrunnlaget`)).toBeVisible();
  for (const n of navn.slice(0, 5)) {
    await expect(dialog.getByLabel(`Fjern ${n} fra handlegrunnlaget`)).toHaveCount(0);
  }
});
