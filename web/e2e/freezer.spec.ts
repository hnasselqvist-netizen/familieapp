import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Smoke-test for hele den nye grunnmuren: innlogging → navigasjon →
 * Fryser, som er første ekte vertikale skive. Kjøres KUN mot en
 * emulator-drevet build (§playwright.config.ts) — aldri mot preview
 * eller produksjon.
 */
test("logger inn og legger en vare i fryseren", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await page.getByRole("link", { name: "Mat" }).click();
  // "Mat" lander nå på Middagsplan (§Kontrolltårn-handoff, Issue #20,
  // "hovedløft" — "/mat" skal lande på "/mat/plan", ikke lenger
  // "/mat/fryser"), så Fryser-fanen må velges eksplisitt.
  await page.getByRole("link", { name: "Fryser" }).click();
  // Ikke "Fryser" alene (eksakt) — den teksten finnes både i fanebaren
  // (§MatLayout) og i skjermens egen tittel samtidig, som gjør et eksakt
  // tekst-søk tvetydig (strict mode violation). Tomt-tilstanden er unik.
  await expect(page.getByText("Fryseren er tom")).toBeVisible();

  // Rask registrering skjer nå i en modal, åpnet fra headerhandlingen
  // (§Kontrolltårn-review, PR #26, §8: "rask registrering i varm
  // modal/arbeidsflate") — var tidligere en alltid-synlig `Card`.
  await page.getByRole("button", { name: "＋ Legg til" }).click();

  const varenavn = `E2E-test-vare-${Date.now()}`;
  const varenavnFelt = page.getByPlaceholder("f.eks. Karbonadedeig");
  await varenavnFelt.fill(varenavn);
  await page.getByText(`＋ Opprett «${varenavn}»`).click();
  await page.getByRole("button", { name: "Diverse" }).click();
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();

  // Vent til modalen er lukket (submit() er ferdig, inkludert
  // Firebase-transaksjonen) FØR vi sjekker listen — ellers kan
  // forhåndsvisningsteksten i skjemaet ("Lagres som: <varenavn>") og den
  // nye posten i listen begge matche samme tekst samtidig, et snevert
  // tidsvindu som gjorde denne testen flaky i CI.
  await expect(page.getByRole("dialog", { name: "Legg til i fryseren" })).not.toBeVisible();
  await expect(page.getByText(varenavn)).toBeVisible();
});
