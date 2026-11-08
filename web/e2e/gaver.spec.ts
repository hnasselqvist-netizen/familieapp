import { expect, test } from "@playwright/test";
import { E2E_USER } from "./seed-config.mjs";

/**
 * Gaver (S1 julegaver), hele flyten mot emulatoren — aldri mot preview
 * eller produksjon: person → start årets jul → idé → kjøpt → last inn på
 * nytt. Kontrollerer også at siden ikke gir vannrett rulling på mobil.
 * Syntetisk navn per kjøring.
 */
test("person, juleplan, idé og kjøpt står seg etter ny innlasting", async ({ page }) => {
  const aar = new Date().getFullYear();
  const navn = `E2E-mottaker-${Date.now()}`;

  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();

  await page.getByRole("link", { name: "Hjem & familie" }).click();
  await page.getByRole("link", { name: /Gaver og juleplanlegging/ }).click();
  await expect(page.getByRole("heading", { name: "Gaver" })).toBeVisible();

  // Personregister: ny person med tastaturet.
  await page.getByRole("button", { name: "Personer" }).click();
  await page.getByRole("button", { name: "Legg til person" }).click();
  const skjema = page.getByRole("form", { name: "Ny person" });
  await skjema.getByLabel("Navn").fill(navn);
  await skjema.getByLabel("Gruppe").selectOption("naer");
  await skjema.getByRole("button", { name: "Lagre" }).click();
  await expect(skjema).not.toBeVisible();
  await expect(page.getByText(navn)).toBeVisible();

  // Løpende idé fra registeret, uten anledning (review 5731352564 P2).
  await page.getByRole("button", { name: `Ideer for ${navn} (0)` }).click();
  const ideer = page.getByRole("region", { name: `Løpende ideer for ${navn}` });
  await ideer.getByRole("button", { name: `Ny idé til ${navn}` }).click();
  const ideSkjema = ideer.getByRole("form", { name: "Ny idé eller gave" });
  await ideSkjema.getByLabel("Idé eller gave").fill("Puslespill");
  await ideSkjema.getByRole("button", { name: "Lagre" }).click();
  await expect(ideSkjema).not.toBeVisible();
  await expect(page.getByRole("button", { name: `Ideer for ${navn} (1)` })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Personer" }).click();
  await expect(page.getByRole("button", { name: `Ideer for ${navn} (1)` })).toBeVisible();

  // Årets jul: startes eksplisitt (eller finnes fra en tidligere kjøring,
  // og da legges personen til fra «Legg til mottakere»).
  await page.getByRole("button", { name: `Jul ${aar}` }).click();
  const start = page.getByRole("button", { name: `Start juleplanlegging ${aar}` });
  if (await start.isVisible()) {
    await start.click();
  } else {
    await page.getByRole("button", { name: `Legg til ${navn}` }).click();
  }
  const kort = page.getByRole("region", { name: navn });
  await expect(kort).toBeVisible();
  await expect(kort.getByText("Mangler gave")).toBeVisible();

  // Den løpende ideen brukes eksplisitt til jul.
  await kort.getByText("Løpende ideer (1)").click();
  await kort.getByRole("button", { name: `Bruk til Jul ${aar}` }).click();
  await expect(kort.getByRole("list", { name: `Ideer og gaver til ${navn}` })).toContainText(
    "Puslespill",
  );
  await expect(kort.getByText("Løpende ideer (1)")).not.toBeVisible();

  // Idé → kjøpt.
  await kort.getByRole("button", { name: "Legg til idé eller gave" }).click();
  const gaveSkjema = kort.getByRole("form", { name: "Ny idé eller gave" });
  await gaveSkjema.getByLabel("Idé eller gave").fill("Ullsokker");
  await gaveSkjema.getByLabel("Planlagt beløp (valgfritt)").fill("250");
  await gaveSkjema.getByRole("button", { name: "Lagre" }).click();
  await expect(gaveSkjema).not.toBeVisible();
  // En idé teller ikke som kjøpt.
  await expect(kort.getByText("Mangler gave")).toBeVisible();
  await kort.getByLabel("Status for Ullsokker").selectOption("kjopt");
  await expect(kort.getByText("Ferdig")).toBeVisible();

  // Ny innlasting: alt er lagret, ikke bare vist.
  await page.reload();
  await page.getByRole("button", { name: `Jul ${aar}` }).click();
  const etter = page.getByRole("region", { name: navn });
  await expect(etter.getByText("Ferdig")).toBeVisible();
  await expect(etter.getByLabel("Status for Ullsokker")).toHaveValue("kjopt");
  await expect(etter.getByText("Planlagt 250 kr", { exact: true })).toBeVisible();
  await expect(etter.getByRole("list", { name: `Ideer og gaver til ${navn}` })).toContainText(
    "Puslespill",
  );

  // Mobilbredde: ingen vannrett rulling.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(etter).toBeVisible();
  const flyter = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(flyter).toBe(false);
  // Kortet står under personens gruppe i registeret (roadmap Gaver punkt 4).
  await expect(
    page.getByRole("region", { name: /^Nærmeste familie/ }).getByRole("region", { name: navn }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/gaver-jul-gruppert-375.png", fullPage: true });
});
