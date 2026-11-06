/**
 * Oppfylte poster i legacy-dashbordet (#59, ordre 6681658578) — legacy
 * `index.html` mot Firebase-emulatoren, syntetiske data. Forsiden og
 * Spillerom-detaljene regner med samme aktive poster: en betalt (oppfylt)
 * regning trekkes ikke fra igjen. Visning skriver ingenting.
 */
import { type Page, expect, test } from "@playwright/test";
import {
  FAM,
  aapneLegacy,
  lesData,
  nyttMedlem,
  rutLegacy,
  settData,
  settRules,
} from "./legacy-harness";

const LIQ = `${FAM}/liquidity`;
const manuell = (id: string, date: string, amount: number, o: Record<string, unknown> = {}) => ({
  id,
  name: `Post ${id}`,
  amount,
  direction: "out",
  date,
  type: "extra",
  kilde: "manuell",
  ...o,
});
const kr = (tall: string) => new RegExp(tall.replace(" ", "[\\s\\u00a0]"));

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

const spilleromKort = (page: Page) =>
  page.getByText("trykk for detaljer", { exact: true }).locator("xpath=..");
const bundetKort = (page: Page) =>
  page.getByText("trykk for poster", { exact: true }).locator("xpath=..");

for (const timezoneId of ["UTC", "Europe/Oslo"]) {
  test.describe(`nettleser i ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("forside og detaljer: samme spillerom, oppfylt trekkes ikke fra", async ({ page }) => {
      await settData(FAM, null);
      await settData(LIQ, {
        saldo: 10000,
        prognosisDate: "2026-11-30",
        posts: {
          husleie: manuell("husleie", "2026-11-15", 4000, { status: "oppfylt" }),
          strom: manuell("strom", "2026-11-20", 1000),
        },
      });
      await page.clock.setFixedTime(new Date("2026-11-10T10:00:00+01:00"));
      const feil = await aapneLegacy(page, await nyttMedlem());
      await page.getByText("Forvaltning", { exact: true }).first().click();
      const foer = await lesData(LIQ);

      // Forsiden: bare den aktive strømregningen (før: 5 000 og bundet 5 000).
      await expect(spilleromKort(page)).toContainText(kr("9 000"));
      await expect(bundetKort(page)).toContainText(kr("1 000"));

      // Detaljene: samme tall.
      await page.getByText("trykk for detaljer", { exact: true }).click();
      await expect(page.getByText("Frem til:", { exact: true })).toBeVisible();
      await expect(page.getByText(kr("9 000")).first()).toBeVisible();

      // Visning skrev ingenting.
      expect(await lesData(LIQ)).toEqual(foer);

      // Brukeren markerer strømregningen som oppfylt: ingen aktive poster igjen,
      // og forsiden følger detaljene.
      await page
        .getByText("Post strom", { exact: true })
        .locator("xpath=ancestor::*[.//button[@title='Marker som oppfylt']][1]")
        .getByTitle("Marker som oppfylt")
        .click();
      await expect
        .poll(async () => ((await lesData(`${LIQ}/posts/strom`)) as { status?: string }).status)
        .toBe("oppfylt");
      await page.getByRole("button", { name: "← Tilbake" }).click();
      await expect(spilleromKort(page)).toContainText("–");
      await expect(page.getByText("Ingen prognoseposter registrert ennå.")).toBeVisible();
      expect(((await lesData(`${LIQ}/posts/husleie`)) as { status?: string }).status).toBe(
        "oppfylt",
      );
      expect(await lesData(`${LIQ}/saldo`)).toBe(10000);
      expect(feil).toEqual([]);
    });
  });
}
