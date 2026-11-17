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
async function start(
  page: Page,
  navn: string,
  forventet = 2,
  staples: Record<string, unknown> = { melk: true },
) {
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
    staples,
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

// ── Versjonsbetinget merking (#20, ordre 6958807274) ──────────────────────
// Før rettingen skrev «Ja, basisvare» et ubetinget `set(true)` på den
// validerte nøkkelen: en eksisterende råverdi eller en `true` med prioritet
// ble overskrevet. Nå leses nøkkelen med ETag (REST, eksportform), og `true`
// opprettes med `if-match` bare ved faktisk fravær.

/** Basisvare-rad (utelatt som standard): ta med og utelat igjen for å få spørsmålet. */
async function sporOmBasisvareRad(page: Page, navn: string) {
  await page.getByRole("button", { name: /BASISVARER/ }).click();
  await page.getByText(navn, { exact: true }).click();
  await expect(page.getByRole("button", { name: /Legg til 2 varer/ })).toBeVisible();
  await fjernOgMerk(page, navn);
}
/** Teller REST-skrivinger mot `staples` fra siden (betinget PUT). */
function tellStaplesPut(page: Page) {
  const kall: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && /\/staples\/[^/]+\.json/.test(r.url())) kall.push(r.url());
  });
  return kall;
}

test("eksisterende `true` med prioritet: allerede merket, ingen skriving, prioriteten står", async ({
  page,
}) => {
  const foer = { melk: true, salt: { ".value": true, ".priority": 3 } };
  const feil = await start(page, "Salt", 1, foer);
  const puts = tellStaplesPut(page);
  await sporOmBasisvareRad(page, "Salt");
  await expect(page.getByText("Har du vanligvis «Salt» hjemme?")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await lesEksport(STAPLES)).toEqual(foer);
  expect(puts).toHaveLength(0);
  await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
  await expect.poll(navnPaaListen).toEqual(["Mel"]);
  expect(feil).toEqual([]);
});

test("ukjent råverdi: konflikt vises, råverdien står, varen er utelatt", async ({ page }) => {
  const foer = { melk: true, rømme: { ukjent: "råfelt" } };
  const feil = await start(page, "Rømme", 1, foer);
  await sporOmBasisvareRad(page, "Rømme");
  await expect(page.getByRole("alert")).toContainText(
    "«Rømme» har allerede en annen verdi i basisvarene og er ikke endret.",
  );
  await expect(page.getByRole("alert")).toContainText("fortsatt utelatt");
  expect(await lesEksport(STAPLES)).toEqual(foer);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
  await expect.poll(navnPaaListen).toEqual(["Mel"]);
  expect(await lesEksport(STAPLES)).toEqual(foer);
  expect(feil).toEqual([]);
});

test("samtidig klient oppretter en verdi MELLOM lesing og skriving: if-match avviser, B sin verdi står", async ({
  page,
}) => {
  const feil = await start(page, "Rømme");
  let opprettet = false;
  // B oppretter verdien etter A sin lesing, rett før A sin betingede skriving.
  await page.route(/\/staples\/[^/]+\.json/, async (route) => {
    if (!opprettet && route.request().method() === "PUT") {
      opprettet = true;
      await settData(`${STAPLES}/rømme`, { ukjent: "fra B" });
    }
    return route.fallback();
  });
  await fjernOgMerk(page, "Rømme");
  await expect(page.getByRole("alert")).toContainText("har allerede en annen verdi");
  expect(opprettet).toBe(true);
  expect(await lesEksport(STAPLES)).toEqual({ melk: true, rømme: { ukjent: "fra B" } });
  expect(feil).toEqual([]);
});

test("avvist lagring: tydelig avvisning, ingenting lagret, trygt nytt forsøk", async ({ page }) => {
  const feil = await start(page, "Rømme");
  let avvis = true;
  await page.route(/\/staples\/[^/]+\.json/, async (route) => {
    if (avvis && route.request().method() === "PUT") {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"Permission denied"}',
      });
    }
    return route.fallback();
  });
  await fjernOgMerk(page, "Rømme");
  await expect(page.getByRole("alert")).toContainText("ble avvist");
  await expect(page.getByRole("alert")).toContainText("Ingenting er lagret");
  expect(await lesEksport(STAPLES)).toEqual({ melk: true });
  avvis = false;
  await page.getByRole("button", { name: "Prøv igjen", exact: true }).click();
  await expect(page.getByText("Har du vanligvis «Rømme» hjemme?")).toHaveCount(0);
  await expect.poll(() => lesEksport(STAPLES)).toEqual({ melk: true, rømme: true });
  expect(feil).toEqual([]);
});

test("uteblitt svar på skrivingen: uavklart, ikke rapportert som lagret; nytt forsøk gir «allerede»", async ({
  page,
}) => {
  const feil = await start(page, "Rømme");
  let mist = true;
  // Serveren committer (her gjort av testen), men svaret når aldri siden.
  await page.route(/\/staples\/[^/]+\.json/, async (route) => {
    if (mist && route.request().method() === "PUT") {
      mist = false;
      await settData(`${STAPLES}/rømme`, true);
      return route.abort("failed");
    }
    return route.fallback();
  });
  await fjernOgMerk(page, "Rømme");
  await expect(page.getByRole("alert")).toContainText("Fikk ikke bekreftet");
  await expect(page.getByRole("alert")).not.toContainText("Ingenting er lagret");
  expect(await lesEksport(STAPLES)).toEqual({ melk: true, rømme: true });
  const puts = tellStaplesPut(page);
  await page.getByRole("button", { name: "Prøv igjen", exact: true }).click();
  await expect(page.getByText("Har du vanligvis «Rømme» hjemme?")).toHaveCount(0);
  expect(puts).toHaveLength(0);
  expect(feil).toEqual([]);
});

test("dobbeltklikk på «Ja, basisvare» skriver én gang; knappene er sperret mens det lagres", async ({
  page,
}) => {
  const feil = await start(page, "Rømme");
  let slipp: () => void = () => {};
  const port = new Promise<void>((r) => (slipp = r));
  await page.route(/\/staples\/[^/]+\.json/, async (route) => {
    if (route.request().method() === "PUT") await port;
    return route.fallback();
  });
  const puts = tellStaplesPut(page);
  await page.getByText("Rømme", { exact: true }).click();
  await page.getByRole("button", { name: "Ja, basisvare" }).dblclick();
  await expect(page.getByRole("button", { name: "Ja, basisvare" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Nei", exact: true })).toBeDisabled();
  await expect(page.getByText("Har du vanligvis «Rømme» hjemme?")).toBeVisible();
  slipp();
  await expect(page.getByText("Har du vanligvis «Rømme» hjemme?")).toHaveCount(0);
  expect(puts).toHaveLength(1);
  expect(await lesEksport(STAPLES)).toEqual({ melk: true, rømme: true });
  expect(feil).toEqual([]);
});
