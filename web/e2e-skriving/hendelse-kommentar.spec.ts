import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Kommentar på én vanlig manuell økonomisk hendelse (#59, ordre 7002365160,
 * #141) — KUN mot Firebase-emulatoren, syntetiske data, ekte React-UI på
 * mobilbredde. Hendelsene leses rett fra emulatoren: bare målets `kommentar`
 * og `oppdatert` endres, noden forblir en array, og fordelinger, ukjente
 * felt og andre hendelser står.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-kommentar-${Date.now()}-${Math.random()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const les = (node: string) => medDb(async (db) => (await db.ref(`${FAM}/${node}`).get()).val());
const sett = (noder: Record<string, unknown>) =>
  medDb(async (db) => {
    for (const [node, verdi] of Object.entries(noder)) await db.ref(`${FAM}/${node}`).set(verdi);
  });

const DATO = new Date().toISOString().slice(0, 10); // inneværende måned
const MANUELL = {
  id: "e2e-manuell-1",
  status: "ferdig",
  transaksjonId: null,
  receiptId: null,
  fordelinger: [
    {
      plasseringId: "dagligvarer",
      plasseringType: "budget",
      plasseringNavn: "Dagligvarer",
      belop: 180,
      eiere: [{ person: "Felles", prosent: 100 }],
    },
  ],
  dato: DATO,
  regelId: null,
  kilde: "manuell",
  kommentar: "Torget lørdag",
  opprettet: "2026-11-01T10:00:00.000Z",
  oppdatert: "2026-11-01T10:00:00.000Z",
  ukjentFelt: { fra: "e2e" },
};
const ANNEN = { ...MANUELL, id: "e2e-manuell-2", kommentar: "Urørt", ukjentFelt: { n: 2 } };
/** Slik emulatoren lagrer den: uten `null`-felt. */
const lagret = (h: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(h).filter(([, v]) => v !== null));

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

test.afterEach(async () => {
  await sett({ hendelser: null, budget: null });
});

test("kommentar på manuell hendelse på mobil: egen handling, bare kommentar og `oppdatert` endres; konflikt beholder utkastet; tømming fjerner nøkkelen", async ({
  page,
}) => {
  await sett({
    hendelser: [ANNEN, MANUELL],
    budget: { mat: { dagligvarer: { name: "Dagligvarer", months: {} } } },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await loggInn(page);
  await page.goto("/forvaltning/okonomi?omrade=kostnader");
  await page.getByText("Mat og dagligvarer").first().click();
  await page.getByRole("button", { name: "Vis hendelser bak dette tallet" }).first().click();
  await page.getByRole("button", { name: /Torget lørdag/ }).click();

  const dialog = page.getByRole("dialog").last();
  const seksjon = dialog.getByRole("region", { name: "Kommentar" });
  await expect(seksjon.getByTestId("hendelse-kommentar")).toHaveText("Torget lørdag");
  await seksjon.getByRole("button", { name: "Rediger kommentar" }).click();
  const felt = seksjon.getByRole("textbox", { name: "Kommentar på hendelsen" });
  await felt.fill("  Torget lørdag\nmed besteforeldre  ");
  await seksjon.getByRole("button", { name: "Lagre kommentar" }).click();
  await expect(seksjon.getByRole("status")).toHaveText("Kommentaren er lagret.");

  await expect(async () => {
    const h = (await les("hendelser")) as Record<string, unknown>[];
    expect(Array.isArray(h)).toBe(true);
    expect(h).toHaveLength(2);
    expect(h[0]).toEqual(lagret(ANNEN));
    const { oppdatert, ...resten } = h[1]!;
    expect(resten).toEqual(
      lagret({ ...MANUELL, kommentar: "Torget lørdag\nmed besteforeldre", oppdatert: undefined }),
    );
    expect(typeof oppdatert).toBe("string");
    expect(oppdatert).not.toBe(MANUELL.oppdatert);
  }).toPass();
  await expect(seksjon.getByTestId("hendelse-kommentar")).toHaveText(
    "Torget lørdag\nmed besteforeldre",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "390 px uten vannrett rulling",
  ).toBe(true);
  await page.screenshot({ path: "test-results/hendelse-kommentar-390.png" });

  // En annen enhet endrer kommentaren mens utkastet står åpent.
  await seksjon.getByRole("button", { name: "Rediger kommentar" }).click();
  await felt.fill("Mitt utkast");
  await medDb((db) => db.ref(`${FAM}/hendelser/1/kommentar`).set("Fra en annen enhet"));
  await seksjon.getByRole("button", { name: "Lagre kommentar" }).click();
  await expect(seksjon.getByRole("alert")).toContainText("Utkastet ditt står");
  await expect(felt).toHaveValue("Mitt utkast");
  expect(((await les("hendelser")) as Record<string, unknown>[])[1]).toMatchObject({
    kommentar: "Fra en annen enhet",
  });
  await page.screenshot({ path: "test-results/hendelse-kommentar-konflikt-390.png" });

  // Eksplisitt nytt grunnlag, deretter tømming: nøkkelen fjernes.
  await seksjon.getByRole("button", { name: "Bruk gjeldende kommentar som grunnlag" }).click();
  await felt.fill("");
  await seksjon.getByRole("button", { name: "Lagre kommentar" }).click();
  await expect(seksjon.getByRole("status")).toHaveText("Kommentaren er lagret.");
  await expect(async () => {
    const h = (await les("hendelser")) as Record<string, unknown>[];
    expect(Object.hasOwn(h[1]!, "kommentar")).toBe(false);
    expect(h[1]!.fordelinger).toEqual(MANUELL.fordelinger);
    expect(h[1]!.ukjentFelt).toEqual(MANUELL.ukjentFelt);
    expect(h[0]).toEqual(lagret(ANNEN));
  }).toPass();
  await expect(seksjon.getByText("Ingen kommentar.")).toBeVisible();
});

test("bankkoblet hendelse har ingen kommentarhandling", async ({ page }) => {
  await sett({
    hendelser: [{ ...MANUELL, kilde: null, transaksjonId: "t-bank", kommentar: "Bank" }],
    budget: { mat: { dagligvarer: { name: "Dagligvarer", months: {} } } },
    transaksjoner: [
      {
        id: "t-bank",
        dato: DATO,
        tekst: "REMA 1000",
        belop: 180,
        retning: "ut",
        konto: "Felleskonto",
        status: "behandlet",
        hendelseId: "e2e-manuell-1",
      },
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await loggInn(page);
  await page.goto("/forvaltning/okonomi?omrade=kostnader");
  await page.getByText("Mat og dagligvarer").first().click();
  await page.getByRole("button", { name: "Vis hendelser bak dette tallet" }).first().click();
  await page.getByRole("button", { name: /REMA 1000/ }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog.getByRole("button", { name: "Lagre korrigering" })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Kommentar" })).toHaveCount(0);
  await sett({ transaksjoner: null });
});
