import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Prognosedatoer i norsk tid (#59, ordre 6655518240; funn B og C) — KUN mot
 * Firebase-emulatoren, syntetiske poster. Nettleseren kjører i
 * Europe/Oslo med fast klokke 10.02.2026, og Spillerom regenererer
 * automatisk når budsjettdataene er lastet (eksisterende flyt).
 */
test.use({ timezoneId: "Europe/Oslo" });
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-pd-${Date.now()}-${Math.random()}`,
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
const MANUELL = {
  id: "pd-manuell",
  name: "Tannlege",
  amount: 900,
  direction: "out",
  date: "2026-02-19",
  type: "extra",
  kilde: "manuell",
};
const OVERSTYRT = {
  id: "pd-overstyrt",
  name: "Strøm",
  amount: 1234,
  direction: "out",
  date: "2026-02-14",
  type: "fast",
  kilde: "generator",
  manueltOverstyrt: true,
  _genKey: "strom_2026_1_15",
};

test.afterEach(async () => {
  await sett({ budget: null, incomeGroups: null, sparingGroups: null, liquidity: null });
});

test("Spillerom i norsk tid: forfall 20 blir 20., dag 31 i februar blir 28., overstyrt og manuell post står", async ({
  page,
}) => {
  await sett({
    budget: {
      bolig: {
        husleie: {
          name: "Husleie",
          months: tolv(10000),
          meta: { automatisk: true, forfallsdag: "31", oppforsel: "fast", eier: "Felles" },
        },
        strom: {
          name: "Strøm",
          months: tolv(1500),
          meta: { automatisk: true, forfallsdag: "15", oppforsel: "fast", eier: "Felles" },
        },
      },
    },
    incomeGroups: {
      lonn: {
        "pd-lonn": {
          name: "Lønn",
          months: tolv(40000),
          meta: { automatisk: true, forfallsdag: "20", eier: "Felles" },
        },
      },
    },
    liquidity: {
      saldo: 50000,
      prognosisDate: "2026-03-20",
      posts: { [MANUELL.id]: MANUELL, [OVERSTYRT.id]: OVERSTYRT },
    },
  });
  await page.clock.setFixedTime(new Date("2026-02-10T10:00:00+01:00"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await loggInn(page);
  await page.goto("/forvaltning/spillerom");

  // Automatisk regenerering: datoer i lokal kalender, klemt dag 31.
  await expect
    .poll(async () => {
      const posts = ((await les("liquidity/posts")) ?? {}) as Record<
        string,
        { _genKey?: string; date: string; kilde: string }
      >;
      return Object.values(posts)
        .map((p) => `${p._genKey ?? p.kilde}=${p.date}`)
        .sort();
    })
    .toEqual(
      [
        "husleie_2026_1_31=2026-02-28",
        "inc_pd-lonn_2026_1_20=2026-02-20",
        "inc_pd-lonn_2026_2_20=2026-03-20",
        "strom_2026_1_15=2026-02-14", // overstyrt: lagret dato står uendret
        "strom_2026_2_15=2026-03-15",
        "manuell=2026-02-19", // manuell: uendret
      ].sort(),
    );
  const poster = (await les("liquidity/posts")) as Record<string, Record<string, unknown>>;
  expect(poster[MANUELL.id]).toEqual(MANUELL);
  expect(poster[OVERSTYRT.id]).toEqual(OVERSTYRT);

  // Visningen viser de samme dagene.
  const main = page.locator("main");
  await expect(main).toContainText("28. feb.");
  await expect(main).toContainText("20. feb.");
  await expect(main).not.toContainText("3. mars");
  await page.screenshot({ path: "test-results/prognosedato-1280.png", fullPage: true });
});

test("standard prognosedato uten lagret dato er neste 20. i lokal tid", async ({ page }) => {
  await sett({
    budget: {
      bolig: {
        husleie: {
          name: "Husleie",
          months: tolv(10000),
          meta: { automatisk: true, forfallsdag: "20", oppforsel: "fast" },
        },
      },
    },
    liquidity: { saldo: 1000 },
  });
  await page.clock.setFixedTime(new Date("2026-02-10T00:30:00+01:00")); // rett etter midnatt
  await loggInn(page);
  await page.goto("/forvaltning/spillerom");
  await expect
    .poll(async () =>
      Object.values(((await les("liquidity/posts")) ?? {}) as Record<string, { date: string }>).map(
        (p) => p.date,
      ),
    )
    .toEqual(["2026-02-20"]);
  // Funn H (#59, ordre 6669823460): skjermen viser og regner mot den samme
  // standarddatoen, rolig merket, og lagrer ingen dato av seg selv.
  const knapp = page.getByRole("button", { name: /Endre prognosedato/ });
  await expect(knapp).toHaveAccessibleName(
    "Endre prognosedato, nå 20. feb. (standard, ikke lagret)",
  );
  await expect(knapp).toContainText("· standard");
  await expect(page.getByText("Velg dato")).toHaveCount(0);
  const main = page.locator("main");
  await expect(main).toContainText("Spillerom til 20. feb.");
  await expect(main).toContainText("Husleie");
  await expect(main).not.toContainText("Ingen poster i perioden");
  expect(await les("liquidity/prognosisDate")).toBeNull();

  // Åpne og forlate datofeltet uten endring lagrer ingenting.
  await knapp.click();
  await page.getByLabel("Prognose frem til").press("Escape");
  await knapp.click();
  await page.locator("main").getByText("Spillerom til").click();
  await page.waitForTimeout(300);
  expect(await les("liquidity/prognosisDate")).toBeNull();

  // Eksplisitt brukerlagring via eksisterende flate.
  await knapp.click();
  await page.getByLabel("Prognose frem til").fill("2026-02-27");
  await page.getByRole("button", { name: "Lagre dato" }).click();
  await expect.poll(() => les("liquidity/prognosisDate")).toBe("2026-02-27");
  await expect(knapp).toHaveAccessibleName("Endre prognosedato, nå 27. feb.");
  await page.screenshot({ path: "test-results/prognosedato-standard.png", fullPage: true });
});
