import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Handlelistegeneratorens «Legg til N varer» (Mat #20, ordre 6843084184) —
 * KUN mot Firebase-emulatoren, syntetiske data. Playwright lar PUT-en nå
 * emulatoren (`route.fetch`) og avbryter så svaret til siden
 * (`route.abort`): serveren har lagret, klienten vet det ikke. «Prøv igjen»
 * skal da sjekke samme `opId` uten å skrive, og skjemaet lukkes først når
 * lagringen er bekreftet. Et svar tapt FØR serveren gir et gjentak uten
 * kvittering: fortsatt ubekreftet, ingenting skrevet.
 */
const FAM = `families/${FAMILY_ID}`;
const OPPSKRIFT = "gen-e2e-r";

/** Speiler `getWeekKey` (§domain/shared/weekKey.ts). */
function ukeNokkel(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const n =
    1 +
    Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(n).padStart(2, "0")}`;
}
/** Neste uke: alltid kommende, så generatoren viser den som kandidat. */
const NESTE_UKE = ukeNokkel(new Date(Date.now() + 7 * 86400000));

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-gen-${Date.now()}-${Math.random()}`,
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
const rader = (e: Record<string, unknown>, navn: string) =>
  Object.values(e).filter((r) => (r as { name?: string })?.name === navn) as Record<
    string,
    unknown
  >[];

const LISTE = {
  "gen-m": {
    id: "gen-m",
    itemId: null,
    name: "GenMelk",
    amount: "2",
    cat: "Ost og meieri",
    done: false,
    ".priority": 5,
  },
  _ops: { r1: { tool: "shopping_list_add_items", at: 1 } },
};

async function forbered(page: Page) {
  await sett({
    shopping: LISTE,
    [`recipes/${OPPSKRIFT}`]: {
      id: OPPSKRIFT,
      name: "Gen-middag",
      cat: "Middag",
      ingredients: [
        { name: "GenMelk", amount: "3", cat: "Ost og meieri" },
        { name: "GenEgg", amount: "6", unit: "stk", cat: "Ost og meieri" },
      ],
    },
    [`meals/${NESTE_UKE}/Mon`]: { type: "recipe", name: "Gen-middag", recipeId: OPPSKRIFT },
  });
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
  await page.goto("/mat/plan");
  await page.getByRole("button", { name: "Lag handleliste" }).click();
  await page.getByRole("button", { name: /Hent ingredienser/ }).click();
  await expect(page.getByText("GenEgg", { exact: true })).toBeVisible();
}

/**
 * Antallet varer avhenger av andre middager i den delte emulatoren (f.eks.
 * fra e2e/shoppinggenerator.spec.ts når suitene kjøres etter hverandre).
 * Testene sjekker derfor GenMelk/GenEgg og antall PUT-er, ikke N.
 */
const LEGG_TIL = /Legg til \d+ varer/;

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

function tellPuts(page: Page) {
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/shopping.json")) puts.push(r.url());
  });
  return puts;
}

test.afterEach(async () => {
  await sett({ shopping: null, [`recipes/${OPPSKRIFT}`]: null, [`meals/${NESTE_UKE}/Mon`]: null });
});

test("tapt svar etter lagring: skjemaet står ubekreftet; «Prøv igjen» er skrivefri og lukker ved bekreftelse", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await forbered(page);
  const puts = tellPuts(page);
  const dialog = page.getByRole("dialog");

  await tapNesteSvar(page, "etter");
  await page.getByRole("button", { name: LEGG_TIL }).click();
  const ventende = dialog.getByRole("alert", { name: "Ikke bekreftet" });
  await expect(ventende).toContainText("Vi vet ikke om varene ble lagt til");
  await expect(page.getByRole("button", { name: LEGG_TIL })).toBeDisabled();

  // Serveren lagret: summert mengde, én ny rad, prioritet og metadata bevart.
  await expect.poll(async () => rader(await eksport(), "GenEgg").length).toBe(1);
  await page.unrouteAll();
  const lagret = await eksport();
  expect(lagret["gen-m"]).toMatchObject({ amount: "5", ".priority": 5 });
  expect(lagret._ops).toEqual(LISTE._ops);
  await page.screenshot({ path: "test-results/generator-tapt-svar-390.png" });

  await ventende.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(dialog).toHaveCount(0);
  expect(puts).toHaveLength(1); // bare det tapte forsøket
  expect(JSON.stringify(await eksport())).toBe(JSON.stringify(lagret));
});

test("dobbeltklikk gir én innsending og én virkning", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await forbered(page);
  const puts = tellPuts(page);

  await page.getByRole("button", { name: LEGG_TIL }).dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const etter = await eksport();
  expect(puts).toHaveLength(1);
  expect(rader(etter, "GenEgg")).toHaveLength(1);
  expect(etter["gen-m"]).toMatchObject({ amount: "5", ".priority": 5 });
});

test("tapt svar før serveren: gjentaket skriver ikke, statusen står, og bare Helens valg lukker", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await forbered(page);
  const foer = await eksport();
  const puts = tellPuts(page);
  const dialog = page.getByRole("dialog");

  await tapNesteSvar(page, "foer");
  await page.getByRole("button", { name: LEGG_TIL }).click();
  const ventende = dialog.getByRole("alert", { name: "Ikke bekreftet" });
  await expect(ventende).toContainText("Vi vet ikke om varene ble lagt til");
  await page.unrouteAll();

  await ventende.getByRole("button", { name: "Prøv igjen" }).click();
  await expect(ventende).toContainText("Fortsatt ikke bekreftet: Fant ingen kvittering");
  expect(puts).toHaveLength(1);
  expect(JSON.stringify(await eksport())).toBe(JSON.stringify(foer));

  // Avbryt lukker ikke direkte; Helen må bekrefte.
  await dialog.getByRole("button", { name: "Avbryt" }).click();
  await expect(dialog).toBeVisible();
  await ventende.getByRole("button", { name: "Jeg har sjekket listen — lukk" }).click();
  await expect(dialog).toHaveCount(0);
  expect(JSON.stringify(await eksport())).toBe(JSON.stringify(foer));
});

test("listen endres mens gjennomgangen står åpen: første klikk skriver ikke på grunnlag Helen ikke så; ny effekt vises og bekreftes (review 5912682963 pkt. 2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Abonnementet i nettleseren må faktisk ha fått raden før klikket.
  let mottatt = false;
  page.on("websocket", (ws) =>
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string" && f.payload.includes("gen-e2e-egg")) mottatt = true;
    }),
  );
  await forbered(page);
  const dialog = page.getByRole("dialog");

  await medDb((db) =>
    db.ref(`${FAM}/shopping/gen-e2e-egg`).set({
      id: "gen-e2e-egg",
      itemId: null,
      name: "GenEgg",
      amount: "1",
      cat: "Ost og meieri",
      done: false,
    }),
  );
  await expect.poll(() => mottatt).toBe(true);
  const foer = await eksport();

  await page.getByRole("button", { name: LEGG_TIL }).click();
  await expect(dialog.getByRole("alert")).toContainText("Se gjennom varene på nytt");
  const effekt = dialog.getByRole("group", { name: "Slik blir listen nå" });
  await expect(effekt).toContainText("GenEgg: 1 → 7 (legges sammen med raden på listen)");
  await expect(effekt).toContainText("GenMelk: 2 → 5 (legges sammen med raden på listen)");
  expect(JSON.stringify(await eksport())).toBe(JSON.stringify(foer));
  await page.screenshot({ path: "test-results/generator-ny-effekt-390.png" });

  await page.getByRole("button", { name: LEGG_TIL }).click();
  await expect(dialog).toHaveCount(0);
  const etter = await eksport();
  expect(etter["gen-e2e-egg"]).toMatchObject({ amount: "7" });
  expect(etter["gen-m"]).toMatchObject({ amount: "5", ".priority": 5 });
  expect(rader(etter, "GenEgg")).toHaveLength(1);
});
