import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

// Speiler DAY_FULL i §PlanScreen.tsx — mandag først, samme rekkefølge
// som (new Date().getDay()+6)%7 gir.
const DAY_FULL_MON_FIRST = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

/**
 * Smoke-test for Middagsplan — dekker "kjøkkenets uke" + det aktive
 * middagskortet (Middagsplan v1, §Kontrolltårn-handoff, Issue #20,
 * "Byggehandoff — Middagsplan v1"). Kjøres KUN mot en emulator-drevet
 * build (§playwright.config.ts) — aldri mot preview eller produksjon.
 *
 * Dekker samtidig den konkrete regresjonen §Kontrolltårn-handoff ba om
 * å rette: "＋ Rett" skal vises for ALLE dager, også i dag — ikke bare
 * dager som ikke er i dag (dagens `index.html` sin `!isToday`-vakt).
 *
 * Interaksjonsmodellen er byttet fra inline-redigering-i-dagcellen til
 * `ActiveMealCard` — ett frittstående modal-kort som ALLE dagendrende
 * handlinger nå går via. Dagraden selv (klikk på `[aria-label="<dag>"]`)
 * åpner kortet; den har ingen ✕/bytt-knapper lenger.
 */
test("logger inn, planlegger dagens middag, legger til en ekstra rett og fjerner igjen", async ({
  page,
}) => {
  const now = Date.now();
  const oppskriftA = `E2E-plan-a-${now}`;
  const oppskriftB = `E2E-plan-b-${now}`;
  // Unik per testkjøring — unngår kollisjon med andre spec-filer (§recipes.spec.ts)
  // som oppretter en ingrediens med samme navn i den DELTE varebasen samtidig
  // (fullyParallel), noe som ellers gjør "＋ Opprett"-knappen usynlig for den
  // ene testen når den andre allerede har opprettet varen først.
  const ingrediens = `E2E-plan-ingrediens-${now}`;

  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  // To oppskrifter i kokeboken vi kan planlegge middag med.
  await page.getByRole("link", { name: "Mat" }).click();
  await page.getByRole("link", { name: "Kokebok" }).click();
  for (const [i, navn] of [oppskriftA, oppskriftB].entries()) {
    // Egen ingrediens per oppskrift — ellers finnes den allerede fra
    // forrige loop-runde, og "＋ Opprett"-knappen vises aldri.
    const ingrediensNavn = `${ingrediens}-${i}`;
    await page.getByRole("button", { name: "＋ Legg til" }).click();
    await page.getByPlaceholder("Navn på retten…").fill(navn);
    await page.getByPlaceholder("f.eks. Kjøttdeig").fill(ingrediensNavn);
    await page.getByText(`＋ Opprett «${ingrediensNavn}»`).click();
    await page.getByRole("button", { name: "Diverse" }).click();
    await page.getByRole("button", { name: `Lagre «${navn}»` }).click();
    await expect(page.getByText(navn)).toBeVisible();
  }

  // Gå til Middagsplan og planlegg dagens dato med oppskrift A via det aktive kortet.
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByText("Middagsplan", { exact: true })).toBeVisible();
  await expect(page.getByText("Denne uken")).toBeVisible();

  const todayFull = DAY_FULL_MON_FIRST[(new Date().getDay() + 6) % 7] as string;
  await page.locator(`[aria-label="${todayFull}"]`).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // "I dag" kan allerede være planlagt av en annen spec-fil som kjører
  // samtidig (fullyParallel, samme families/familie1-data) — kortet åpner
  // da i sammendragsvisning i stedet for søket direkte. "Bytt middag"
  // fører til samme søk uansett hvilken tilstand dagen startet i.
  if (await page.getByRole("button", { name: "Bytt middag" }).count()) {
    await page.getByRole("button", { name: "Bytt middag" }).click();
  }
  await page.getByPlaceholder("Søk i kokebok eller biblioteket…").fill(oppskriftA);
  await page.getByText(oppskriftA, { exact: true }).click();
  // Kortet lukker seg selv etter et valg.
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(oppskriftA, { exact: true })).toBeVisible();

  // Åpne kortet igjen — nå i sammendragsvisning — og legg til en ekstra rett.
  await page.locator(`[aria-label="${todayFull}"]`).click();
  await expect(page.getByText(oppskriftA, { exact: true }).last()).toBeVisible();
  const addDishButton = page.getByRole("button", { name: "＋ Rett" });
  await expect(addDishButton).toBeVisible();
  await addDishButton.click();
  await page.getByPlaceholder("Søk etter rett å legge til…").fill(oppskriftB);
  await page.getByText(oppskriftB, { exact: true }).click();
  // "+ Rett" lukker ikke kortet — sammendraget viser nå begge rettene.
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(oppskriftA, { exact: true }).last()).toBeVisible();
  await expect(page.getByText(oppskriftB, { exact: true }).last()).toBeVisible();

  // Fjern den ene retten igjen — dagen kollapser tilbake til én rett.
  await page.getByLabel(`Fjern ${oppskriftB} fra ${todayFull}`).click();
  await expect(page.getByText(oppskriftB, { exact: true })).not.toBeVisible();
  await expect(page.getByText(oppskriftA, { exact: true }).last()).toBeVisible();

  // Fjern hele dagen fra kortet.
  await page.getByRole("button", { name: "Fjern middag" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(oppskriftA, { exact: true })).not.toBeVisible();
});
