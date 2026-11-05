import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Funn E (#59, ordre 6658205196) — KUN mot Firebase-emulatoren, syntetiske
 * poster. Brukeren endrer forfallsdag i Økonomi etter at novemberforekomsten
 * er manuelt overstyrt; Spillerom regenererer som vanlig. Den overstyrte
 * forekomsten står uendret, og ingen ekstra novemberpost lages.
 */
test.use({ timezoneId: "Europe/Oslo" });
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-ov-${Date.now()}-${Math.random()}`,
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
const OVERSTYRT = {
  id: "ov-husleie-nov",
  name: "Husleie",
  amount: 150,
  direction: "out",
  date: "2026-11-20",
  type: "fast",
  kilde: "generator",
  manueltOverstyrt: true,
  sourceType: "kostnader",
  sourceBudgetItemId: "husleie",
  sourceBudgetGroupId: "bolig",
  _genKey: "husleie_2026_10_20",
};

test.afterEach(async () => {
  await sett({ budget: null, liquidity: null });
});

test("endret forfallsdag etter overstyring: overstyrt november står, ingen ekstra post; desember følger ny dag", async ({
  page,
}) => {
  await sett({
    budget: {
      bolig: {
        husleie: {
          name: "Husleie",
          months: tolv(100),
          meta: { automatisk: true, forfallsdag: "20", oppforsel: "fast", eier: "Felles" },
        },
      },
    },
    liquidity: { saldo: 50000, prognosisDate: "2026-12-31", posts: { [OVERSTYRT.id]: OVERSTYRT } },
  });
  await page.clock.setFixedTime(new Date("2026-11-10T10:00:00+01:00"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await loggInn(page);

  // Brukeren endrer forfallsdagen 20 → 25 i Økonomi.
  await page.goto("/forvaltning/okonomi?omrade=kostnader");
  const panel = page.getByRole("tabpanel");
  if (!(await panel.getByRole("button", { name: /^Husleie/ }).isVisible())) {
    await panel.getByText("Bolig", { exact: true }).click();
  }
  await panel.getByRole("button", { name: /^Husleie/ }).click();
  const modal = page.getByRole("dialog");
  await modal.getByPlaceholder("Dag i måneden").fill("25");
  await modal.getByRole("button", { name: "Lagre" }).click();
  await expect.poll(() => les("budget/bolig/husleie/meta/forfallsdag")).toBe("25");

  // Spillerom regenererer som vanlig.
  await page.goto("/forvaltning/spillerom");
  await expect
    .poll(async () => {
      const posts = ((await les("liquidity/posts")) ?? {}) as Record<
        string,
        { _genKey?: string; date: string; amount: number }
      >;
      return Object.values(posts)
        .map((p) => `${p._genKey}=${p.date}:${p.amount}`)
        .sort();
    })
    .toEqual(["husleie_2026_10_20=2026-11-20:150", "husleie_2026_11_25=2026-12-25:100"]);
  const poster = (await les("liquidity/posts")) as Record<string, Record<string, unknown>>;
  expect(poster[OVERSTYRT.id]).toEqual(OVERSTYRT);
  await page.screenshot({ path: "test-results/overstyring-1280.png", fullPage: true });
});
