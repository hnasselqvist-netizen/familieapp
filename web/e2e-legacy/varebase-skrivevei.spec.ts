/**
 * Legacy-varebasen: serverforankret finn/opprett (#20, ordre 6813547091).
 * Testene kjører ekte legacy `index.html` mot Firebase-emulatoren, med
 * syntetiske data. «Den andre klienten» er emulator-REST (som React, MCP eller
 * en annen enhet).
 *
 * Før rettingen erstattet `finnEllerOpprettVare` hele `items` fra lokal
 * tilstand ved hver ny vare (Kokebok, Middagsbibliotek, Handleliste, Fryser),
 * og `bootstrapItems` kunne skrive en hel samling etter en tom lesing. En
 * foreldet fane kunne da overskrive nyere varer eller gjenopplive slettede.
 */
import { type Page, expect, test } from "@playwright/test";
import {
  FAM,
  aapneLegacy,
  legacyNett,
  lesData,
  nyttMedlem,
  rutLegacy,
  settData,
  settRules,
} from "./legacy-harness";

const VARER = `${FAM}/items`;
type Vare = Record<string, unknown> & { name?: string };

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

async function start(page: Page, varer: Record<string, Vare>, ekstra?: () => Promise<void>) {
  await settData(FAM, null);
  await settData(VARER, varer);
  await settData(`${FAM}/meta/itemsBootstrapped`, true);
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  if (ekstra) await ekstra();
  return aapneLegacy(page, await nyttMedlem());
}

const les = async () => ((await lesData(VARER)) ?? {}) as Record<string, Vare>;
const status = (page: Page) => page.locator("[data-vare-status]");

async function tilFryser(page: Page) {
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Fryser", { exact: true }).first().click();
  await expect(page.getByText("Legg til i fryseren", { exact: true })).toBeVisible();
}

async function aapneBibliotekpost(page: Page) {
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Bibliotek", { exact: true }).first().click();
  await page.locator('[data-bibliotek-post="p"]').click();
  await expect(page.getByPlaceholder("Legg til vare…")).toBeVisible();
}

async function opprettIVelger(page: Page, navn: string) {
  await page.getByPlaceholder("Legg til vare…").fill(navn);
  await page.getByText(`＋ Opprett «${navn}»`).click();
  await page.getByRole("button", { name: "Ost og meieri", exact: true }).click();
}

test("foreldet fane: oppretting overskriver ikke nyere varer og gjenoppliver ikke slettede", async ({
  page,
}) => {
  const feil = await start(
    page,
    { d: { name: "Brød", cat: "Brød og bakst" }, r: { name: "Laks", cat: "Fisk og sjømat" } },
    async () => settData(`${FAM}/mealLibrary/p`, { name: "Taco" }),
  );
  await aapneBibliotekpost(page);
  await legacyNett(page, "goOffline");
  // Den andre klienten sletter én vare og endrer en annen.
  await settData(`${VARER}/d`, null);
  await settData(`${VARER}/r/ukjent`, "nyere");
  await opprettIVelger(page, "Melk"); // venter til fanen er tilkoblet igjen
  await legacyNett(page, "goOnline");

  await expect
    .poll(async () => Object.values(await les()).some((v) => v.name === "Melk"))
    .toBe(true);
  const o = await les();
  expect(Object.keys(o)).not.toContain("d"); // ikke gjenopplivet
  expect(o.r).toEqual({ name: "Laks", cat: "Fisk og sjømat", ukjent: "nyere" });
  expect(Object.keys(o)).toHaveLength(2);
  const [nokkel] = Object.entries(o).find(([, v]) => v.name === "Melk")!;
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe(nokkel);
  expect(feil).toEqual([]);
});

test("foreldet fane: et navnetreff som er slettet på serveren gir konflikt og ingen falsk kobling", async ({
  page,
}) => {
  const feil = await start(page, {
    m1: { name: "Kjøttdeig", cat: "Kjøtt" },
    x: { name: "Laks", cat: "Fisk og sjømat" },
  });
  await tilFryser(page);
  await legacyNett(page, "goOffline");
  await settData(`${VARER}/m1`, null); // slettet av den andre klienten
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("Kjøttdeig");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
  await legacyNett(page, "goOnline");

  await expect(page.locator("[data-matlager-status]")).toContainText("finnes ikke lenger");
  await page.waitForTimeout(500);
  expect(await lesData(`${FAM}/freezer`)).toBeNull();
  expect(await les()).toEqual({ x: { name: "Laks", cat: "Fisk og sjømat" } }); // ikke gjenopplivet
  expect(feil).toEqual([]);
});

test("ny vare skrives bare til en ny node, og kalleren kobler til den bekreftede nøkkelen", async ({
  page,
}) => {
  const feil = await start(
    page,
    { r: { name: "Laks", cat: "Fisk og sjømat", ukjent: 1 } },
    async () => settData(`${FAM}/mealLibrary/p`, { name: "Taco" }),
  );
  await aapneBibliotekpost(page);
  await opprettIVelger(page, "Melk");

  await expect
    .poll(async () => Object.values(await les()).some((v) => v.name === "Melk"))
    .toBe(true);
  const o = await les();
  const [nokkel, melk] = Object.entries(o).find(([, v]) => v.name === "Melk")!;
  expect(melk).toEqual({ name: "Melk", cat: "Ost og meieri" });
  expect(o.r).toEqual({ name: "Laks", cat: "Fisk og sjømat", ukjent: 1 });
  expect(Object.keys(o)).toHaveLength(2);
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe(nokkel);
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("finn: normalisert navnetreff gir den bekreftede varen med nodenøkkel, uten ny vare", async ({
  page,
}) => {
  const feil = await start(page, {
    m1: { name: "Kjøttdeig", cat: "Kjøtt", ukjent: 1 },
    x: { name: "Laks", cat: "Fisk og sjømat" },
  });
  await tilFryser(page);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("  kjøttdeig ");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();

  await expect
    .poll(async () =>
      Object.values(
        ((await lesData(`${FAM}/freezer`)) ?? {}) as Record<string, { itemId?: string }>,
      ).map((p) => p.itemId),
    )
    .toEqual(["m1"]);
  expect(await les()).toEqual({
    m1: { name: "Kjøttdeig", cat: "Kjøtt", ukjent: 1 },
    x: { name: "Laks", cat: "Fisk og sjømat" },
  });
  expect(feil).toEqual([]);
});

test("finn: flere varer med samme navn gir synlig konflikt og ingen kobling", async ({ page }) => {
  const feil = await start(page, {
    m1: { name: "Kjøttdeig", cat: "Kjøtt" },
    m2: { name: "kjøttdeig", cat: "Kjøtt" },
  });
  await tilFryser(page);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("Kjøttdeig");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();

  await expect(page.locator("[data-matlager-status]")).toContainText("2 varer");
  await page.waitForTimeout(500);
  expect(await lesData(`${FAM}/freezer`)).toBeNull();
  expect(Object.keys(await les()).sort()).toEqual(["m1", "m2"]);
  expect(feil).toEqual([]);
});

test("avvist av databasen: synlig avvisning, ingen vare opprettet eller koblet", async ({
  page,
}) => {
  const feil = await start(page, { r: { name: "Laks", cat: "Fisk og sjømat" } }, async () =>
    settData(`${FAM}/mealLibrary/p`, { name: "Taco" }),
  );
  await aapneBibliotekpost(page);
  await settData(`${FAM}/members`, null);
  await opprettIVelger(page, "Melk");
  await expect(status(page)).toHaveAttribute("data-vare-status", "avvist");
  expect(await les()).toEqual({ r: { name: "Laks", cat: "Fisk og sjømat" } });
  expect(await lesData(`${FAM}/mealLibrary/p`)).toEqual({ name: "Taco" });
  expect(feil).toEqual([]);
});

test("bootstrap etter tom lesing overskriver ikke en vare som kommer til før skrivingen", async ({
  page,
}) => {
  await settData(FAM, null); // ingen markør, tom varebase
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  await settData(`${FAM}/freezer/f1`, { name: "Laks", batches: [] });
  await page.addInitScript(() => {
    const w = globalThis as unknown as {
      firebase?: { database?: { Query?: { prototype: Record<string, unknown> } } };
      __varerLest?: boolean;
      __slippVarer?: () => void;
    };
    let slipp: () => void = () => {};
    const port = new Promise<void>((r) => (slipp = r));
    w.__slippVarer = () => slipp();
    const patch = setInterval(() => {
      const proto = w.firebase?.database?.Query?.prototype;
      if (!proto) return;
      clearInterval(patch);
      const orig = proto.once as (...a: unknown[]) => Promise<unknown>;
      proto.once = function (this: { toString(): string }, ...a: unknown[]) {
        const p = orig.apply(this, a);
        if (this.toString().endsWith("/items")) {
          w.__varerLest = true;
          return p.then((v) => port.then(() => v));
        }
        return p;
      };
    }, 1);
  });
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as { __varerLest?: boolean }).__varerLest === true))
    .toBe(true);
  await settData(`${VARER}/b`, { name: "Fra annen klient", cat: "Diverse", ukjent: 1 });
  await page.evaluate(() => (globalThis as { __slippVarer?: () => void }).__slippVarer?.());

  await expect.poll(async () => lesData(`${FAM}/meta/itemsBootstrapped`)).toBe(true);
  expect(await les()).toEqual({ b: { name: "Fra annen klient", cat: "Diverse", ukjent: 1 } });
  expect(feil).toEqual([]);
});

test("bootstrap på tom varebase seeder fra kildene og setter markøren etterpå", async ({
  page,
}) => {
  await settData(FAM, null);
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  await settData(`${FAM}/freezer/f1`, { name: "Laks", batches: [] });
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await expect.poll(async () => lesData(`${FAM}/meta/itemsBootstrapped`)).toBe(true);
  expect(Object.values(await les())).toEqual([{ name: "Laks", cat: "Diverse" }]);
  expect(feil).toEqual([]);
});

test("bootstrap med uventet råverdi i items: urørt og uten ferdigmarkør", async ({ page }) => {
  await settData(FAM, null);
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  await settData(VARER, "rar verdi");
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await expect(page.getByText("Fryser", { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await lesData(VARER)).toBe("rar verdi");
  expect(await lesData(`${FAM}/meta/itemsBootstrapped`)).toBeNull();
  expect(feil).toEqual([]);
});
