import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * «Merk som basisvare» fra handlelisten (#20, ordre 6651329875) — KUN mot
 * Firebase-emulatoren. Syntetiske varer; resultatet leses rett fra
 * emulatoren: bare `staples/{navn lowercase}` skrives, handlelisten er
 * urørt, og Matlager kan fortsatt fjerne basisvaren.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-bv-${Date.now()}-${Math.random()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const les = (node: string) => medDb(async (db) => (await db.ref(`${FAM}/${node}`).get()).val());
const sett = (noder: Record<string, unknown>) =>
  medDb((db) =>
    db.ref(FAM).update(Object.fromEntries(Object.entries(noder).map(([k, v]) => [k, v]))),
  );

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

const HANDLELISTE = {
  "bv-s1": { itemId: "bv-v1", name: "Hvetemel", amount: "2 kg", cat: "Tørrvarer", done: false },
  "bv-s2": { name: "Gammel vare", amount: "", cat: "Diverse", done: false },
  "bv-s3": { itemId: "bv-v3", name: "Salt/pepper", amount: "1", cat: "Diverse", done: false },
  "bv-s4": { itemId: "bv-v4", name: "Melk", amount: "1 l", cat: "Ost og meieri", done: true },
};

test.afterEach(async () => {
  await sett({ shopping: null, staples: null });
});

test("«Merk som basisvare»: én nøkkel skrives, listen er urørt, ugyldig navn skrives aldri, og Matlager kan fjerne", async ({
  page,
}) => {
  await sett({ shopping: HANDLELISTE, staples: { melk: true, "rømme 18 %": true } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await loggInn(page);
  await page.goto("/mat/handle");

  // PC: Hvetemel.
  await page.getByText("Hvetemel", { exact: true }).click();
  await expect(page.getByText(/avhukes automatisk neste gang/)).toBeVisible();
  await page.screenshot({ path: "test-results/basisvare-1280.png" });
  await page.getByRole("button", { name: "Merk som basisvare" }).click();
  await expect(page.getByText("Basisvare", { exact: true })).toBeVisible();
  await expect(page.getByText(/Fjernes i Matlager/)).toBeVisible();
  await expect
    .poll(() => les("staples"))
    .toEqual({ melk: true, "rømme 18 %": true, hvetemel: true });
  expect(await les("shopping")).toEqual(HANDLELISTE);
  // Varen står fortsatt på listen, ikke avhuket.
  await expect(page.getByRole("button", { name: "Merk Hvetemel som fullført" })).toBeVisible();

  // Ugyldig navn: forklaring, ingen handling, ingen skriving.
  await page.getByText("Salt/pepper", { exact: true }).click();
  await expect(page.getByText(/inneholder tegn som ikke kan lagres som basisvare/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Merk som basisvare" })).toHaveCount(0);

  // Mobil: eldre vare uten itemId, med tastatur.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Gammel vare", { exact: true }).click();
  const knapp = page.getByRole("button", { name: "Merk som basisvare" });
  await knapp.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Basisvare", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/basisvare-390.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "390 px uten vannrett rulling",
  ).toBe(true);
  await expect
    .poll(() => les("staples"))
    .toEqual({ melk: true, "rømme 18 %": true, hvetemel: true, "gammel vare": true });
  expect(await les("shopping")).toEqual(HANDLELISTE);

  // Matlager fjerner fortsatt basisvaren (eksisterende administrasjonsflate).
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/mat/fryser");
  await page.getByRole("button", { name: /4 basisvarer/ }).click();
  await page.getByRole("button", { name: "Fjern hvetemel som basisvare" }).click();
  await expect
    .poll(() => les("staples"))
    .toEqual({ melk: true, "rømme 18 %": true, "gammel vare": true });
  expect(await les("shopping")).toEqual(HANDLELISTE);

  // Tilbake i handlelisten: Hvetemel kan merkes igjen.
  await page.goto("/mat/handle");
  await page.getByText("Hvetemel", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Merk som basisvare" })).toBeVisible();
});
