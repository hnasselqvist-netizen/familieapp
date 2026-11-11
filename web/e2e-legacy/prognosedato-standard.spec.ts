/**
 * Legacy-H (#59, ordre 6679393283) — legacy `index.html` mot Firebase-
 * emulatoren, syntetiske data. Uten lagret prognosedato (mangler eller
 * tom streng) bruker legacy-dashbordet og legacy-Spillerom samme standard-
 * dato som generatoren (den 20.), merket «standard». En lagret dato, også
 * passert, gjelder. Visning, åpning, Avbryt og OK uten endring skriver
 * ingenting. Kjøres med nettleser i både UTC og Europe/Oslo.
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
const manuell = (id: string, date: string, amount: number) => ({
  id,
  name: `Post ${id}`,
  amount,
  direction: "out",
  date,
  type: "extra",
  kilde: "manuell",
});
const BELOP_4700 = /4[\s\u00a0]700/;

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

async function oppsett(page: Page, liq: Record<string, unknown>, naa: string) {
  await settData(FAM, null);
  await settData(LIQ, liq);
  await page.clock.setFixedTime(new Date(naa));
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Forvaltning", { exact: true }).first().click();
  return feil;
}

const dashbordDato = (page: Page) => page.locator("[data-prognosedato]");

async function tilDetaljer(page: Page) {
  await page.getByText("trykk for detaljer", { exact: true }).click();
  await expect(page.getByText("Frem til:", { exact: true })).toBeVisible();
}

for (const timezoneId of ["UTC", "Europe/Oslo"]) {
  test.describe(`nettleser i ${timezoneId}`, () => {
    test.use({ timezoneId });

    for (const [navn, lagret] of [
      ["mangler", undefined],
      ["tom streng", ""],
    ] as const) {
      test(`prognosedato ${navn}: standard 20. i dashbord og Spillerom, ingen skriving`, async ({
        page,
      }) => {
        const liq: Record<string, unknown> = {
          saldo: 5000,
          posts: {
            a: manuell("a", "2026-11-15", 300), // før standarddatoen: teller
            b: manuell("b", "2026-11-25", 400), // etter: teller ikke
          },
        };
        if (lagret !== undefined) liq.prognosisDate = lagret;
        const feil = await oppsett(page, liq, "2026-11-10T10:00:00+01:00");
        const foer = await lesData(LIQ);

        // Dashbordet: standarddatoen, ikke «i dag» (som ville utelatt post a).
        await expect(dashbordDato(page)).toHaveAttribute("data-prognosedato", "2026-11-20");
        await expect(dashbordDato(page)).toContainText("standard");
        await expect(page.getByText(BELOP_4700).first()).toBeVisible();

        // Spillerom: samme dato og samme tall, rolig merket som ikke lagret.
        await tilDetaljer(page);
        await expect(page.getByText("· standard, ikke lagret")).toBeVisible();
        await expect(page.getByText(BELOP_4700).first()).toBeVisible();

        // Endre → Avbryt (✕) og Endre → OK uten endring skriver ingenting.
        await page.getByRole("button", { name: "Endre" }).click();
        await expect(page.locator('input[type="date"]')).toHaveValue("2026-11-20");
        // ✕ ved siden av OK i datofeltet (Avbryt).
        await page
          .getByRole("button", { name: "OK" })
          .locator("xpath=following-sibling::button[1]")
          .click();
        await page.getByRole("button", { name: "Endre" }).click();
        await page.getByRole("button", { name: "OK" }).click();
        await expect(page.getByText("· standard, ikke lagret")).toBeVisible();

        // Ny post foreslår den effektive datoen; lukkes uten å lagre.
        await page.getByText("＋ Legg til prognosepost").click();
        await expect(page.locator('input[type="date"]').first()).toHaveValue("2026-11-20");
        await page.getByText("✕ Lukk").click();

        expect(await lesData(LIQ)).toEqual(foer);
        expect(feil).toEqual([]);
      });
    }

    test("lagret passert dato gjelder fortsatt, uten standardmerke", async ({ page }) => {
      const feil = await oppsett(
        page,
        { saldo: 5000, prognosisDate: "2026-11-05", posts: { a: manuell("a", "2026-11-15", 300) } },
        "2026-11-10T10:00:00+01:00",
      );
      await expect(dashbordDato(page)).toHaveAttribute("data-prognosedato", "2026-11-05");
      await expect(dashbordDato(page)).not.toContainText("standard");
      await tilDetaljer(page);
      await expect(page.getByText("(passert)")).toBeVisible();
      await expect(page.getByText("· standard, ikke lagret")).toHaveCount(0);
      expect(await lesData(`${LIQ}/prognosisDate`)).toBe("2026-11-05");
      expect(feil).toEqual([]);
    });
  });
}

test.describe("lokal midnatt den 20. (Europe/Oslo)", () => {
  test.use({ timezoneId: "Europe/Oslo" });
  test("00:30 den 20. (19. i UTC): standard er neste måned, som generatoren", async ({ page }) => {
    const feil = await oppsett(page, { saldo: 5000, posts: {} }, "2026-11-20T00:30:00+01:00");
    await expect(dashbordDato(page)).toHaveAttribute("data-prognosedato", "2026-12-20");
    await tilDetaljer(page);
    await expect(page.getByText("· standard, ikke lagret")).toBeVisible();
    expect(await lesData(`${LIQ}/prognosisDate`)).toBeNull();
    expect(feil).toEqual([]);
  });
});
