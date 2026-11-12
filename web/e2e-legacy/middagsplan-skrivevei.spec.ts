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

const BIBLIOTEK = {
  b1: { name: "Grøt" },
  b2: { name: "Lasagne" },
  b3: { name: "Fiskegrateng" },
  b4: { name: "Kyllinggryte" },
  b5: { name: "Pannekaker" },
  b6: { name: "Pølser" },
  b7: { name: "Wok" },
  b8: { name: "Gryterett" },
  b9: { name: "Burger" },
};

async function planDager(page: Page) {
  return page.evaluate(() => {
    const g = globalThis as unknown as {
      beregnAktivPlanperiode: (d: Date) => { weekKey: string; dayKey: string }[];
    };
    return g.beregnAktivPlanperiode(new Date()).map((d) => ({ uke: d.weekKey, dag: d.dayKey }));
  });
}
const lesDag = (d: { uke: string; dag: string }) => lesData(`${FAM}/meals/${d.uke}/${d.dag}`);
const bruk = (page: Page) => page.getByRole("button", { name: "Bruk denne planen" });

test("Førsteutkast over flere dager: delvis utfall beholder forslag, nytt forsøk overskriver ikke", async ({
  page,
}) => {
  const { feil } = await start(page, async () => {
    await settData(`${FAM}/mealLibrary`, BIBLIOTEK);
  });
  const dager = await planDager(page);
  expect(dager.length).toBeGreaterThanOrEqual(2);
  await tilPlan(page);
  await page.getByRole("button", { name: "✨ Foreslå middager" }).click();
  await expect(bruk(page)).toBeVisible();

  await legacyNett(page, "goOffline");
  const opptatt = dager[dager.length - 1]!;
  await settData(`${FAM}/meals/${opptatt.uke}/${opptatt.dag}`, "Pizza"); // annen klient
  await bruk(page).click();
  // Mens svaret venter er utkastet låst.
  await expect(bruk(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Avbryt", exact: true })).toBeDisabled();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  await expect(status(page)).toContainText(`${dager.length - 1} av ${dager.length}`);
  await expect(bruk(page)).toBeVisible(); // utkastet står
  for (const d of dager.slice(0, -1)) {
    await expect.poll(async () => ((await lesDag(d)) as { type?: string })?.type).toBe("recipe");
  }
  expect(await lesDag(opptatt)).toBe("Pizza");
  await expect(
    page.locator(`[data-ikke-lagret-forslag="${opptatt.uke}|${opptatt.dag}"]`),
  ).toBeVisible();

  // Nytt forsøk: konfliktdagen telles igjen, overskrives ikke, og forslaget står.
  await page.getByRole("button", { name: "Lukk" }).click();
  await bruk(page).click();
  await expect(status(page)).toContainText("0 av 1");
  expect(await lesDag(opptatt)).toBe("Pizza");
  await expect(bruk(page)).toBeVisible();

  // Brukeren fjerner forslaget selv; da er det ingenting igjen å lagre.
  await page
    .locator(`[data-ikke-lagret-forslag="${opptatt.uke}|${opptatt.dag}"]`)
    .getByRole("button")
    .click();
  await bruk(page).click();
  await expect(bruk(page)).toBeHidden();
  expect(await lesDag(opptatt)).toBe("Pizza");
  expect(feil).toEqual([]);
});

test("Førsteutkast: dag som er opptatt i visningen før godkjenning telles som konflikt, forslaget står", async ({
  page,
}) => {
  const { feil } = await start(page, async () => {
    await settData(`${FAM}/mealLibrary`, BIBLIOTEK);
  });
  const dager = await planDager(page);
  await tilPlan(page);
  await page.getByRole("button", { name: "✨ Foreslå middager" }).click();
  await expect(bruk(page)).toBeVisible();
  const opptatt = dager[0]!;
  // Den andre klienten fyller dagen, og legacy-lytteren mottar det.
  await settData(`${FAM}/meals/${opptatt.uke}/${opptatt.dag}`, "Pizza");
  const ikkeLagret = page.locator(`[data-ikke-lagret-forslag="${opptatt.uke}|${opptatt.dag}"]`);
  await expect(ikkeLagret).toBeVisible();

  await bruk(page).click();
  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  await expect(status(page)).toContainText(`${dager.length - 1} av ${dager.length}`);
  await expect(bruk(page)).toBeVisible();
  await expect(ikkeLagret).toBeVisible();
  expect(await lesDag(opptatt)).toBe("Pizza");
  for (const d of dager.slice(1)) {
    await expect.poll(async () => ((await lesDag(d)) as { type?: string })?.type).toBe("recipe");
  }
  expect(feil).toEqual([]);
});

test("Førsteutkast: Bytt og Avbryt kan ikke endre utkastet mens svaret venter", async ({
  page,
}) => {
  const { feil } = await start(page, async () => {
    await settData(`${FAM}/mealLibrary`, BIBLIOTEK);
  });
  const dager = await planDager(page);
  await tilPlan(page);
  await page.getByRole("button", { name: "✨ Foreslå middager" }).click();
  await expect(bruk(page)).toBeVisible();
  await legacyNett(page, "goOffline");
  await bruk(page).click();
  // Brukerforsøk mens svaret venter.
  await page.getByRole("button", { name: "Bytt" }).first().click({ force: true });
  await page.getByRole("button", { name: "Avbryt", exact: true }).click({ force: true });
  await expect(page.getByRole("button", { name: "Bytt" }).first()).toBeDisabled();
  await expect(bruk(page)).toBeVisible(); // ikke avbrutt
  await expect(page.getByText("Finn en annen →")).toHaveCount(0); // ingen bytteliste åpnet
  await legacyNett(page, "goOnline");

  await expect(bruk(page)).toBeHidden(); // alt lagret, utkastet lukket
  for (const d of dager) {
    await expect.poll(async () => ((await lesDag(d)) as { type?: string })?.type).toBe("recipe");
  }
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("åpent fritekstfelt: endring fra en annen klient som lytteren har mottatt, overskrives ikke", async ({
  page,
}) => {
  const { feil, uke } = await start(page, async () => {});
  await tilPlan(page);
  await rad(page, "Mon").click();
  const felt = page.getByPlaceholder("Søk i kokebok eller skriv inn…");
  await expect(felt).toBeVisible();
  // Klient B endrer samme dag (og en annen dag, som viser at lytteren har mottatt).
  await settData(`${FAM}/meals/${uke}/Mon`, "Suppe");
  await settData(`${FAM}/meals/${uke}/Sun`, "Laks");
  await expect(rad(page, "Sun")).toContainText("Laks");
  await felt.pressSequentially("Grøt");

  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  await expect(status(page)).toContainText("Mandag");
  await expect(felt).toHaveValue("Grøt"); // utkastet står
  expect((await lesUke(uke)).Mon).toBe("Suppe");
  expect(feil).toEqual([]);
});

test("valg fra åpent felt bruker øktens grunnlag; ved konflikt står feltet med utkastet", async ({
  page,
}) => {
  const { feil, uke } = await start(page, async () => {
    await settData(`${FAM}/mealLibrary`, { b1: { name: "Grøt" } });
  });
  await tilPlan(page);
  await rad(page, "Mon").click();
  const felt = rad(page, "Mon").getByPlaceholder("Søk i kokebok eller skriv inn…");
  await felt.pressSequentially("Grø");
  await expect.poll(async () => (await lesUke(uke)).Mon).toBe("Grø");
  // Klient B endrer samme dag, og lytteren mottar det (Sun viser «Laks»).
  await settData(`${FAM}/meals/${uke}/Mon`, "Suppe");
  await settData(`${FAM}/meals/${uke}/Sun`, "Laks");
  await expect(rad(page, "Sun")).toContainText("Laks");
  await page.getByText("Grøt", { exact: true }).first().click();

  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  await expect(felt).toBeVisible(); // feltet står
  await expect(felt).toHaveValue("Grø"); // med utkastet
  expect((await lesUke(uke)).Mon).toBe("Suppe");
  expect(feil).toEqual([]);
});

test("valg fra åpent felt: feltet er sperret mens svaret venter, og et sent svar lukker ikke en nyere økt", async ({
  page,
}) => {
  const { feil, uke } = await start(page, async () => {
    await settData(`${FAM}/mealLibrary`, { b1: { name: "Grøt" } });
  });
  await tilPlan(page);
  await rad(page, "Mon").click();
  await expect(page.getByText("Grøt", { exact: true }).first()).toBeVisible();
  await legacyNett(page, "goOffline");
  await page.getByText("Grøt", { exact: true }).first().click();
  const monFelt = rad(page, "Mon").getByPlaceholder("Søk i kokebok eller skriv inn…");
  await expect(monFelt).toBeDisabled(); // valget venter
  // Brukeren åpner en annen dag mens svaret venter.
  await rad(page, "Tue").click();
  const tueFelt = rad(page, "Tue").getByPlaceholder("Søk i kokebok eller skriv inn…");
  await expect(tueFelt).toBeVisible();
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await lesUke(uke)).Mon).toEqual({ type: "recipe", name: "Grøt" });
  await page.waitForTimeout(300);
  await expect(tueFelt).toBeVisible(); // den nyere økten er ikke lukket
  await expect(tueFelt).toBeEnabled();
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("Førsteutkast: ubekreftet utfall merkes som ubekreftet, og nytt forsøk leser dagen tilbake uten å overskrive", async ({
  page,
}) => {
  const { feil } = await start(page, async () => {
    await settData(`${FAM}/mealLibrary`, BIBLIOTEK);
  });
  const dager = await planDager(page);
  // Første transaksjon på en middagsdag lagres på serveren, men klienten får
  // ikke bekreftelsen (simulert brudd etter commit).
  await page.evaluate(() => {
    const fb = (
      globalThis as unknown as {
        firebase: { database: { Reference: { prototype: Record<string, unknown> } } };
      }
    ).firebase;
    const proto = fb.database.Reference.prototype;
    const orig = proto.transaction as (...a: unknown[]) => Promise<unknown>;
    let brutt = false;
    proto.transaction = function (this: { toString(): string }, ...a: unknown[]) {
      const p = orig.apply(this, a);
      if (!brutt && this.toString().includes("/meals/")) {
        brutt = true;
        return p.then(() => {
          throw new Error("simulert brudd etter commit");
        });
      }
      return p;
    };
  });
  await tilPlan(page);
  await page.getByRole("button", { name: "✨ Foreslå middager" }).click();
  await bruk(page).click();

  await expect(status(page)).toHaveAttribute("data-plan-status", "ukjent");
  await expect(status(page)).toContainText("Ubekreftet, kan være lagret");
  await expect(status(page)).toContainText(
    `${dager.length - 1} av ${dager.length} forslag er bekreftet lagret`,
  );
  await expect(bruk(page)).toBeVisible(); // utkastet står
  await expect(page.locator('[data-ubekreftet="ja"]')).toHaveCount(1);
  for (const d of dager) {
    await expect.poll(async () => ((await lesDag(d)) as { type?: string })?.type).toBe("recipe");
  }
  const foer = await Promise.all(dager.map(lesDag));

  // Nytt forsøk mens tilgangen er fjernet: tilbakelesingen avvises. Det sier
  // ingenting om første commit, så forslaget forblir ubekreftet.
  const medlemmer = await lesData(`${FAM}/members`);
  await settData(`${FAM}/members`, null);
  await page.getByRole("button", { name: "Lukk" }).click();
  await bruk(page).click();
  await expect(status(page)).toHaveAttribute("data-plan-status", "avvist");
  await expect(status(page)).toContainText("Ubekreftet, kan være lagret");
  await expect(status(page)).toContainText("Tilbakelesingen ble avvist");
  await expect(status(page)).not.toContainText("Ikke lagret");
  await expect(page.locator('[data-ubekreftet="ja"]')).toHaveCount(1);
  await expect(bruk(page)).toBeVisible();
  await settData(`${FAM}/members`, medlemmer);
  expect(await Promise.all(dager.map(lesDag))).toEqual(foer);

  // Med tilgang igjen: tilbakelesing gjenkjenner forslaget som lagret, ingenting overskrives.
  await page.getByRole("button", { name: "Lukk" }).click();
  await bruk(page).click();
  await expect(bruk(page)).toBeHidden();
  await expect(status(page)).toHaveCount(0);
  expect(await Promise.all(dager.map(lesDag))).toEqual(foer);
  expect(feil).toEqual([]);
});

test("Førsteutkast: Bytt på et ubekreftet forslag gir ikke den nye verdien status som tidligere forsøkt", async ({
  page,
}) => {
  const { feil } = await start(page, async () => {
    await settData(`${FAM}/mealLibrary`, BIBLIOTEK);
  });
  const dager = await planDager(page);
  // Første transaksjon på en middagsdag svarer med feil uten å skrive.
  await page.evaluate(() => {
    const fb = (
      globalThis as unknown as {
        firebase: { database: { Reference: { prototype: Record<string, unknown> } } };
      }
    ).firebase;
    const proto = fb.database.Reference.prototype;
    const orig = proto.transaction as (...a: unknown[]) => Promise<unknown>;
    let brutt = false;
    proto.transaction = function (this: { toString(): string }, ...a: unknown[]) {
      if (!brutt && this.toString().includes("/meals/")) {
        brutt = true;
        return Promise.reject(new Error("simulert brudd uten commit"));
      }
      return orig.apply(this, a);
    };
  });
  await tilPlan(page);
  await page.getByRole("button", { name: "✨ Foreslå middager" }).click();
  await bruk(page).click();
  await expect(status(page)).toHaveAttribute("data-plan-status", "ukjent");
  const merke = page.locator('[data-ubekreftet="ja"]');
  await expect(merke).toHaveCount(1);

  // Brukeren bytter forslaget på den ubekreftede dagen.
  const radMedMerke = merke.locator('xpath=ancestor::div[.//button[normalize-space()="Bytt"]][1]');
  await radMedMerke.getByRole("button", { name: "Bytt" }).click();
  await page.getByRole("button", { name: "Finn en annen →" }).click();
  await page.getByPlaceholder("Søk i kokebok eller biblioteket…").fill("Laks");
  await page.getByText("Laks", { exact: true }).last().click();
  await expect(merke).toHaveCount(0); // den nye verdien er ikke «tidligere forsøkt»

  await page.getByRole("button", { name: "Lukk" }).click();
  await bruk(page).click();
  await expect(bruk(page)).toBeHidden();
  const verdier = await Promise.all(dager.map(lesDag));
  expect(verdier.filter((v) => (v as { name?: string })?.name === "Laks")).toHaveLength(1);
  expect(verdier.every((v) => (v as { type?: string })?.type === "recipe")).toBe(true);
  expect(feil).toEqual([]);
});

test("Kokebokens «Legg til»: samme navn med annen oppskriftsnøkkel er konflikt, samme nøkkel er uendret", async ({
  page,
}) => {
  const { feil, nesteUke } = await start(page, async (_uke, nesteUke) => {
    await settData(`${FAM}/recipes/taco2`, oppskrift("taco2", "Taco"));
    await settData(`${FAM}/meals/${nesteUke}/Wed`, {
      type: "recipe",
      name: "Taco",
      recipeId: "taco2",
    });
    await settData(`${FAM}/meals/${nesteUke}/Thu`, {
      type: "recipe",
      name: "Taco",
      recipeId: "taco",
    });
  });
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Kokebok", { exact: true }).first().click();
  await expect(page.getByPlaceholder("Søk i kokebok…")).toBeVisible();
  await page.evaluate(() =>
    (globalThis as unknown as { __openRecipe?: (id: string) => void }).__openRecipe?.("taco"),
  );
  await page.getByRole("button", { name: "Neste uke" }).click();
  await page.getByRole("button", { name: "On ✓", exact: true }).click();
  await expect(status(page)).toHaveAttribute("data-plan-status", "konflikt");
  expect((await lesUke(nesteUke)).Wed).toEqual({ type: "recipe", name: "Taco", recipeId: "taco2" });

  await page.getByRole("button", { name: "Lukk" }).click();
  await page.getByRole("button", { name: "To ✓", exact: true }).click();
  await page.waitForTimeout(500);
  await expect(status(page)).toHaveCount(0);
  expect((await lesUke(nesteUke)).Thu).toEqual({ type: "recipe", name: "Taco", recipeId: "taco" });
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
