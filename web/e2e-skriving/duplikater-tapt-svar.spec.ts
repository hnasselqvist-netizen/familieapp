import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Sammenslåing og angring med tapt svar (Mat #20, ordre 6837116507, review
 * 5883585162) — KUN mot Firebase-emulatoren, syntetiske data. Playwright
 * lar PUT-en nå emulatoren (`route.fetch`) og avbryter så svaret til siden
 * (`route.abort`): serveren har lagret, klienten vet det ikke. «Prøv igjen»
 * skal da sende samme operasjon og være skrivefri. Et svar tapt FØR
 * serveren gir et gjentak uten bevis: fortsatt ubekreftet, ingenting utført.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-dup-${Date.now()}-${Math.random()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const eksport = () =>
  medDb(
    async (db) => (await db.ref(`${FAM}/shopping`).get()).exportVal() as Record<string, unknown>,
  );
const sett = (noder: Record<string, unknown>) => medDb((db) => db.ref(FAM).update(noder));

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

const RAD = { itemId: "dup-v1", name: "Melk", cat: "Ost og meieri", done: false };
const LISTE = {
  "dup-a": { ...RAD, id: "dup-a", amount: "1", ".priority": 5 },
  "dup-b": { ...RAD, id: "dup-b", amount: "2" },
  _ops: { r1: { tool: "shopping_list_add_items", at: 1 } },
};

/** Neste PUT mot handlelisten: `etter` = nå serveren, så tap svaret; `foer` = tap før serveren. */
async function tapNesteSvar(page: Page, naar: "etter" | "foer") {
  let brukt = false;
  await page.route(/\/shopping\.json/, async (route) => {
    if (route.request().method() !== "PUT" || brukt) return route.continue();
    brukt = true;
    if (naar === "etter") await route.fetch();
    return route.abort("failed");
  });
}

test.afterEach(async () => {
  await sett({ shopping: null, items: null });
});

test("sammenslåing og angring: tapt svar etter commit → «Prøv igjen» er skrivefri", async ({
  page,
}) => {
  await sett({ shopping: LISTE, items: { "dup-v1": { name: "Melk", cat: "Ost og meieri" } } });
  await page.setViewportSize({ width: 390, height: 844 });
  await loggInn(page);
  await page.goto("/mat/handle");

  await page.getByText(/Mulige duplikater \(1\)/).click();
  const gruppe = page.getByRole("group", { name: "Samme vare: Melk" });
  await gruppe.getByLabel("Ta med Melk (1)").check();
  await gruppe.getByLabel("Ta med Melk (2)").check();
  await gruppe.getByLabel("Behold Melk (1)").check();
  await gruppe.getByLabel(/Legg sammen: 3/).check();

  await tapNesteSvar(page, "etter");
  await gruppe.getByRole("button", { name: "Slå sammen 2 rader" }).click();
  const ventende = page.getByRole("alert", { name: /Ikke bekreftet: Sammenslåing/ });
  await expect(ventende).toContainText("Vi vet ikke om sammenslåingen ble lagret.");
  // Serveren lagret: kilden er borte, gruppen forsvinner, men forsøket står.
  await expect.poll(async () => (await eksport())["dup-b"]).toBeUndefined();
  await expect(page.getByText(/Mulige duplikater/)).toHaveCount(0);
  await page.unrouteAll();
  const lagret = await eksport();
  expect((lagret["dup-a"] as Record<string, unknown>)[".priority"]).toBe(5);
  await page.screenshot({ path: "test-results/duplikater-tapt-svar-390.png" });
  await ventende.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(
    page.getByText("Sammenslåingen er bekreftet lagret. Ingen ny endring."),
  ).toBeVisible();
  await expect(ventende).toHaveCount(0);
  expect(JSON.stringify(await eksport())).toBe(JSON.stringify(lagret));

  // Angring med tapt svar etter commit, så gjentak.
  await tapNesteSvar(page, "etter");
  await page.getByRole("button", { name: "Angre sammenslåing av Melk" }).click();
  const angring = page.getByRole("alert", { name: /Ikke bekreftet: Angring/ });
  await expect(angring).toContainText("Vi vet ikke om angringen ble lagret.");
  await expect.poll(async () => (await eksport())["dup-b"]).toBeTruthy();
  await page.unrouteAll();
  const angret = await eksport();
  await angring.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(page.getByText("Angringen er bekreftet lagret. Ingen ny endring.")).toBeVisible();
  expect(JSON.stringify(await eksport())).toBe(JSON.stringify(angret));
  expect(angret._ops).toEqual(LISTE._ops);
  expect((angret["dup-a"] as Record<string, unknown>)[".priority"]).toBe(5);
});

test("tapt svar før serveren: ordinære knapper er sperret, gjentaket skriver ikke, «Send på nytt» krever eget valg (review 5884178972)", async ({
  page,
}) => {
  await sett({ shopping: LISTE, items: { "dup-v1": { name: "Melk", cat: "Ost og meieri" } } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await loggInn(page);
  await page.goto("/mat/handle");
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/shopping.json")) puts.push(r.url());
  });
  const foer = await eksport();

  // Sammenslåing: svaret tapes før serveren.
  await page.getByText(/Mulige duplikater \(1\)/).click();
  const gruppe = page.getByRole("group", { name: "Samme vare: Melk" });
  await gruppe.getByLabel("Ta med Melk (1)").check();
  await gruppe.getByLabel("Ta med Melk (2)").check();
  await gruppe.getByLabel("Behold Melk (1)").check();
  await gruppe.getByLabel(/Legg sammen: 3/).check();
  await tapNesteSvar(page, "foer");
  await gruppe.getByRole("button", { name: "Slå sammen 2 rader" }).click();
  const ventende = page.getByRole("alert", { name: /Ikke bekreftet: Sammenslåing/ });
  await expect(ventende).toContainText("Vi vet ikke om sammenslåingen ble lagret.");
  await page.unrouteAll();
  expect(puts).toHaveLength(1); // det tapte forsøket
  // Gruppen står (ingenting lagret), men radene kan ikke velges på nytt.
  await expect(gruppe).toContainText("venter på avklaring");
  await expect(gruppe.getByLabel("Ta med Melk (1)")).toBeDisabled();
  await expect(gruppe.getByLabel("Ta med Melk (2)")).toBeDisabled();
  await expect(gruppe.getByRole("button", { name: /Slå sammen/ })).toHaveCount(0);
  // «Prøv igjen» avklarer bare (GET): fortsatt ubekreftet, ingen PUT.
  await ventende.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(ventende).toContainText("Fortsatt ikke bekreftet");
  expect(puts).toHaveLength(1);
  expect(JSON.stringify(await eksport())).toBe(JSON.stringify(foer));
  // Et nytt forsøk er et eget valg etter kontroll av listen: samme plan, én PUT.
  await ventende.getByRole("button", { name: "Send på nytt" }).click();
  await expect(ventende).toContainText("Sjekk listen først");
  expect(puts).toHaveLength(1);
  await ventende.getByRole("button", { name: "Jeg har sjekket listen — send på nytt" }).click();
  await expect(page.getByText("Radene er slått sammen.")).toBeVisible();
  expect(puts).toHaveLength(2);
  await expect.poll(async () => (await eksport())["dup-b"]).toBeUndefined();

  // Angring: svaret tapes før serveren; raden står, «Angre» er sperret.
  await tapNesteSvar(page, "foer");
  await page.getByRole("button", { name: "Angre sammenslåing av Melk" }).click();
  const angring = page.getByRole("alert", { name: /Ikke bekreftet: Angring/ });
  await expect(angring).toContainText("Vi vet ikke om angringen ble lagret.");
  await page.unrouteAll();
  expect(puts).toHaveLength(3);
  const sammenslatt = await eksport();
  await expect(page.getByRole("button", { name: "Angre sammenslåing av Melk" })).toBeDisabled();
  await angring.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(angring).toContainText("Fortsatt ikke bekreftet");
  expect(puts).toHaveLength(3);
  expect(JSON.stringify(await eksport())).toBe(JSON.stringify(sammenslatt));
  await page.screenshot({ path: "test-results/duplikater-sperret-1280.png" });
  await angring.getByRole("button", { name: "Send på nytt" }).click();
  await angring.getByRole("button", { name: "Jeg har sjekket listen — send på nytt" }).click();
  await expect(page.getByText("Sammenslåingen er angret.")).toBeVisible();
  expect(puts).toHaveLength(4);
  const angret = await eksport();
  expect(angret["dup-b"]).toEqual(LISTE["dup-b"]);
  expect(angret._ops).toEqual(LISTE._ops);
});
