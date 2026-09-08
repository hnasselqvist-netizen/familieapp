import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

// Speiler DAY_FULL i §days.ts — mandag først, samme rekkefølge som
// (new Date().getDay()+6)%7 gir.
const DAY_FULL_MON_FIRST = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

/**
 * Smoke-test for delt oppskriftsåpning fra Middagsplan → Kokebok — sjette
 * Fase 2-skive. Kjøres KUN mot en emulator-drevet build
 * (§playwright.config.ts) — aldri mot preview eller produksjon.
 *
 * Dekker at "📖"-snarveien i §PlanScreen.tsx faktisk navigerer til
 * `RecipesScreen` sitt `?apne=<recipeId>`-søkeparameter og åpner riktig
 * oppskrifts detaljvisning — ikke bare at knappen finnes.
 */
test("logger inn, planlegger en middag og åpner oppskriften via 📖-snarveien fra Middagsplan", async ({
  page,
}) => {
  const now = Date.now();
  const oppskrift = `E2E-recipeopen-${now}`;
  const ingrediens = `E2E-recipeopen-ingrediens-${now}`;

  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  // Opprett en oppskrift.
  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Kokebok" }).click();
  await page.getByRole("button", { name: "＋ Legg til" }).click();
  await page.getByPlaceholder("Navn på retten…").fill(oppskrift);
  await page.getByPlaceholder("f.eks. Kjøttdeig").fill(ingrediens);
  await page.getByText(`＋ Opprett «${ingrediens}»`).click();
  await page.getByRole("button", { name: "Diverse" }).click();
  await page.getByRole("button", { name: `Lagre «${oppskrift}»` }).click();
  await expect(page.getByText(oppskrift)).toBeVisible();

  // Planlegg dagens dato med denne oppskriften (via kokebok-søk, som gir
  // en konkret recipeId — biblioteksmiddager har ingen oppskrift å åpne).
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByText("Middagsplan", { exact: true })).toBeVisible();
  const todayFull = DAY_FULL_MON_FIRST[(new Date().getDay() + 6) % 7] as string;
  await page.locator(`[aria-label="${todayFull}"]`).click();
  await page.getByPlaceholder("Søk i kokebok eller skriv inn…").fill(oppskrift);
  await page.getByText(oppskrift, { exact: true }).click();
  await expect(page.getByText(oppskrift, { exact: true })).toBeVisible();

  // Åpne oppskriften via "📖"-snarveien og bekreft riktig detaljvisning.
  await page.getByLabel(`Åpne oppskrift for ${todayFull}`).click();
  await expect(page).toHaveURL(/\/mat\/kokebok\?apne=/);
  await expect(page.getByText(ingrediens, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "← Tilbake" })).toBeVisible();
});
