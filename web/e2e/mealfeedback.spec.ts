import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

// Speiler DAY_FULL i §PlanScreen.tsx — mandag først, samme rekkefølge
// som (new Date().getDay()+6)%7 gir.
const DAY_FULL_MON_FIRST = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

/**
 * Smoke-test for måltidsavvik/feedback (§MealFeedbackModal) — åttende
 * Fase 2-/produktintegrasjons-skive. Kjøres KUN mot en emulator-drevet
 * build (§playwright.config.ts) — aldri mot preview eller produksjon.
 *
 * Planlegger FORRIGE ukes mandag (garantert passert, uansett hvilken
 * ukedag testen selv kjøres på) — andre spec-filer planlegger kun "i
 * dag", så en tidligere uke kolliderer aldri med dem.
 */
test("logger inn, registrerer tilbakemelding på en passert dag, og nullstiller den igjen", async ({
  page,
}) => {
  const now = Date.now();
  const middagsnavn = `E2E-feedback-${now}`;
  const kommentar = `Familien likte den, gjenta! ${now}`;

  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByText("Middagsplan", { exact: true })).toBeVisible();

  // Forrige uke er garantert passert i sin helhet.
  await page.getByRole("button", { name: "‹" }).click();

  const dagFull = DAY_FULL_MON_FIRST[0] as string; // Mandag
  await page.locator(`[aria-label="${dagFull}"]`).click();
  await page.getByPlaceholder("Søk i kokebok eller biblioteket…").fill(middagsnavn);
  await page.getByText(`Bruk «${middagsnavn}»`).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(middagsnavn, { exact: true })).toBeVisible();

  // 💬-knappen skal nå være synlig — dagen er passert og har en middag.
  const feedbackButton = page.getByLabel(`Tilbakemelding for ${dagFull}`);
  await expect(feedbackButton).toBeVisible();
  await feedbackButton.click();

  await expect(page.getByText(/^Tilbakemelding/)).toBeVisible();
  // Navnet finnes nå BÅDE i dagkortet bak og i modalens "Planlagt:"-rad —
  // `.last()` treffer modalens, som ligger sist i DOM-rekkefølgen.
  await expect(page.getByText(middagsnavn, { exact: true }).last()).toBeVisible();
  // Ingen "Nullstill"-knapp ennå — ingen feedback registrert fra før.
  await expect(page.getByRole("button", { name: "Nullstill" })).not.toBeVisible();

  await page.getByLabel("👍 Ønskes igjen").check();
  await page
    .getByPlaceholder("Kommentar — vises neste gang middagen velges, før shopping…")
    .fill(kommentar);
  await page.getByRole("button", { name: "Lagre" }).click();

  // Modalen skal lukkes automatisk etter lagring.
  await expect(page.getByText(/^Tilbakemelding/)).not.toBeVisible();

  // Åpne igjen og verifiser at det lagrede faktisk ble persistert.
  await feedbackButton.click();
  await expect(page.getByLabel("👍 Ønskes igjen")).toBeChecked();
  await expect(
    page.getByPlaceholder("Kommentar — vises neste gang middagen velges, før shopping…"),
  ).toHaveValue(kommentar);
  const resetButton = page.getByRole("button", { name: "Nullstill" });
  await expect(resetButton).toBeVisible();

  // Nullstill — dagen faller tilbake til "ingen registrert feedback".
  await resetButton.click();
  await expect(page.getByText(/^Tilbakemelding/)).not.toBeVisible();

  await feedbackButton.click();
  await expect(page.getByLabel("👍 Ønskes igjen")).not.toBeChecked();
  await expect(
    page.getByPlaceholder("Kommentar — vises neste gang middagen velges, før shopping…"),
  ).toHaveValue("");
  await expect(page.getByRole("button", { name: "Nullstill" })).not.toBeVisible();
  await page.getByRole("button", { name: "Avbryt" }).click();

  // Rydder opp: fjerner selve middagen fra forrige ukes mandag, via det
  // aktive kortet (Middagsplan v1) — ingen ✕ direkte på dagraden lenger.
  await page.locator(`[aria-label="${dagFull}"]`).click();
  await page.getByRole("button", { name: "Fjern middag" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(middagsnavn, { exact: true })).not.toBeVisible();
});
