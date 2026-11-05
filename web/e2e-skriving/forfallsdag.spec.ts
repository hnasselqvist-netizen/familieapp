import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Funn F (#59, ordre 6665182330) — KUN mot Firebase-emulatoren, syntetiske
 * poster. En eksisterende automatisk kostnad uten forfallsdag vises i
 * Spillerom som «Prognosegrunnlag ufullstendig» med vei til Økonomi.
 * Ugyldig dag kan ikke lagres (ingen skriving); en eksplisitt gyldig dag
 * fjerner varselet, og ordinær prognose lager posten.
 */
test.use({ timezoneId: "Europe/Oslo" });
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-fd-${Date.now()}-${Math.random()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const les = (node: string) => medDb(async (db) => (await db.ref(`${FAM}/${node}`).get()).val());
const sett = (noder: Record<string, unknown>) => medDb((db) => db.ref(FAM).update(noder));

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

const tolv = (b: number) => Array.from({ length: 12 }, () => ({ budget: b, spent: 0 }));
const HUSLEIE_META = { automatisk: true, forfallsdag: "", oppforsel: "fast", eier: "Felles" };

test.afterEach(async () => {
  await sett({ budget: null, liquidity: null });
});

for (const bredde of [390, 1280]) {
  test(`${bredde}px: mangel vises, ugyldig dag lagres ikke, gyldig dag fjerner varselet og gir prognosepost`, async ({
    page,
  }) => {
    await sett({
      budget: {
        bolig: {
          husleie: { name: "Husleie", months: tolv(100), meta: HUSLEIE_META },
          strom: {
            name: "Strøm",
            months: tolv(50),
            meta: { automatisk: true, forfallsdag: "15", oppforsel: "fast", eier: "Felles" },
          },
        },
      },
      liquidity: { saldo: 50000, prognosisDate: "2026-11-30", posts: {} },
    });
    await page.clock.setFixedTime(new Date("2026-11-10T10:00:00+01:00"));
    await page.setViewportSize({ width: bredde, height: 900 });
    await loggInn(page);

    // Eksisterende mangel er synlig i Spillerom; Strøm (gyldig) er ikke med i varselet.
    await page.goto("/forvaltning/spillerom");
    const varsel = page.getByRole("region", { name: "Prognosegrunnlag ufullstendig" });
    await expect(varsel).toContainText("1 automatisk post trenger forfallsdag.");
    await expect(varsel).toContainText("Kostnad · Bolig · Husleie");
    await expect(varsel).toContainText("Mangler forfallsdag – ikke med i prognosen.");
    await expect(varsel).not.toContainText("Strøm");
    await expect
      .poll(async () =>
        Object.values(((await les("liquidity/posts")) ?? {}) as Record<string, { name: string }>)
          .map((p) => p.name)
          .sort(),
      )
      .toEqual(["Strøm"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      bredde,
    );
    await page.screenshot({
      path: `test-results/forfallsdag-varsel-${bredde}.png`,
      fullPage: true,
    });

    // Vei til eksisterende redigering: riktig post åpnes i Økonomi.
    await varsel.getByRole("link", { name: /Rett forfallsdag for Husleie/ }).click();
    await expect(page).toHaveURL(
      /\/forvaltning\/okonomi\?omrade=kostnader&gruppe=bolig&post=husleie/,
    );
    const modal = page.getByRole("dialog");
    await expect(modal).toContainText("Detaljer — Husleie");

    // Ugyldig dag: feltfeil, Lagre sperret, ingenting skrives.
    const dag = modal.getByRole("textbox", { name: "Forfallsdag" });
    for (const ugyldig of ["", "0", "32", "1.5", "15abc"]) {
      await dag.fill(ugyldig);
      await expect(modal.getByRole("alert")).toContainText("krever en forfallsdag fra 1 til 31");
      await expect(modal.getByRole("button", { name: "Lagre" })).toBeDisabled();
    }
    expect(await les("budget/bolig/husleie/meta")).toEqual(HUSLEIE_META);

    // Eksplisitt brukerretting.
    await dag.fill("25");
    await expect(modal.getByRole("alert")).toHaveCount(0);
    await modal.getByRole("button", { name: "Lagre" }).click();
    await expect.poll(() => les("budget/bolig/husleie/meta/forfallsdag")).toBe("25");
    await expect(page).toHaveURL(/\/forvaltning\/okonomi\?omrade=kostnader$/);

    // Varselet er borte og ordinær prognose lager Husleie på den 25.
    await page.goto("/forvaltning/spillerom");
    await expect(page.getByRole("region", { name: "Prognosegrunnlag ufullstendig" })).toHaveCount(
      0,
    );
    await expect(page.getByText("Kontrollerer forfallsdager i prognosegrunnlaget…")).toHaveCount(0);
    await expect
      .poll(async () =>
        Object.values(
          ((await les("liquidity/posts")) ?? {}) as Record<
            string,
            { name: string; date: string; amount: number }
          >,
        )
          .map((p) => `${p.name}=${p.date}:${p.amount}`)
          .sort(),
      )
      .toEqual(["Husleie=2026-11-25:100", "Strøm=2026-11-15:50"]);
  });
}

test("automatikk på uten dag kan ikke lagres fra Økonomi; automatikk av med tom dag kan", async ({
  page,
}) => {
  const meta = { automatisk: false, forfallsdag: "", oppforsel: "fast", eier: "Felles" };
  await sett({
    budget: { bolig: { husleie: { name: "Husleie", months: tolv(100), meta } } },
    liquidity: { saldo: 50000, prognosisDate: "2026-11-30", posts: {} },
  });
  await page.clock.setFixedTime(new Date("2026-11-10T10:00:00+01:00"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await loggInn(page);
  await page.goto("/forvaltning/okonomi?omrade=kostnader&gruppe=bolig&post=husleie");
  const modal = page.getByRole("dialog");
  const automatikk = modal.getByRole("button", { name: /Automatisk til prognosen/ });
  await automatikk.click();
  await expect(automatikk).toHaveAttribute("aria-pressed", "true");
  await expect(modal.getByRole("alert")).toContainText("Skriv inn dagen, eller slå av automatikk.");
  await expect(modal.getByRole("button", { name: "Lagre" })).toBeDisabled();
  expect(await les("budget/bolig/husleie/meta")).toEqual(meta);

  await automatikk.click();
  await modal.getByRole("button", { name: "Lagre" }).click();
  await expect(modal).toHaveCount(0);
  await expect.poll(() => les("budget/bolig/husleie/meta/automatisk")).toBe(false);
  expect(await les("budget/bolig/husleie/meta/forfallsdag")).toBe("");
});
