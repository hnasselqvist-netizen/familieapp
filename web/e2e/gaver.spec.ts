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
  // Personraden i registeret (navnet står også i den skjulte årsoversikten).
  await expect(page.locator("strong", { hasText: navn })).toBeVisible();

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

/**
 * Gaver punkt 2 (#20): eksplisitt etterregistrering av en allerede gitt
 * bursdagsgave, helårsoversikten per person og tilbakelesing etter ny
 * innlasting — mot emulatoren, på mobilbredde. Syntetisk navn per kjøring.
 */
test("bursdagsgave registreres eksplisitt og står i årsoversikten etter ny innlasting", async ({
  page,
}) => {
  const aar = new Date().getFullYear();
  const navn = `E2E-bursdag-${Date.now()}`;
  await page.setViewportSize({ width: 375, height: 800 });

  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await page.getByRole("link", { name: "Hjem & familie" }).click();
  await page.getByRole("link", { name: /Gaver og juleplanlegging/ }).click();

  // Personen får sitt eget bursdagsbudsjett (personoverstyring) under «Personer».
  await page.getByRole("button", { name: "Personer" }).click();
  await page.getByRole("button", { name: "Legg til person" }).click();
  const skjema = page.getByRole("form", { name: "Ny person" });
  await skjema.getByLabel("Navn", { exact: true }).fill(navn);
  await skjema.getByLabel("Gruppe").selectOption("venner");
  await skjema.getByLabel("Budsjett for bursdag", { exact: true }).selectOption("belop");
  await skjema.getByLabel("Budsjett for bursdag, beløp i kroner").fill("400");
  await skjema.getByRole("button", { name: "Lagre" }).click();
  await expect(skjema).not.toBeVisible();

  // Ingenting opprettes av å åpne oversikten; registreringen er eksplisitt.
  await page.getByRole("button", { name: `Året ${aar}` }).click();
  const kort = page.getByRole("region", { name: navn });
  await expect(kort.getByText("Bursdag " + aar, { exact: true })).toBeVisible();
  await expect(kort.getByRole("list", { name: `Bursdagsgaver til ${navn}` })).toHaveCount(0);

  await page.getByRole("button", { name: "Registrer gave" }).click();
  const reg = page.getByRole("form", { name: "Registrer gave" });
  await reg.getByLabel("Mottaker").selectOption({ label: navn });
  await reg.getByLabel("Anledning").selectOption("bursdag");
  await reg.getByLabel("Gave", { exact: true }).fill("Skjerf");
  await reg.getByLabel("Beløp (valgfritt)").fill("150");
  await expect(reg.getByLabel("Status")).toHaveValue("gitt");
  // Kjøpt før årsskiftet, men gitt til bursdagen i år: teller i år.
  await reg.getByLabel("Kjøpsdato (valgfritt)").fill(`${aar - 1}-12-28`);
  await reg.getByRole("button", { name: "Lagre" }).click();
  await expect(page.getByRole("status")).toHaveText(
    `Registrert: Skjerf til ${navn} (Bursdag ${aar}).`,
  );

  const sjekk = async () => {
    const k = page.getByRole("region", { name: navn });
    const tall = (dt: string) =>
      k.locator("dt", { hasText: dt }).locator("xpath=following-sibling::dd");
    await expect(tall(`Bursdag ${aar}`)).toHaveText("150 krav 400 kr");
    await expect(tall("Samlet gaveverdi")).toHaveText(/^150 kr/);
    await expect(k.getByRole("list", { name: `Bursdagsgaver til ${navn}` })).toContainText(
      `Beløp 150 kr · kjøpsdato 28.12.${aar - 1}`,
    );
    await expect(k.getByLabel("Status for Skjerf")).toHaveValue("gitt");
  };
  await sjekk();

  // Ny innlasting: lagret, ikke bare vist.
  await page.reload();
  await page.getByRole("button", { name: `Året ${aar}` }).click();
  await sjekk();

  // Mobilbredde: ingen vannrett rulling.
  const flyter = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(flyter).toBe(false);
  await page.screenshot({ path: "test-results/gaver-aaret-375.png", fullPage: true });
});
