import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * React-Matlager «Legg til» velger målpost ved commit (#20, ordre
 * 6698904630) — KUN mot Firebase-emulatoren, syntetiske poster. Skriver
 * via React-UI-et og leser resultatet rett fra emulatoren. Stale- og
 * samtidighetstilfellene for samme klientvei dekkes i
 * `src/data/freezer.maalvalg.integration.test.ts`; legacy-veien i
 * `e2e-legacy/matlager-maalvalg.spec.ts`.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-mv-${Date.now()}-${Math.random()}`,
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
let lagret: { freezer: unknown; items: unknown };
test.beforeEach(async () => {
  lagret = { freezer: await les("freezer"), items: await les("items") };
});
test.afterEach(async () => {
  await sett("freezer", lagret.freezer);
  await sett("items", lagret.items);
});

async function tilMatlager(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
  await page.goto("/mat/fryser");
}

async function leggTil(page: Page, navn: string, gram?: string) {
  await page.getByRole("button", { name: "＋ Legg til" }).click();
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill(navn);
  await page.getByText(`＋ Opprett «${navn}»`).click();
  await page.getByRole("button", { name: "Diverse" }).click();
  if (gram) await page.getByPlaceholder("f.eks. 500").fill(gram);
  await page.getByRole("button", { name: "＋ Legg til i matlageret" }).click();
}

const annen = {
  itemId: "v-annen",
  name: "Mv-erter",
  batches: [{ id: "e1", count: 2, unit: "pose" }],
  ukjent: { nested: true },
};

test("eksisterende legacy-post med annen varebase-id: tillegget går til samme node, kobling og felt bevares", async ({
  page,
}) => {
  const post = {
    id: "mv-torsk",
    itemId: "v-legacy",
    name: "Mv-torsk",
    batches: [{ id: "t1", count: 1, unit: "pk", gramsPerUnit: 400 }],
    sted: "fryser",
  };
  await sett("freezer", { "mv-torsk": post, "mv-erter": annen });
  await tilMatlager(page);
  await expect(page.getByText("Mv-torsk", { exact: true })).toBeVisible();
  await leggTil(page, "Mv-torsk", "400");
  await expect(page.getByRole("dialog", { name: "Legg til i matlageret" })).not.toBeVisible();

  const f = (await les("freezer")) as Record<string, typeof post>;
  expect(Object.keys(f).sort()).toEqual(["mv-erter", "mv-torsk"]);
  expect(f["mv-torsk"]).toEqual({
    ...post,
    batches: [{ id: "t1", count: 2, unit: "pk", gramsPerUnit: 400 }],
  });
  expect(f["mv-erter"]).toEqual(annen);
});

test("flere poster med samme navn: synlig avvisning, ingenting skrevet, skjemaet beholdes", async ({
  page,
}) => {
  const data = {
    s1: { itemId: "v1", name: "Mv-sei", batches: [{ id: "a", count: 1, unit: "stk" }] },
    s2: { itemId: "v2", name: "MV-SEI", batches: [{ id: "b", count: 1, unit: "stk" }] },
    "mv-erter": annen,
  };
  await sett("freezer", data);
  await tilMatlager(page);
  await expect(page.getByText("MV-SEI", { exact: true })).toBeVisible();
  await leggTil(page, "Mv-sei");
  await expect(page.getByRole("alert")).toContainText("Det finnes 2 varer som heter «Mv-sei»");
  await expect(page.getByRole("alert")).toContainText("Ingenting er lagret");
  await expect(page.getByRole("dialog", { name: "Legg til i matlageret" })).toBeVisible();
  await expect(page.getByPlaceholder("f.eks. Karbonadedeig")).toHaveValue("Mv-sei");
  expect(await les("freezer")).toEqual(data);
});
