import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * React-Matlager «Fjern varen» med grunnlagsvern (#20, ordre 6700834307)
 * — KUN mot Firebase-emulatoren, syntetiske poster, ekte React-UI.
 *
 * Foreldet bilde gjøres deterministisk: nettleserens RTDB-websocket går
 * gjennom `routeWebSocket`, og meldinger fra serveren holdes tilbake mens
 * en annen klient (Admin SDK) endrer posten. Brukeren trykker «Fjern» på
 * posten slik hen ser den; først etterpå slippes meldingene frem.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-fj-${Date.now()}-${Math.random()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const les = (node: string) => medDb(async (db) => (await db.ref(`${FAM}/${node}`).get()).val());
const sett = (node: string, v: unknown) => medDb((db) => db.ref(`${FAM}/${node}`).set(v));

// Testene deler emulatoren med e2e-suiten: legg tilbake det som var.
let lagret: unknown;
test.beforeEach(async () => {
  lagret = await les("freezer");
});
test.afterEach(async () => {
  await sett("freezer", lagret);
});

/** Ruter RTDB-websocketen og gir en bryter som holder tilbake server→nettleser-meldinger. */
async function styrbarSocket(page: Page) {
  let holdTilbake = false;
  const kø: (() => void)[] = [];
  await page.routeWebSocket(/:9000\/\.ws/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => (holdTilbake ? kø.push(() => ws.send(m)) : ws.send(m)));
  });
  return {
    hold: () => {
      holdTilbake = true;
    },
    slipp: () => {
      holdTilbake = false;
      for (const send of kø.splice(0)) send();
    },
  };
}

async function tilMatlager(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
  await page.goto("/mat/fryser");
}

const laks = {
  itemId: "v-laks",
  name: "Fj-laks",
  batches: [{ id: "l1", count: 2, unit: "pk", gramsPerUnit: 400 }],
};
const annen = {
  id: "fj-erter",
  itemId: "v-erter",
  name: "Fj-erter",
  batches: [{ id: "e1", count: 1, unit: "pose" }],
  ukjent: { a: 1 },
};

test("«Fjern» på foreldet bilde etter at en annen klient la til en batch: synlig konflikt, ingenting slettet", async ({
  page,
}) => {
  await sett("freezer", { "fj-laks": laks, "fj-erter": annen });
  const socket = await styrbarSocket(page);
  await tilMatlager(page);
  await expect(page.getByText("Fj-laks", { exact: true })).toBeVisible();

  socket.hold();
  const nyBatch = { id: "l2", count: 1, unit: "boks" };
  await sett("freezer/fj-laks/batches/1", nyBatch);
  const knapp = page.getByRole("button", { name: "Fjern Fj-laks fra matlageret" });
  await knapp.click();
  await expect.soft(knapp).toBeDisabled(); // knappelås mens forsøket pågår
  socket.slipp();

  await expect(page.getByRole("alert")).toContainText(
    "«Fj-laks» er endret på en annen enhet siden du så den. Ingenting er fjernet",
  );
  expect(await les("freezer")).toEqual({
    "fj-laks": { ...laks, batches: [...laks.batches, nyBatch] },
    "fj-erter": annen,
  });
  await expect(knapp).toBeEnabled();
});

test("«Fjern» på uendret post sletter den; andre poster urørt", async ({ page }) => {
  await sett("freezer", { "fj-laks": laks, "fj-erter": annen });
  await tilMatlager(page);
  await page.getByRole("button", { name: "Fjern Fj-laks fra matlageret" }).click();
  await expect(page.getByText("Fj-laks", { exact: true })).not.toBeVisible();
  expect(await les("freezer")).toEqual({ "fj-erter": annen });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
