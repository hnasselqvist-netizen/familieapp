import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Beskrivende varelinjer (#59, kvitteringer C) med forsoningsporten PÅ —
 * KUN mot Firebase-emulatoren (`npm run test:e2e:skriving`). Syntetiske
 * kvitteringer seedet i legacy sin array-form; resultatet leses rett fra
 * emulatoren: bare `varelinjer*` på riktig kvittering endres.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-vl-${Date.now()}-${Math.random()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const lesReceipts = () =>
  medDb(async (db) => (await db.ref(`${FAM}/receipts`).get()).val() as Record<string, unknown>[]);

const R1 = {
  id: "vl-r1",
  merchant: "Syntetisk butikk",
  purchaseDate: "2026-11-01",
  total: 30,
  allocationMode: "single",
  splits: [
    {
      targetType: "budget",
      targetId: "dagligvarer",
      targetName: "Dagligvarer",
      amount: 30,
      eiere: [{ person: "Felles", prosent: 100 }],
    },
  ],
  matchingStatus: "unmatched",
  hendelseId: null,
  imageUrl: "data:image/png;base64,iVBORw0KGgo=",
  driveFileId: "drive-syntetisk",
  fremtidigFelt: { behold: true },
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};
/** Slik RTDB lagrer seeden: `null`, tomme arrays og tomme objekter lagres aldri. */
function lagretForm<T>(o: T): T {
  const rens = (v: unknown): unknown => {
    if (v === null) return undefined;
    if (Array.isArray(v)) {
      const a = v.map(rens).filter((x) => x !== undefined);
      return a.length ? a : undefined;
    }
    if (v && typeof v === "object") {
      const e = Object.entries(v)
        .map(([k, x]) => [k, rens(x)] as const)
        .filter(([, x]) => x !== undefined);
      return e.length ? Object.fromEntries(e) : undefined;
    }
    return v;
  };
  return rens(o) as T;
}
const R2 = {
  id: "vl-r2",
  merchant: "Annen butikk",
  total: 12,
  matchingStatus: "unmatched",
  splits: [],
};

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

async function apne(page: Page) {
  await page.goto("/forvaltning/kvitteringer");
  await page.getByRole("button", { name: /Syntetisk butikk/ }).click();
  return page.getByRole("region", { name: "Varelinjer" });
}

test.beforeEach(async () => {
  await medDb(async (db) => {
    await db.ref(`${FAM}/receipts`).set([R1, R2]);
    await db.ref(`${FAM}/hendelser`).set(null);
  });
});

test.afterAll(async () => {
  await medDb((db) => db.ref(`${FAM}/receipts`).set(null));
});

test("varelinjer: registrer → lagre → reload → rediger og fjern; bare egne felt endres", async ({
  page,
}) => {
  await loggInn(page);
  let vl = await apne(page);
  await expect(vl.getByText(/Påvirker ikke økonomien/)).toBeVisible();

  await vl.getByRole("button", { name: "Legg til varelinje" }).click();
  let linje = vl.getByRole("group", { name: /^Linje 1/ });
  await linje.getByLabel("Vare eller tekst").fill("Kaffe");
  await linje.getByLabel("Linjebeløp før rabatt (kr)").fill("35,90");
  await linje.getByLabel("Rabatt (kr, valgfritt)").fill("5,90");
  await vl.getByRole("button", { name: "Legg til varelinje" }).click();
  linje = vl.getByRole("group", { name: /^Linje 2/ });
  await linje.getByLabel("Vare eller tekst").fill("Pose");
  await linje.getByLabel("Linjebeløp før rabatt (kr)").fill("0");
  await vl.getByRole("button", { name: "Lagre varelinjer" }).click();
  await expect(vl.getByText("Varelinjene er lagret.")).toBeVisible();

  let [r1, r2] = await lesReceipts();
  expect(Array.isArray(await lesReceipts())).toBe(true);
  const { varelinjer, varelinjerVersjon, varelinjerSkrivId, varelinjerOppdatert, ...resten } = r1!;
  expect(resten).toEqual(lagretForm(R1));
  expect(r2).toEqual(lagretForm(R2));
  expect(varelinjerVersjon).toBe(1);
  expect(varelinjerSkrivId).toBeTruthy();
  expect(varelinjerOppdatert).toBeTruthy();
  expect(varelinjer).toEqual([
    { id: expect.any(String), art: "vare", tekst: "Kaffe", belopOre: 3590, rabattOre: 590 },
    { id: expect.any(String), art: "vare", tekst: "Pose", belopOre: 0 },
  ]);

  // Reload: detaljene står.
  await page.reload();
  vl = await apne(page);
  await expect(vl.getByLabel("Vare eller tekst").first()).toHaveValue("Kaffe");
  await expect(vl.getByText("Sum linjer (etter rabatt)")).toBeVisible();

  // Rediger linje 1 og fjern linje 2.
  await vl
    .getByRole("group", { name: /^Linje 1/ })
    .getByLabel("Vare eller tekst")
    .fill("Kaffe, hele bønner");
  await vl.getByRole("button", { name: "Fjern linje 2 (Pose)" }).click();
  await vl.getByRole("button", { name: "Lagre varelinjer" }).click();
  await expect(vl.getByText("Varelinjene er lagret.")).toBeVisible();
  [r1, r2] = await lesReceipts();
  expect(r1!.varelinjer).toEqual([
    {
      id: (varelinjer as { id: string }[])[0]!.id,
      art: "vare",
      tekst: "Kaffe, hele bønner",
      belopOre: 3590,
      rabattOre: 590,
    },
  ]);
  expect(r1!.varelinjerVersjon).toBe(2);
  expect(r2).toEqual(lagretForm(R2));

  // Smal flate: ingen vannrett rulling.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(vl).toBeVisible();
  const flyter = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(flyter).toBe(false);
});

test("varelinjer: levende endring fra en annen enhet beholder utkastet og gir konflikt-valg", async ({
  page,
}) => {
  await loggInn(page);
  const vl = await apne(page);
  await vl.getByRole("button", { name: "Legg til varelinje" }).click();
  await vl
    .getByRole("group", { name: /^Linje 1/ })
    .getByLabel("Vare eller tekst")
    .fill("Mitt utkast");

  // En annen enhet lagrer varelinjer på samme kvittering.
  await medDb((db) =>
    db.ref(`${FAM}/receipts/0`).update({
      varelinjer: [{ id: "fra-b", art: "vare", tekst: "Fra annen enhet", belopOre: 1000 }],
      varelinjerVersjon: 1,
    }),
  );
  await expect(vl.getByText(/endret på en annen enhet mens du skrev/)).toBeVisible();
  await expect(vl.getByLabel("Vare eller tekst")).toHaveValue("Mitt utkast");

  await vl.getByRole("button", { name: "Lagre varelinjer" }).click();
  await expect(vl.getByRole("alert")).toContainText("endret på en annen enhet");
  await expect(vl.getByLabel("Vare eller tekst")).toHaveValue("Mitt utkast");
  // Ingenting ble skrevet over.
  expect((await lesReceipts())[0]!.varelinjer).toEqual([
    { id: "fra-b", art: "vare", tekst: "Fra annen enhet", belopOre: 1000 },
  ]);

  await vl.getByRole("button", { name: "Forkast det jeg skrev" }).click();
  await expect(vl.getByLabel("Vare eller tekst")).toHaveValue("Fra annen enhet");
});
