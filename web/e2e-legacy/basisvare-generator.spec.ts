/**
 * Legacy-generatorens «Ja, basisvare» (#20, ordre 6939332384). Testene kjører
 * ekte legacy `index.html` mot Firebase-emulatoren med syntetiske data.
 *
 * Før rettingen interpolerte `confirmStaple` navnet rett inn i stien
 * (`staples/${navn.toLowerCase()}`). Ingrediensnavn fra oppskrift/bibliotek er
 * fri tekst, så «Melk/Lett» skrev `staples/melk/lett` og erstattet et
 * eksisterende `melk: true` med et objekt; tegn RTDB ikke tillater i en nøkkel
 * (som `.`) kastet i SDK-en og lot spørsmålet stå fast. Nå gjelder samme
 * én-nøkkel-kontrakt som React (`web/src/domain/shopping/basisvare.ts`):
 * gyldige navn bruker samme nøkkel som før; ugyldige gir en forståelig beskjed
 * uten skriving. Valget om å utelate varen fra handlelisten står i begge
 * tilfeller.
 */
import { type Page, expect, test } from "@playwright/test";
import {
  FAM,
  aapneLegacy,
  lesData,
  lesEksport,
  nyttMedlem,
  rutLegacy,
  settData,
  settRules,
} from "./legacy-harness";

const STAPLES = `${FAM}/staples`;
const SHOPPING = `${FAM}/shopping`;

/** Dagens ukenøkkel og dag slik legacy regner dem (`getWeekKey`, `DAYS`). */
function iDag(): { uke: string; dag: string } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dag = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(d.getDay() + 6) % 7]!;
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  const wn =
    1 + Math.round(((d.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return { uke: `${d.getFullYear()}-W${String(wn).padStart(2, "0")}`, dag };
}

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

/**
 * Familie med dagens middag «Pannekaker» der handlegrunnlaget har `navn`
 * (fri tekst) og «Mel», og en eksisterende basisvare `melk: true`.
 */
async function start(page: Page, navn: string, forventet = 2) {
  await settData(FAM, null);
  const { uke, dag } = iDag();
  await settData(FAM, {
    meta: { itemsBootstrapped: true, mealLibraryBootstrapped: true },
    meals: { [uke]: { [dag]: "Pannekaker" } },
    mealLibrary: {
      pk: {
        name: "Pannekaker",
        shoppingBase: [
          { name: navn, amount: "1", cat: "Meieri" },
          { name: "Mel", amount: "3", cat: "Tørrvarer" },
        ],
      },
    },
    items: { v1: { name: "Laks", cat: "Fisk og sjømat" } },
    staples: { melk: true },
  });
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByRole("button", { name: "Mat", exact: true }).click();
  await page.getByRole("button", { name: /Lag handleliste/ }).click();
  await page.getByRole("button", { name: /Hent ingredienser/ }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(`Legg til ${forventet} varer`) }),
  ).toBeVisible();
  return feil;
}

/** Fjerner varen fra gjennomgangen og svarer «Ja, basisvare». */
async function fjernOgMerk(page: Page, navn: string) {
  await page.getByText(navn, { exact: true }).click();
  await expect(page.getByText(`Har du vanligvis «${navn}» hjemme?`)).toBeVisible();
  await page.getByRole("button", { name: "Ja, basisvare" }).click();
}

const navnPaaListen = async () =>
  Object.values(((await lesData(SHOPPING)) ?? {}) as Record<string, { name?: string }>)
    .map((p) => p.name)
    .sort();

test("gyldig navn: basisvaren lagres under samme nøkkel som før, og varen er utelatt", async ({
  page,
}) => {
  const feil = await start(page, "Rømme");
  await fjernOgMerk(page, "Rømme");

  await expect.poll(() => lesData(STAPLES)).toEqual({ melk: true, rømme: true });
  await expect(page.getByText("Har du vanligvis «Rømme» hjemme?")).toHaveCount(0);
  await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
  await expect.poll(navnPaaListen).toEqual(["Mel"]);
  expect(feil).toEqual([]);
});

test("skråstrek: eksisterende basisvare endres ikke, ingen undernode, forståelig beskjed", async ({
  page,
}) => {
  const feil = await start(page, "Melk/Lett");
  await fjernOgMerk(page, "Melk/Lett");

  await expect(page.getByRole("alert")).toContainText("kan ikke lagres som basisvare");
  await expect(page.getByRole("alert")).toContainText("Ingenting er lagret");
  // Gi en eventuell skriving tid til å nå emulatoren før vi sjekker at ingen kom.
  await page.waitForTimeout(500);
  expect(await lesEksport(STAPLES)).toEqual({ melk: true });

  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Valget om å utelate varen fra handlelisten står.
  await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
  await expect.poll(navnPaaListen).toEqual(["Mel"]);
  expect(await lesEksport(STAPLES)).toEqual({ melk: true });
  expect(feil).toEqual([]);
});

test("punktum (ugyldig RTDB-nøkkel): ingen skriving, ingen sidefeil, spørsmålet kan lukkes", async ({
  page,
}) => {
  const feil = await start(page, "Ca. 2 dl fløte");
  await fjernOgMerk(page, "Ca. 2 dl fløte");

  await expect(page.getByRole("alert")).toContainText("kan ikke lagres som basisvare");
  await page.waitForTimeout(500);
  expect(await lesEksport(STAPLES)).toEqual({ melk: true });
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
  await expect.poll(navnPaaListen).toEqual(["Mel"]);
  expect(feil).toEqual([]);
});

test("basisvare-rad tatt med og så utelatt igjen: spørsmålet har varens navn, og «Ja» skriver samme nøkkel", async ({
  page,
}) => {
  // «Melk» er allerede basisvare og er derfor utelatt som standard.
  const feil = await start(page, "Melk", 1);
  await page.getByRole("button", { name: /BASISVARER/ }).click();
  await page.getByText("Melk", { exact: true }).click();
  await expect(page.getByRole("button", { name: /Legg til 2 varer/ })).toBeVisible();
  await fjernOgMerk(page, "Melk");

  await expect(page.getByText("Har du vanligvis «Melk» hjemme?")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await lesEksport(STAPLES)).toEqual({ melk: true });
  await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
  await expect.poll(navnPaaListen).toEqual(["Mel"]);
  expect(feil).toEqual([]);
});
