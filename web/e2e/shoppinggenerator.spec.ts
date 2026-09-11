import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

// Speiler DAY_FULL i §days.ts — mandag først, samme rekkefølge som
// (new Date().getDay()+6)%7 gir.
const DAY_FULL_MON_FIRST = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

/**
 * Smoke-test for Handlelistegenerator-skjermen (§ShoppingGeneratorModal) —
 * femte Fase 2-skjerm/skive, kalt fra Middagsplan sin "🛒 Lag
 * handleliste"-knapp. Kjøres KUN mot en emulator-drevet build
 * (§playwright.config.ts) — aldri mot preview eller produksjon.
 *
 * Dekker den nye skrivestien (`addBatchToShoppingList`,
 * §data/shopping.repository.ts) ende-til-ende: en planlagt middags
 * ingrediens skal faktisk havne i den persisterte handlelisten, ikke
 * bare i generatorens gjennomgangsvisning.
 */
test("logger inn, lager en middag, genererer handleliste fra den og finner varen i Handleliste", async ({
  page,
}) => {
  const now = Date.now();
  const oppskrift = `E2E-generator-middag-${now}`;
  const ingrediens = `E2E-generator-ingrediens-${now}`;

  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  // Opprett en oppskrift med en unik ingrediens.
  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Kokebok" }).click();
  await page.getByRole("button", { name: "＋ Legg til" }).click();
  await page.getByPlaceholder("Navn på retten…").fill(oppskrift);
  await page.getByPlaceholder("f.eks. Kjøttdeig").fill(ingrediens);
  await page.getByText(`＋ Opprett «${ingrediens}»`).click();
  await page.getByRole("button", { name: "Diverse" }).click();
  await page.getByRole("button", { name: `Lagre «${oppskrift}»` }).click();
  await expect(page.getByText(oppskrift)).toBeVisible();

  // Planlegg dagens dato med denne oppskriften.
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByText("Middagsplan", { exact: true })).toBeVisible();
  const todayFull = DAY_FULL_MON_FIRST[(new Date().getDay() + 6) % 7] as string;
  await page.locator(`[aria-label="${todayFull}"]`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // "I dag" kan allerede være planlagt av en annen spec-fil som kjører
  // samtidig (fullyParallel, samme families/familie1-data) — kortet åpner
  // da i sammendragsvisning i stedet for søket direkte (§plan.spec.ts).
  if (await page.getByRole("button", { name: "Bytt middag" }).count()) {
    await page.getByRole("button", { name: "Bytt middag" }).click();
  }
  await page.getByPlaceholder("Søk i kokebok eller biblioteket…").fill(oppskrift);
  await page.getByText(oppskrift, { exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(oppskrift, { exact: true })).toBeVisible();

  // Åpne handlelistegeneratoren, hent ingredienser og legg til listen.
  await page.getByRole("button", { name: "🛒 Lag handleliste" }).click();
  await expect(page.getByText("Velg hvilke middager du vil handle for.")).toBeVisible();
  await page.getByRole("button", { name: /Hent ingredienser/ }).click();

  await expect(page.getByText(ingrediens, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Legg til \d+ varer/ }).click();

  // Handlelisten skal nå faktisk inneholde varen — dekker skrivestien
  // (addBatchToShoppingList), ikke bare generatorens egen visning.
  await page.getByRole("link", { name: "Handle" }).click();
  await expect(page.getByText(ingrediens, { exact: true })).toBeVisible();
});
