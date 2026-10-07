import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

// Speiler DAYS i §types/meal.ts — mandag først, samme rekkefølge som
// (new Date().getDay()+6)%7 gir.
const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

/**
 * Gangen som dagens ene inngang (#59, retning 1): lenkene fra Gangen åpner
 * beslutningen direkte og viser veien tilbake. Sjekker bare det som er
 * sant uansett hva de andre spesifikasjonene har skrevet til den delte
 * emulator-databasen (§gangen.spec.ts).
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByText("Det viktigste for deg nå")).toBeVisible();
});

test("middagslenken åpner dagens middagskort, og Gangen-lenken fører tilbake", async ({ page }) => {
  const idx = (new Date().getDay() + 6) % 7;
  await page.goto(`/mat/plan?dag=${DAY_KEYS[idx]}&fra=gangen`);

  await expect(page.getByRole("dialog", { name: DAY_FULL[idx] })).toBeVisible();
  await page
    .getByRole("dialog", { name: DAY_FULL[idx] })
    .getByRole("button", { name: "Lukk" })
    .click();

  await page
    .getByRole("link", { name: /Gangen/ })
    .first()
    .click();
  await expect(page.getByText("Det viktigste for deg nå")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("transaksjonskøen fra Gangen viser ferdig-kortet når ingenting venter", async ({ page }) => {
  await page.goto("/forvaltning/transaksjoner?ko=vurdering&fra=gangen");
  await expect(page.getByRole("status").filter({ hasText: "Alt er vurdert." })).toBeVisible();
  await page.getByRole("link", { name: "Tilbake til Gangen" }).click();
  await expect(page.getByText("Det viktigste for deg nå")).toBeVisible();
});
