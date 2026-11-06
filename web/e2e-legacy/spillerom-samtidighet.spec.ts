/**
 * Samtidige Spillerom-endringer i legacy (#59, ordre 6675906923) — legacy
 * `index.html` mot Firebase-emulatoren, syntetiske data. Legacy kobles fra
 * (`goOffline`), «den andre enheten» (emulator-REST) skriver, og legacy
 * markerer en post som oppfylt. Ved gjenoppkobling kjøres legacy sin
 * `setLiquidity` som transaksjon på fersk serververdi: den andre enhetens
 * oppretting, endring, sletting og saldo bevares, og legacy sin endring
 * kommer i tillegg.
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
