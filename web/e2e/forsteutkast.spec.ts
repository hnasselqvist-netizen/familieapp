import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Smoke-test for Førsteutkast/variasjon/lettvint (§ForsteutkastPanel) —
 * syvende Fase 2-/produktintegrasjons-skive. Kjøres KUN mot en
 * emulator-drevet build (§playwright.config.ts) — aldri mot preview
 * eller produksjon.
 *
 * Merker ALLE ledige dager i perioden som lettvint-krevende (ikke bare
 * "i dag") — flere andre spec-filer planlegger "i dag" uten å rydde
 * opp etterpå, så testen kan ikke anta at akkurat den dagen er ledig.
 * Siden testens egen biblioteksmiddag er den ENESTE `lettvint:true`-
 * merkede i hele biblioteket, er den det eneste kandidatvalget uansett
 * hvilken(e) ledig(e) dag(er) som faktisk finnes ved kjøretidspunktet.
 */
test("logger inn, merker en middag som lettvint, genererer et førsteutkast og godkjenner planen", async ({
  page,
}) => {
  const now = Date.now();
  const middagsnavn = `E2E-forsteutkast-${now}`;

  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  // Opprett en biblioteksmiddag og merk den som lettvint.
  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Bibliotek" }).click();
  const middagFelt = page.getByPlaceholder("f.eks. Kyllingsuppe");
  await middagFelt.fill(middagsnavn);
  await page.getByRole("button", { name: "Legg til" }).click();
  await expect(middagFelt).toHaveValue("");
  await page.getByText(middagsnavn, { exact: true }).click();
  await page.getByLabel("🍃 Lettvint middag").check();
  await page.getByLabel("Lukk").click();

  // Åpne Førsteutkast og merk alle ledige dager som lettvint-krevende.
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByText("Middagsplan", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "✨ Foreslå middager" }).click();
  await expect(page.getByText(/^Førsteutkast/)).toBeVisible();

  const lettvintCheckbokser = page.getByRole("checkbox");
  const antall = await lettvintCheckbokser.count();
  for (let i = 0; i < antall; i++) {
    await lettvintCheckbokser.nth(i).check();
  }

  await page.getByRole("button", { name: "Generer forslag →" }).click();

  // Testens middag er den eneste lettvint-kvalifiserte i biblioteket —
  // den skal derfor faktisk dukke opp i gjennomgangslisten. IKKE exact:true
  // her — navnet deler DOM-tekstnode med "✨ "-prefikset (§ForsteutkastPanel
  // sin reviewName-span), ulikt Middagsplanens egen, prefiksfrie visning.
  await expect(page.getByText(middagsnavn).first()).toBeVisible();

  await page.getByRole("button", { name: "Bruk denne planen" }).click();

  // Planen skal nå faktisk være skrevet til Firebase — middagen dukker
  // opp i selve dag-rutenettet, ikke bare i draft-visningen.
  await expect(page.getByText(middagsnavn, { exact: true }).first()).toBeVisible();

  // Rydder opp: Førsteutkast kan (i motsetning til andre spec-filer som
  // kun planlegger "i dag") ha skrevet til FLERE dager samtidig — la dem
  // stå ville kollidert med andre spec-filers antakelse om at "＋ Rett"
  // kun finnes på nøyaktig én dag (§plan.spec.ts). Fjerning skjer nå via
  // det aktive kortet (Middagsplan v1, §ActiveMealCard) — ingen ✕ direkte
  // på dagraden lenger.
  const alleDager = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
  for (const dagFull of alleDager) {
    const dagkort = page.locator(`[aria-label="${dagFull}"]`);
    if ((await dagkort.getByText(middagsnavn, { exact: true }).count()) > 0) {
      await dagkort.click();
      await page.getByRole("button", { name: "Fjern middag" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
    }
  }
});
