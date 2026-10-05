import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Skrivende Forvaltning-flyter med forsoningsporten PÅ (§Issue #34,
 * pre-cutover 3) — KUN mot Firebase-emulatoren, via
 * `npm run test:e2e:skriving` (bygget i modus «e2e-skriving»).
 *
 * Hver test seeder nodene i legacy sin form, skriver gjennom React-UI-et
 * og leser resultatet rett fra emulatoren med firebase-admin: nodene skal
 * forbli arrays (legacy leser dem med `Object.values`/array-indekser) og
 * aldri få `node/{id}`-nøkler.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-${Date.now()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const les = (node: string) => medDb(async (db) => (await db.ref(`${FAM}/${node}`).get()).val());
const settNoder = (noder: Record<string, unknown>) =>
  medDb(async (db) => {
    for (const [node, verdi] of Object.entries(noder)) await db.ref(`${FAM}/${node}`).set(verdi);
  });

/** Nodene skal være legacy-arrays: sammenhengende indekser, ingen id-nøkler. */
async function forventArray(node: string, lengde: number) {
  const v = await les(node);
  expect(Array.isArray(v), `${node} er array`).toBe(true);
  expect(v, node).toHaveLength(lengde);
  return v as Record<string, unknown>[];
}

const tx = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  dato: "2026-09-20",
  tekst: "REMA 1000 GRUNERLOKKA",
  belop: 412.5,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...o,
});

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

test.beforeEach(async () => {
  await settNoder({
    transaksjoner: [tx("t1"), tx("t2", { tekst: "KIWI 505", belop: 99 })],
    hendelser: null,
    receipts: null,
    rules: null,
    budget: { mat: { dagligvarer: { name: "Dagligvarer", months: {} } } },
  });
});

test("Forvaltning-forsiden er handlingsflaten når porten er på, med inngang til riktig kø", async ({
  page,
}) => {
  await loggInn(page);
  await page.goto("/forvaltning");
  await expect(page.getByText(/ikke migrert/)).not.toBeVisible();
  const oppmerksomhet = page.getByRole("region", { name: "Trenger oppmerksomhet" });
  await oppmerksomhet.getByRole("link", { name: "2 transaksjoner å vurdere" }).click();
  await expect(page).toHaveURL(/\/forvaltning\/transaksjoner\?ko=vurdering$/);
  await expect(page.getByRole("tab", { name: /Krever vurdering\s*2/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("Bankimport-beslutning med læring skriver hendelser, transaksjoner og rules som arrays", async ({
  page,
}) => {
  await loggInn(page);
  await page.goto("/forvaltning/transaksjoner");
  await page.getByRole("button", { name: /REMA 1000 GRUNERLOKKA/ }).click();
  const panel = page.getByRole("group", { name: "Behandle REMA 1000 GRUNERLOKKA" });
  await panel.getByRole("searchbox", { name: "Søk blant poster" }).fill("dagl");
  await panel
    .getByRole("button", { name: /Dagligvarer/ })
    .first()
    .click();
  await panel.getByRole("checkbox", { name: /Lær denne koblingen/ }).check();
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(panel).not.toBeVisible();

  const [h] = await forventArray("hendelser", 1);
  expect(h).toMatchObject({ status: "ferdig", transaksjonId: "t1" });
  const t = await forventArray("transaksjoner", 2);
  expect(t[0]).toMatchObject({ id: "t1", hendelseId: h!.id });
  expect(t[1]).toMatchObject({ id: "t2" });
  const [r] = await forventArray("rules", 1);
  expect(r).toMatchObject({ targetId: "dagligvarer" });
});

test("ny kvittering skriver receipts som array", async ({ page }) => {
  await loggInn(page);
  await page.goto("/forvaltning/kvitteringer");
  await page.getByRole("button", { name: "＋ Ny kvittering" }).click();
  const panel = page.getByRole("group", { name: "Ny kvittering" });
  await panel.getByLabel("Leverandør").fill("Obs Bygg");
  await panel.getByLabel("Totalbeløp").fill("300");
  await panel.getByRole("button", { name: "Registrer kvittering" }).click();
  await expect(panel).not.toBeVisible();

  const [k] = await forventArray("receipts", 1);
  expect(k).toMatchObject({ merchant: "Obs Bygg", total: 300, matchingStatus: expect.any(String) });
});

test("korrigering til «på vent» erstatter hendelsen i arrayet", async ({ page }) => {
  await settNoder({
    transaksjoner: [tx("t1", { hendelseId: "h1" }), tx("t2", { tekst: "KIWI 505", belop: 99 })],
    hendelser: [
      {
        id: "h1",
        status: "ferdig",
        paaVentAarsak: null,
        transaksjonId: "t1",
        receiptId: null,
        dato: "2026-09-20",
        regelId: null,
        opprettet: "2026-09-20T10:00:00.000Z",
        oppdatert: "2026-09-20T10:00:00.000Z",
        fordelinger: [
          {
            plasseringId: "dagligvarer",
            plasseringType: "budget",
            plasseringNavn: "Dagligvarer",
            belop: 412.5,
            eiere: [{ person: "Felles", prosent: 100 }],
          },
        ],
      },
    ],
  });
  await loggInn(page);
  await page.goto("/forvaltning/transaksjoner");
  await page.getByRole("button", { name: "Alle transaksjoner" }).click();
  await page.getByRole("button", { name: "Korriger kobling REMA 1000 GRUNERLOKKA" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Sett på vent" }).click();
  await dialog.getByRole("group", { name: "Årsak" }).getByRole("button").first().click();
  await dialog.getByRole("button", { name: "Lagre korrigering" }).click();
  await expect(dialog).not.toBeVisible();

  const [h] = await forventArray("hendelser", 1);
  expect(h).toMatchObject({ id: "h1", status: "pa_vent", transaksjonId: "t1" });
  expect(h!.fordelinger).toBeUndefined(); // tom liste lagres ikke i RTDB
  await forventArray("transaksjoner", 2);
});
