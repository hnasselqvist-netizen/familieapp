import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Status «Pakket» AKTIVERT (#20, ordre 7005959850 og 7038853728, review
 * 5973381911) — KUN mot emulatoren, syntetiske data, ekte React-UI på 390 px.
 *
 * Valget er på: Pakket tilbys for alle gaver og kan velges. En gave som
 * allerede er `pakket` (seedet her), vises som Pakket, teller som kjøpt
 * («Ferdig»), og kan endres bort i samme valg. Bare status endres; ukjente
 * felt og beløp står. Rollback-modusen (bryteren av) dekkes i enhets- og
 * hooktestene, siden bryteren er en byggetidskonstant. Bare egne syntetiske
 * nøkler seedes og ryddes.
 */
const FAM = `families/${FAMILY_ID}`;
const AAR = new Date().getFullYear();
const JUL = `jul-${AAR}`;
const P = `e2e-pakket-person-${Date.now()}`;
const NAVN = `E2E-Pakket-${Date.now()}`;
const T = "2026-11-19T10:00:00.000Z";

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-pakket-${Date.now()}-${Math.random()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const les = (sti: string) => medDb(async (db) => (await db.ref(`${FAM}/${sti}`).get()).val());

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

test.beforeEach(async () => {
  await medDb(async (db) => {
    await db.ref(`${FAM}/relasjoner/${P}`).set({
      navn: NAVN,
      gruppe: "naer",
      versjon: 1,
      opprettet: T,
      oppdatert: T,
    });
    // Årets jul kan finnes fra andre kjøringer: legg bare til egen mottaker.
    const jul = db.ref(`${FAM}/anledninger/${JUL}`);
    if ((await jul.get()).exists()) {
      await jul.child(`mottakere/${P}`).set({ budsjett: { type: "ikke_satt" } });
    } else {
      await jul.set({
        type: "jul",
        aar: AAR,
        mottakere: { [P]: { budsjett: { type: "ikke_satt" } } },
        versjon: 1,
        opprettet: T,
        oppdatert: T,
      });
    }
    const gave = (tekst: string, status: string) => ({
      personId: P,
      anledningId: JUL,
      tekst,
      status,
      planlagtOre: 30000,
      fremtidigFelt: { fra: "e2e" },
      versjon: 1,
      opprettet: T,
      oppdatert: T,
    });
    await db.ref(`${FAM}/gaver/${P}-skjerf`).set(gave("Skjerf", "pakket"));
    await db.ref(`${FAM}/gaver/${P}-votter`).set(gave("Votter", "kjopt"));
  });
});

test.afterEach(async () => {
  await medDb(async (db) => {
    await db.ref(`${FAM}/gaver/${P}-skjerf`).remove();
    await db.ref(`${FAM}/gaver/${P}-votter`).remove();
    await db.ref(`${FAM}/anledninger/${JUL}/mottakere/${P}`).remove();
    await db.ref(`${FAM}/relasjoner/${P}`).remove();
  });
});

test("aktivert på 390 px: Pakket kan velges for en kjøpt gave, en pakket gave vises riktig, teller som kjøpt og kan endres bort", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loggInn(page);
  await page.goto("/hjem-familie/gaver");
  await page.getByRole("button", { name: `Jul ${AAR}` }).click();
  const kort = page.getByRole("region", { name: NAVN });
  await expect(kort.getByText("Ferdig")).toBeVisible();

  const skjerf = kort.getByLabel("Status for Skjerf");
  const votter = kort.getByLabel("Status for Votter");
  await expect(skjerf).toHaveValue("pakket");
  await expect(skjerf.locator("option")).toHaveText(["Idé", "Kjøpt", "Pakket", "Gitt"]);
  // Aktivert: også en annen gave tilbyr Pakket.
  await expect(votter.locator("option")).toHaveText(["Idé", "Kjøpt", "Pakket", "Gitt"]);
  await expect(kort.getByText(/planlagt 600 kr/)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "390 px uten vannrett rulling",
  ).toBe(true);
  await page.screenshot({ path: "test-results/gaver-pakket-aktivert-390.png", fullPage: true });

  // Endres bort i samme valg: bare status endres; ukjente felt står.
  await skjerf.selectOption("kjopt");
  await expect(async () => {
    expect(await les(`gaver/${P}-skjerf`)).toMatchObject({
      status: "kjopt",
      planlagtOre: 30000,
      fremtidigFelt: { fra: "e2e" },
      versjon: 2,
    });
  }).toPass();
  // Aktivert: Pakket er fortsatt tilbudt etter endringen.
  await expect(skjerf.locator("option")).toHaveText(["Idé", "Kjøpt", "Pakket", "Gitt"]);
  await expect(kort.getByText("Ferdig")).toBeVisible();

  // Velg Pakket for den kjøpte gaven: bare status endres; ukjente felt står.
  await votter.selectOption("pakket");
  await expect(async () => {
    expect(await les(`gaver/${P}-votter`)).toMatchObject({
      status: "pakket",
      planlagtOre: 30000,
      fremtidigFelt: { fra: "e2e" },
      versjon: 2,
    });
  }).toPass();
  await expect(votter).toHaveValue("pakket");
  await expect(kort.getByText("Ferdig")).toBeVisible();
  await expect(kort.getByText(/planlagt 600 kr/)).toBeVisible();
});
