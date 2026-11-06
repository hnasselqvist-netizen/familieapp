/**
 * Samtidige Spillerom-endringer i legacy (#59, ordre 6675906923) — legacy
 * `index.html` mot Firebase-emulatoren, syntetiske data. Legacy kobles fra
 * (`goOffline`), «den andre enheten» (emulator-REST) skriver, og legacy
 * markerer en post som oppfylt. Ved gjenoppkobling kjøres legacy sin
 * `setLiquidity` som transaksjon på fersk serververdi: den andre enhetens
 * oppretting, endring, sletting og saldo bevares, og legacy sin endring
 * kommer i tillegg.
 *
 * Redigering (#118, R1): det ekte legacy-skjemaet lagrer bare felt brukeren
 * endret, med grunnlag. Ulike felt fra to enheter bevares, samme felt gir
 * synlig konflikt med utkastet intakt, en slettet post gjenoppstår ikke, og
 * et sent svar lukker ikke en ny dialog.
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

const LIQ = `${FAM}/liquidity`;
const manuell = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  name: `Post ${id}`,
  amount: 100,
  direction: "out",
  date: "2026-11-25",
  type: "extra",
  kilde: "manuell",
  ...o,
});

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

const navnFelt = (page: Page) =>
  page.getByText("Navn", { exact: true }).last().locator("xpath=following-sibling::input");
const belopFelt = (page: Page) =>
  page.getByText("Belop", { exact: true }).locator("xpath=following-sibling::input");
const lagreKnapp = (page: Page) => page.getByRole("button", { name: /^(Lagre|Lagrer…)$/ });

type Post = { name?: string; amount?: number; manueltOverstyrt?: boolean } | null;
const lesPost = async (id: string) => (await lesData(`${LIQ}/posts/${id}`)) as Post;

async function startRedigering(page: Page) {
  await settData(FAM, null);
  await settData(LIQ, {
    saldo: 5000,
    prognosisDate: "2026-11-30",
    posts: { m1: manuell("m1"), m2: manuell("m2") },
  });
  await page.clock.setFixedTime(new Date("2026-11-10T10:00:00+01:00"));
  const feil = await aapneLegacy(page, await nyttMedlem());
  await tilSpillerom(page);
  await page.getByText("Post m1", { exact: true }).click();
  await expect(navnFelt(page)).toHaveValue("Post m1");
  await legacyNett(page, "goOffline");
  return feil;
}

async function tilSpillerom(page: Page) {
  await page.getByText("Forvaltning", { exact: true }).first().click();
  await page.getByText("Spillerom", { exact: true }).first().click();
  await expect(page.getByText("Post m1", { exact: true })).toBeVisible();
}

test("oppfylt i legacy mens den andre enheten endrer liquidity: ingenting går tapt", async ({
  page,
}) => {
  await settData(FAM, null);
  await settData(LIQ, {
    saldo: 5000,
    prognosisDate: "2026-11-30",
    posts: { m1: manuell("m1"), m2: manuell("m2"), m3: manuell("m3") },
  });
  await page.clock.setFixedTime(new Date("2026-11-10T10:00:00+01:00"));
  const bruker = await nyttMedlem();
  const feil = await aapneLegacy(page, bruker);
  await tilSpillerom(page);

  await legacyNett(page, "goOffline");
  // Den andre enheten:
  await settData(`${LIQ}/posts/ny`, manuell("ny", { name: "Ny fra B" }));
  await settData(`${LIQ}/posts/m2/amount`, 777);
  await settData(`${LIQ}/posts/m3`, null);
  await settData(`${LIQ}/saldo`, 6000);
  // Legacy markerer m1 oppfylt fra sitt gamle bilde.
  await page
    .getByText("Post m1", { exact: true })
    .locator("xpath=ancestor::*[.//button[@title='Marker som oppfylt']][1]")
    .getByTitle("Marker som oppfylt")
    .click();
  await legacyNett(page, "goOnline");

  await expect
    .poll(async () => ((await lesData(`${LIQ}/posts/m1`)) as { status?: string } | null)?.status)
    .toBe("oppfylt");
  const liq = (await lesData(LIQ)) as {
    saldo: number;
    posts: Record<string, { name: string; amount: number }>;
  };
  expect(liq.posts.ny?.name).toBe("Ny fra B");
  expect(liq.posts.m2?.amount).toBe(777);
  expect(liq.posts.m3).toBeUndefined();
  expect(liq.saldo).toBe(6000);
  expect(feil).toEqual([]);
});

test("redigering: A endrer navn, B endrer beløp — begge bevares", async ({ page }) => {
  const feil = await startRedigering(page);
  await settData(`${LIQ}/posts/m1/amount`, 777); // den andre enheten
  await navnFelt(page).fill("Nytt navn");
  await lagreKnapp(page).click();
  // Dialogen venter på bekreftet resultat (frakoblet: ingen falsk kvittering).
  await expect(lagreKnapp(page)).toHaveText("Lagrer…");
  await expect(navnFelt(page)).toBeVisible();
  await legacyNett(page, "goOnline");
  await expect(navnFelt(page)).toBeHidden();
  const m1 = await lesPost("m1");
  expect(m1?.name).toBe("Nytt navn");
  expect(m1?.amount).toBe(777);
  expect(m1?.manueltOverstyrt).toBeUndefined(); // manuell post: feltet legges ikke på
  expect(feil).toEqual([]);
});

test("redigering: samme felt endret av begge gir synlig konflikt, utkastet står", async ({
  page,
}) => {
  const feil = await startRedigering(page);
  await settData(`${LIQ}/posts/m1/amount`, 777);
  await belopFelt(page).fill("150");
  await lagreKnapp(page).click();
  await legacyNett(page, "goOnline");
  await expect(page.getByRole("alert")).toContainText("endret på en annen enhet");
  await expect(belopFelt(page)).toHaveValue("150");
  await expect(lagreKnapp(page)).toHaveText("Lagre");
  expect((await lesPost("m1"))?.amount).toBe(777);
  expect(feil).toEqual([]);
});

test("redigering: slettet post gjenoppstår ikke, avvisningen beholder utkastet", async ({
  page,
}) => {
  const feil = await startRedigering(page);
  await settData(`${LIQ}/posts/m1`, null);
  await navnFelt(page).fill("Nytt navn");
  await lagreKnapp(page).click();
  await legacyNett(page, "goOnline");
  await expect(page.getByRole("alert")).toContainText("finnes ikke lenger");
  await expect(navnFelt(page)).toHaveValue("Nytt navn");
  expect(await lesPost("m1")).toBeNull();
  expect((await lesPost("m2"))?.name).toBe("Post m2");
  expect(feil).toEqual([]);
});

test("redigering: sent svar etter lukking lukker ikke en ny dialog", async ({ page }) => {
  const feil = await startRedigering(page);
  await navnFelt(page).fill("Første");
  await lagreKnapp(page).click();
  await page.getByRole("button", { name: "Avbryt" }).click();
  await page.getByText("Post m2", { exact: true }).click();
  await belopFelt(page).fill("321");
  await legacyNett(page, "goOnline");
  await expect.poll(async () => (await lesPost("m1"))?.name).toBe("Første");
  await expect(belopFelt(page)).toHaveValue("321");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await lesPost("m2"))?.amount).toBe(100);
  expect(feil).toEqual([]);
});
