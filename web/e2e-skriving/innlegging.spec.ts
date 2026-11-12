import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Manuell innlegging med varsel om aktiv vare (Mat #20, ordre 6830803229)
 * — KUN mot Firebase-emulatoren, syntetiske data. Resultatet leses rett fra
 * emulatoren: «Avbryt» endrer ingenting, «Øk antallet» endrer bare mengden
 * på én målrad, ingen vare opprettes på varselveien, og en målrad som endres
 * etter visning gir konflikt uten skriving.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-inn-${Date.now()}-${Math.random()}`,
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

const VARER = {
  "inn-v1": { name: "Havremelk", cat: "Ost og meieri" },
  "inn-v2": { name: "Knekkebrød", cat: "Brød og bakst" },
};
const MELK = {
  id: "inn-s1",
  itemId: "inn-v1",
  name: "Havremelk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
  ukjent: { fra: "legacy" },
};
const HANDLELISTE = {
  "inn-s1": MELK,
  "inn-s2": { ...MELK, id: "inn-s2", amount: "1", done: true },
  "inn-s3": {
    id: "inn-s3",
    itemId: "inn-v2",
    name: "Knekkebrød",
    amount: "1 pk",
    cat: "Brød og bakst",
    done: false,
  },
  _ops: { r1: { tool: "shopping_list_add_items", at: 1 } },
};

test.afterEach(async () => {
  await sett({ shopping: null, items: null });
});

test("varsel ved aktiv vare: «Avbryt» endrer ingenting, «Øk antallet» øker én rad, ny vare gir ny rad (mobil 390)", async ({
  page,
}) => {
  await sett({ shopping: HANDLELISTE, items: VARER });
  await page.setViewportSize({ width: 390, height: 844 });
  await loggInn(page);
  await page.goto("/mat/handle");
  const vareFelt = page.getByPlaceholder("Hva trenger du?");
  const mengdeFelt = page.getByRole("textbox", { name: "Mengde" });
  const leggTil = page.getByRole("button", { name: "Legg til" });

  // Treff: varsel med eksisterende rad og nytt antall, ingen skriving.
  await vareFelt.fill("havremelk");
  await mengdeFelt.fill("3");
  await leggTil.click();
  const varsel = page.getByRole("group", { name: "«havremelk» står allerede på listen" });
  await expect(varsel).toContainText("Havremelk · 2 · Ost og meieri");
  await expect(varsel).toContainText("Nytt antall: 2 + 3 = 5");
  await page.screenshot({ path: "test-results/innlegging-varsel-390.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "390 px uten vannrett rulling",
  ).toBe(true);
  await varsel.getByRole("button", { name: "Avbryt" }).click();
  await expect(varsel).toHaveCount(0);
  await expect(vareFelt).toHaveValue("havremelk");
  expect(await les("shopping")).toEqual(HANDLELISTE);
  expect(await les("items")).toEqual(VARER);

  // «Øk antallet»: bare mengden på målraden endres; alt annet er urørt.
  await leggTil.click();
  await varsel.getByRole("button", { name: "Øk antallet" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Økte «Havremelk» til 5." }),
  ).toBeVisible();
  await expect(vareFelt).toHaveValue("");
  const etter = (await les("shopping")) as Record<string, unknown>;
  const { _reactForsok: kvittering, ...resten } = etter;
  expect(resten).toEqual({ ...HANDLELISTE, "inn-s1": { ...MELK, amount: "5" } });
  expect(Object.values(kvittering as object)).toEqual([
    { okt: { "inn-s1": { fra: "2", til: "5" } } },
  ]);
  expect(await les("items")).toEqual(VARER);

  // Uklar mengde (enhet på raden): ingen økning tilbys.
  await vareFelt.fill("Knekkebrød");
  await mengdeFelt.fill("1");
  await leggTil.click();
  const brod = page.getByRole("group", { name: "«Knekkebrød» står allerede på listen" });
  await expect(brod).toContainText("enheter eller fritekst");
  await expect(brod.getByRole("button", { name: "Øk antallet" })).toBeDisabled();
  await brod.getByRole("button", { name: "Avbryt" }).click();

  // Ny vare uten treff: én ny rad, varen opprettes først nå.
  await vareFelt.fill("Rugmel");
  await page.getByText("＋ Opprett «Rugmel»").click();
  await page.getByRole("button", { name: "Tørrvarer" }).click();
  await mengdeFelt.fill("1");
  await leggTil.click();
  await expect(page.getByRole("status").filter({ hasText: "La til «Rugmel»." })).toBeVisible();
  const liste = (await les("shopping")) as Record<string, { name?: string }>;
  expect(Object.values(liste).filter((r) => r.name === "Rugmel")).toHaveLength(1);
  await page.screenshot({ path: "test-results/innlegging-etter-390.png" });
});

test("målraden endres på en annen enhet etter visning: konflikt, ingenting skrives, utkastet står", async ({
  page,
}) => {
  await sett({ shopping: HANDLELISTE, items: VARER });
  await page.setViewportSize({ width: 1280, height: 900 });
  await loggInn(page);
  await page.goto("/mat/handle");
  await page.getByPlaceholder("Hva trenger du?").fill("Havremelk");
  await page.getByRole("textbox", { name: "Mengde" }).fill("1");
  await page.getByRole("button", { name: "Legg til" }).click();
  const varsel = page.getByRole("group", { name: "«Havremelk» står allerede på listen" });
  await expect(varsel).toContainText("Nytt antall: 2 + 1 = 3");

  await sett({ "shopping/inn-s1/amount": "4" });
  const foer = await les("shopping");
  await varsel.getByRole("button", { name: "Øk antallet" }).click();
  await expect(page.getByRole("alert")).toContainText("Raden er endret");
  expect(await les("shopping")).toEqual(foer);
  await expect(page.getByPlaceholder("Hva trenger du?")).toHaveValue("Havremelk");
  await expect(page.getByRole("textbox", { name: "Mengde" })).toHaveValue("1");
  await page.screenshot({ path: "test-results/innlegging-konflikt-1280.png" });
});
