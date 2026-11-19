import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Notat på bibliotekmiddag (Mat #20, ordre 6998241717) — KUN mot
 * Firebase-emulatoren, syntetisk middag, ekte React-UI på mobilbredde.
 * Resultatet leses rett fra emulatoren i eksportform: bare `notat` endres,
 * prioriteter og ukjente felt står, og en samtidig endring gir synlig
 * konflikt med beholdt utkast.
 */
const FAM = `families/${FAMILY_ID}`;
const ID = "e2e-notat-taco";

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-notat-${Date.now()}-${Math.random()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const post = () =>
  medDb(async (db) => (await db.ref(`${FAM}/mealLibrary/${ID}`).get()).exportVal() as unknown);
const settPost = (v: unknown) => medDb((db) => db.ref(`${FAM}/mealLibrary/${ID}`).set(v));

const START = {
  ".priority": 3,
  name: "E2E Notattaco",
  lettvint: true,
  _mcp: { kilde: "e2e" },
};

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

test.afterEach(async () => {
  await settPost(null);
});

test("notat på mobil: lagres med linjeskift, bare `notat` endres; samtidig endring gir konflikt med beholdt utkast", async ({
  page,
}) => {
  await settPost(START);
  await page.setViewportSize({ width: 390, height: 844 });
  await loggInn(page);
  await page.goto("/mat/bibliotek");
  await page.getByText("E2E Notattaco", { exact: true }).click();

  const seksjon = page.getByRole("region", { name: "Notat for E2E Notattaco" });
  // Navnefeltet finnes nøyaktig én gang, også etter at abonnementet har levert
  // nye verdier (regresjon: notatet delte React-nøkkel med navnefeltet).
  const navnefelt = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll("input")].filter((i) => i.value === "E2E Notattaco").length,
    );
  await expect(seksjon.getByText("Ingen notat.")).toBeVisible();
  await seksjon.getByRole("button", { name: "Legg til notat" }).click();
  const felt = seksjon.getByRole("textbox", { name: "Notat for E2E Notattaco" });
  await felt.fill("Dobbel porsjon\nFrys halvparten");
  await seksjon.getByRole("button", { name: "Lagre notat" }).click();
  await expect(seksjon.getByRole("status")).toHaveText("Notatet på «E2E Notattaco» er lagret.");
  await expect.poll(post).toEqual({ ...START, notat: "Dobbel porsjon\nFrys halvparten" });
  await expect(seksjon.getByTestId("middagsnotat")).toHaveText("Dobbel porsjon\nFrys halvparten");
  expect(await navnefelt()).toBe(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "390 px uten vannrett rulling",
  ).toBe(true);
  await page.screenshot({ path: "test-results/bibliotek-notat-390.png" });

  // En annen enhet endrer notatet mens utkastet står åpent.
  await seksjon.getByRole("button", { name: "Rediger notat" }).click();
  await felt.fill("Mitt utkast");
  await settPost({ ...START, notat: "Fra en annen enhet" });
  await seksjon.getByRole("button", { name: "Lagre notat" }).click();
  await expect(seksjon.getByRole("alert")).toContainText(
    "er endret på en annen enhet siden du begynte. Ingenting er lagret.",
  );
  await expect(felt).toHaveValue("Mitt utkast");
  expect(await post()).toEqual({ ...START, notat: "Fra en annen enhet" });
  expect(await navnefelt()).toBe(1);
  await page.screenshot({ path: "test-results/bibliotek-notat-konflikt-390.png" });

  // Eksplisitt nytt grunnlag, deretter tømming: nøkkelen fjernes.
  await seksjon.getByRole("button", { name: "Bruk gjeldende notat som grunnlag" }).click();
  await felt.fill("");
  await seksjon.getByRole("button", { name: "Lagre notat" }).click();
  await expect(seksjon.getByRole("status")).toBeVisible();
  await expect.poll(post).toEqual(START);
  await expect(seksjon.getByText("Ingen notat.")).toBeVisible();
});
