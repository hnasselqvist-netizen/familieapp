/**
 * Legacy-middagsplanen skriver per dag (#20, ordre 6805048861). Testene kjører
 * ekte legacy `index.html` mot Firebase-emulatoren, med syntetiske data.
 * Legacy kobles fra (`goOffline`), og «den andre klienten» (emulator-REST, som
 * React, MCP eller en annen enhet) endrer. Legacy handler så fra sitt gamle
 * bilde. Ved gjenoppkobling skal ingen andre dager eller råfelt gå tapt, og et
 * endret eller opptatt mål skal gi synlig utfall i stedet for overskriving.
 *
 * Før rettingen skrev legacy HELE uken fra lokal state (`setWeekMeals` →
 * `dbSet(meals/{uke})`) fra planvisningen, Kokebokens «Legg til i
 * middagsplanen» og Førsteutkast. Én handling på én dag kunne dermed
 * overskrive en annen dags nyere endring. Samme mønster som
 * `kokebok-skrivevei.spec.ts` og `matlager-skrivevei.spec.ts`.
 */
import { type Page, expect, test } from "@playwright/test";
import {
  FAM,
  aapneLegacy,
  legacyNett,
  lesData,
  nyttMedlem,
  rutLegacy,
  settData,
  settRules,
} from "./legacy-harness";

const DAGER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Dag = (typeof DAGER)[number];
type Uke = Partial<Record<Dag, unknown>>;

const oppskrift = (id: string, name: string) => ({
  id,
  name,
  cat: "Middag",
  tags: [],
  time: 20,
  servings: 4,
  url: "",
  source: "manual",
  instructions: "",
  ingredients: [{ name: "Løk", amount: "1 stk", cat: "Grønnsaker" }],
  createdAt: 1,
});

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

/** Ukenøkkel og dagindeks for i dag, slik legacy selv regner dem. */
async function iDag(page: Page) {
  return page.evaluate(() => {
    const g = globalThis as unknown as {
      getWeekKey: (d: Date) => string;
      addWeeks: (w: string, n: number) => string;
    };
    const uke = g.getWeekKey(new Date());
    return { uke, nesteUke: g.addWeeks(uke, 1), idx: (new Date().getDay() + 6) % 7 };
  });
}

async function start(page: Page, oppsett: (uke: string, nesteUke: string) => Promise<void>) {
  await settData(FAM, null);
  await settData(`${FAM}/recipes`, {
    taco: oppskrift("taco", "Taco"),
    suppe: oppskrift("suppe", "Suppe"),
    laks: oppskrift("laks", "Laks"),
  });
  const feil = await aapneLegacy(page, await nyttMedlem());
  const t = await iDag(page);
  await oppsett(t.uke, t.nesteUke);
  return { feil, ...t };
}

async function tilPlan(page: Page) {
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Plan", { exact: true }).first().click();
  await expect(page.getByText("Middagsplan", { exact: true })).toBeVisible();
}

const rad = (page: Page, dag: Dag) => page.locator(`[data-plan-dag="${dag}"]`);
const status = (page: Page) => page.locator("[data-plan-status]");
const lesUke = async (uke: string) => ((await lesData(`${FAM}/meals/${uke}`)) ?? {}) as Uke;
/** En dag som ikke er i dag (der vises «＋ Rett» og ingen «✓ Bekreft»). */
const annenDag = (idx: number, steg: number): Dag => DAGER[(idx + steg) % 7]!;

test("tøm dag fra foreldet side: andre dagers nyere endringer og råfelt står", async ({ page }) => {
  const a: Dag = "Mon";
  const { feil, uke } = await start(page, async (uke) => {
    await settData(`${FAM}/meals/${uke}`, { [a]: "Taco" });
  });
  await tilPlan(page);
  await expect(rad(page, a)).toContainText("Taco");
  await legacyNett(page, "goOffline");
  // Den andre klienten endrer to andre dager.
  await settData(`${FAM}/meals/${uke}/Tue`, "Suppe");
  await settData(`${FAM}/meals/${uke}/Wed`, {
    type: "recipe",
    name: "Laks",
    recipeId: "laks",
    ukjent: { fra: "mcp" },
  });
  await rad(page, a).getByRole("button", { name: "✕" }).last().click();
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await lesUke(uke))[a] ?? "").toBe("");
  const u = await lesUke(uke);
  expect(u.Tue).toBe("Suppe");
  expect(u.Wed).toEqual({ type: "recipe", name: "Laks", recipeId: "laks", ukjent: { fra: "mcp" } });
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("erstatt fra foreldet grunnlag: synlig konflikt, dagen overskrives ikke", async ({ page }) => {
  const { feil, uke } = await start(page, async (uke) => {
    await settData(`${FAM}/meals/${uke}`, { Mon: "Taco" });
  });
  await tilPlan(page);
  await expect(rad(page, "Mon")).toContainText("Taco");
  await legacyNett(page, "goOffline");
  await settData(`${FAM}/meals/${uke}/Mon`, "Pizza");
  await rad(page, "Mon").getByRole("button", { name: "✕" }).last().click();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  await expect(status(page)).toContainText("endret på en annen enhet");
  expect((await lesUke(uke)).Mon).toBe("Pizza");
  expect(feil).toEqual([]);
});

test("fritekst skrives per tastetrykk uten falsk konflikt, og rører ikke andre dager", async ({
  page,
}) => {
  const { feil, uke } = await start(page, async (uke) => {
    await settData(`${FAM}/meals/${uke}`, { Fri: "Suppe" });
  });
  await tilPlan(page);
  await legacyNett(page, "goOffline");
  await settData(`${FAM}/meals/${uke}/Tue`, "Laks"); // annen klient, annen dag
  await rad(page, "Mon").click();
  await page.getByPlaceholder("Søk i kokebok eller skriv inn…").pressSequentially("Grøt");
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await lesUke(uke)).Mon).toBe("Grøt");
  const u = await lesUke(uke);
  expect(u.Tue).toBe("Laks");
  expect(u.Fri).toBe("Suppe");
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("menyredigering bevarer råfelt på dag og retter, og andre dagers endringer", async ({
  page,
}) => {
  const { feil, uke, idx } = await start(page, async () => {});
  const dag = annenDag(idx, 3);
  const meny = {
    type: "menu",
    name: "Taco · Suppe",
    recipes: [
      { name: "Taco", recipeId: "taco", variantId: "v1", ukjent: 1 },
      { name: "Suppe", recipeId: "suppe", ukjent: 2 },
    ],
    dagfelt: "behold",
  };
  await settData(`${FAM}/meals/${uke}/${dag}`, meny);
  await tilPlan(page);
  await expect(rad(page, dag)).toContainText("Taco");
  await legacyNett(page, "goOffline");
  const annen = annenDag(idx, 4);
  await settData(`${FAM}/meals/${uke}/${annen}`, "Pizza");
  await rad(page, dag).getByRole("button", { name: "＋ Rett" }).click();
  await page.getByPlaceholder("Søk etter rett å legge til…").fill("Laks");
  await page.getByText("Laks", { exact: true }).first().click();
  await legacyNett(page, "goOnline");

  await expect
    .poll(async () => ((await lesUke(uke))[dag] as { recipes?: unknown[] })?.recipes?.length)
    .toBe(3);
  let u = await lesUke(uke);
  expect(u[dag]).toEqual({
    ...meny,
    name: "Taco · Suppe · Laks",
    recipes: [...meny.recipes, { name: "Laks", recipeId: "laks" }],
  });
  expect(u[annen]).toBe("Pizza");

  // Fjern «Taco» (første ✕ i menyen): råfeltene på resten står.
  await rad(page, dag).getByRole("button", { name: "✕" }).first().click();
  await expect
    .poll(async () => ((await lesUke(uke))[dag] as { recipes?: unknown[] })?.recipes?.length)
    .toBe(2);
  u = await lesUke(uke);
  expect(u[dag]).toEqual({
    ...meny,
    name: "Suppe · Laks",
    recipes: [meny.recipes[1], { name: "Laks", recipeId: "laks" }],
  });
  expect(u[annen]).toBe("Pizza");
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("menyredigering fra foreldet grunnlag: synlig konflikt, ingenting skrives", async ({
  page,
}) => {
  const { feil, uke, idx } = await start(page, async () => {});
  const dag = annenDag(idx, 3);
  const meny = {
    type: "menu",
    name: "Taco · Suppe",
    recipes: [
      { name: "Taco", recipeId: "taco" },
      { name: "Suppe", recipeId: "suppe" },
    ],
  };
  await settData(`${FAM}/meals/${uke}/${dag}`, meny);
  await tilPlan(page);
  await expect(rad(page, dag)).toContainText("Suppe");
  await legacyNett(page, "goOffline");
  const endret = { ...meny, recipes: [...meny.recipes, { name: "Brød", recipeId: null }] };
  await settData(`${FAM}/meals/${uke}/${dag}`, endret);
  await rad(page, dag).getByRole("button", { name: "✕" }).first().click();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  expect((await lesUke(uke))[dag]).toEqual({
    ...meny,
    recipes: [...meny.recipes, { name: "Brød" }],
  });
  expect(feil).toEqual([]);
});

test("Kokebokens «Legg til»: tom dag fylles, opptatt dag overskrives ikke, andre dager står", async ({
  page,
}) => {
  const { feil, nesteUke } = await start(page, async () => {});
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Kokebok", { exact: true }).first().click();
  await page.getByText("Taco", { exact: true }).first().click();
  await page.getByRole("button", { name: "Neste uke" }).click();
  await legacyNett(page, "goOffline");
  // Den andre klienten fyller tirsdag og endrer fredag i neste uke.
  await settData(`${FAM}/meals/${nesteUke}/Tue`, "Pizza");
  await settData(`${FAM}/meals/${nesteUke}/Fri`, { type: "event", name: "Ute", emoji: "🍕" });
  await page.getByRole("button", { name: "Ti", exact: true }).click();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  await expect(status(page)).toContainText("Tirsdag");
  let u = await lesUke(nesteUke);
  expect(u.Tue).toBe("Pizza");
  expect(u.Fri).toEqual({ type: "event", name: "Ute", emoji: "🍕" });

  await page.getByRole("button", { name: "Lukk" }).click();
  await page.getByRole("button", { name: "On", exact: true }).click();
  await expect
    .poll(async () => (await lesUke(nesteUke)).Wed)
    .toEqual({ type: "recipe", name: "Taco", recipeId: "taco" });
  u = await lesUke(nesteUke);
  expect(u.Tue).toBe("Pizza");
  expect(u.Fri).toEqual({ type: "event", name: "Ute", emoji: "🍕" });
  expect(feil).toEqual([]);
});

test("Førsteutkast over flere dager: delvis utfall beholder forslag, nytt forsøk overskriver ikke", async ({
  page,
}) => {
  const { feil } = await start(page, async () => {
    await settData(`${FAM}/mealLibrary`, {
      b1: { name: "Grøt" },
      b2: { name: "Lasagne" },
      b3: { name: "Fiskegrateng" },
      b4: { name: "Kyllinggryte" },
      b5: { name: "Pannekaker" },
      b6: { name: "Pølser" },
      b7: { name: "Wok" },
      b8: { name: "Gryterett" },
      b9: { name: "Burger" },
    });
  });
  const dager = await page.evaluate(() => {
    const g = globalThis as unknown as {
      beregnAktivPlanperiode: (d: Date) => { weekKey: string; dayKey: string }[];
    };
    return g.beregnAktivPlanperiode(new Date()).map((d) => ({ uke: d.weekKey, dag: d.dayKey }));
  });
  expect(dager.length).toBeGreaterThanOrEqual(2);
  await tilPlan(page);
  await page.getByRole("button", { name: "✨ Foreslå middager" }).click();
  await expect(page.getByRole("button", { name: "Bruk denne planen" })).toBeVisible();

  await legacyNett(page, "goOffline");
  const opptatt = dager[dager.length - 1]!;
  await settData(`${FAM}/meals/${opptatt.uke}/${opptatt.dag}`, "Pizza"); // annen klient
  await page.getByRole("button", { name: "Bruk denne planen" }).click();
  await expect(page.getByRole("button", { name: "Bruk denne planen" })).toBeDisabled();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  await expect(status(page)).toContainText(`${dager.length - 1} av ${dager.length}`);
  // Utkastet står med forslaget som ikke ble lagret.
  await expect(page.getByRole("button", { name: "Bruk denne planen" })).toBeVisible();
  for (const d of dager.slice(0, -1)) {
    await expect
      .poll(
        async () => ((await lesData(`${FAM}/meals/${d.uke}/${d.dag}`)) as { type?: string })?.type,
      )
      .toBe("recipe");
  }
  expect(await lesData(`${FAM}/meals/${opptatt.uke}/${opptatt.dag}`)).toBe("Pizza");

  // Nytt forsøk overskriver ikke den opptatte dagen.
  await page.getByRole("button", { name: "Bruk denne planen" }).click();
  await expect(page.getByRole("button", { name: "Bruk denne planen" })).toBeHidden();
  expect(await lesData(`${FAM}/meals/${opptatt.uke}/${opptatt.dag}`)).toBe("Pizza");
  expect(feil).toEqual([]);
});

test("avvist av databasen (tilgang fjernet): synlig avvisning, ingenting skrevet", async ({
  page,
}) => {
  const { feil, uke } = await start(page, async (uke) => {
    await settData(`${FAM}/meals/${uke}`, { Mon: "Taco", Tue: "Suppe" });
  });
  await tilPlan(page);
  await expect(rad(page, "Mon")).toContainText("Taco");
  await legacyNett(page, "goOffline");
  await settData(`${FAM}/members`, null);
  await rad(page, "Mon").getByRole("button", { name: "✕" }).last().click();
  await legacyNett(page, "goOnline");
  await expect(status(page)).toHaveAttribute("data-plan-status", "avvist");
  expect(await lesUke(uke)).toEqual({ Mon: "Taco", Tue: "Suppe" });
  expect(feil).toEqual([]);
});
