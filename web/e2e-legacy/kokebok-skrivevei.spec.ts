/**
 * Legacy-Kokebok skriver per oppskrift (#20, ordre 6796358047). Testene kjører
 * ekte legacy `index.html` mot Firebase-emulatoren, med syntetiske data.
 * Legacy kobles fra (`goOffline`), og «den andre klienten» (emulator-REST, som
 * React, MCP eller en annen enhet) endrer. Legacy handler så fra sitt gamle
 * bilde. Ved gjenoppkobling skal ingen andres endringer gå tapt, ingen slettet
 * oppskrift gjenoppstå, og et manglende eller endret mål gi synlig utfall.
 *
 * Før rettingen skrev legacy HELE `recipes` fra lokal liste (`setRecipes` →
 * `dbSet`), med lagret `id`-felt som nøkkel. React-oppskrifter uten `id`-felt
 * havnet da under nøkkelen «undefined». Samme mønster som legacy-Matlager
 * (`matlager-skrivevei.spec.ts`).
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

const OPPSKRIFTER = `${FAM}/recipes`;
type Oppskrift = Record<string, unknown> & { name: string };

const grunn = (name: string) => ({
  name,
  cat: "Middag",
  tags: ["enkel"],
  time: 20,
  servings: 4,
  url: "",
  source: "manual",
  instructions: "",
  ingredients: [{ name: "Kjøttdeig", amount: "400 g", cat: "Kjøtt" }],
  createdAt: 1,
  timesCooked: 0,
});
/** Legacy-opprettet oppskrift (har id-felt i noden). */
const legacyOppskrift = (id: string, name: string): Oppskrift => ({ id, ...grunn(name) });
/** React-opprettet oppskrift (ingen id-felt i noden — id er nøkkelen). */
const reactOppskrift = (name: string): Oppskrift => grunn(name);

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

async function startKokebok(page: Page, oppskrifter: Record<string, Oppskrift>) {
  await settData(FAM, null);
  await settData(OPPSKRIFTER, oppskrifter);
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Kokebok", { exact: true }).first().click();
  await expect(page.getByPlaceholder("Søk i kokebok…")).toBeVisible();
  return feil;
}

/** Åpner legacy på Plan med dagens middag satt til `maaltid`. */
async function startPlan(page: Page, oppskrifter: Record<string, Oppskrift>, maaltid: unknown) {
  await settData(FAM, null);
  await settData(OPPSKRIFTER, oppskrifter);
  const feil = await aapneLegacy(page, await nyttMedlem());
  const { uke, dag } = await page.evaluate(() => {
    const g = globalThis as unknown as { getWeekKey: (d: Date) => string };
    const dager = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return { uke: g.getWeekKey(new Date()), dag: dager[(new Date().getDay() + 6) % 7]! };
  });
  await settData(`${FAM}/meals/${uke}/${dag}`, maaltid);
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Plan", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "✓ Bekreft" })).toBeVisible();
  return feil;
}

async function bekreft(page: Page) {
  await page.getByRole("button", { name: "✓ Bekreft" }).click();
  await page.getByRole("button", { name: "✓ Ja" }).click();
  await page.getByRole("button", { name: /Fungerte fint/ }).click();
}

/** Hendelser av typen «meal_confirmed» (loggen skal stå uansett utfall for oppskriften). */
const bekreftelser = async () =>
  Object.values(
    ((await lesData(`${FAM}/events`)) ?? {}) as Record<string, { type?: string; meal?: string }>,
  ).filter((h) => h.type === "meal_confirmed");

const les = async () => ((await lesData(OPPSKRIFTER)) ?? {}) as Record<string, Oppskrift>;
const status = (page: Page) => page.locator("[data-kokebok-status]");
const aapne = (page: Page, navn: string) => page.getByText(navn, { exact: true }).first().click();

test("foreldet legacy-side: ny oppskrift bevarer andres nye og endrede poster, og gjenoppliver ikke slettede", async ({
  page,
}) => {
  const feil = await startKokebok(page, {
    a: legacyOppskrift("a", "Taco"),
    d: legacyOppskrift("d", "Suppe"),
    r: reactOppskrift("Laks"),
  });
  await expect(page.getByText("Laks", { exact: true })).toBeVisible();
  await legacyNett(page, "goOffline");
  // Den andre klienten:
  await settData(`${OPPSKRIFTER}/d`, null);
  await settData(`${OPPSKRIFTER}/b`, reactOppskrift("Brød"));
  await settData(`${OPPSKRIFTER}/r/servings`, 2);
  await settData(`${OPPSKRIFTER}/r/ukjent`, { fra: "annen klient" });
  // Legacy, fra sitt gamle bilde: ny oppskrift.
  await page.getByRole("button", { name: "＋ Legg til" }).click();
  await page.getByPlaceholder("Navn på retten…").fill("Grøt");
  await page.getByRole("button", { name: "Lagre «Grøt»" }).click();
  // Venter på databasen: skjemaet står, og ny lagring er sperret.
  await expect(page.getByRole("button", { name: "Lagre «Grøt»" })).toBeDisabled();
  await legacyNett(page, "goOnline");
  await expect(page.getByRole("button", { name: "Lagre «Grøt»" })).toBeHidden();

  await expect
    .poll(async () => Object.values(await les()).some((o) => o.name === "Grøt"))
    .toBe(true);
  const o = await les();
  const nokler = Object.keys(o);
  expect(nokler).not.toContain("d"); // ikke gjenopplivet
  expect(nokler).not.toContain("undefined");
  expect(nokler).toEqual(expect.arrayContaining(["a", "b", "r"]));
  expect(nokler).toHaveLength(4);
  expect(o.r).toMatchObject({ name: "Laks", servings: 2, ukjent: { fra: "annen klient" } });
  expect(o.r).not.toHaveProperty("id"); // React-posten får ikke id-felt skrevet inn
  const ny = Object.entries(o).find(([, v]) => v.name === "Grøt")!;
  expect(ny[1].id).toBe(ny[0]); // legacy-oppretting skriver id lik nøkkelen, som før
  expect(feil).toEqual([]);
});

test("redigering av én oppskrift rører ikke andre poster, og en slettet post gjenoppstår ikke", async ({
  page,
}) => {
  const feil = await startKokebok(page, {
    a: legacyOppskrift("a", "Taco"),
    d: legacyOppskrift("d", "Suppe"),
    r: reactOppskrift("Laks"),
  });
  await aapne(page, "Taco");
  await legacyNett(page, "goOffline");
  await settData(`${OPPSKRIFTER}/d`, null);
  await settData(`${OPPSKRIFTER}/r/time`, 45);
  await page.getByRole("button", { name: "✏️ Rediger" }).click();
  await page.getByPlaceholder("Tomatsuppe…").fill("Fredagstaco");
  await page.getByRole("button", { name: "💾 Lagre endringer" }).click();
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).a?.name).toBe("Fredagstaco");
  const o = await les();
  expect(Object.keys(o).sort()).toEqual(["a", "r"]);
  expect(o.r?.time).toBe(45);
  expect(o.a).toMatchObject({ id: "a", updatedAt: expect.any(Number) });
  expect(feil).toEqual([]);
});

test("redigering fra foreldet grunnlag i et felt som skrives: synlig konflikt, utkastet står, ingenting overskrives", async ({
  page,
}) => {
  const feil = await startKokebok(page, { a: legacyOppskrift("a", "Taco") });
  await aapne(page, "Taco");
  await legacyNett(page, "goOffline");
  // Den andre klienten endrer et felt redigeringen også skriver.
  await settData(`${OPPSKRIFTER}/a/name`, "Taco deluxe");
  const foer = (await les()).a;
  await page.getByRole("button", { name: "✏️ Rediger" }).click();
  await page.getByPlaceholder("Tomatsuppe…").fill("Fredagstaco");
  await page.getByRole("button", { name: "💾 Lagre endringer" }).click();
  // Venter på databasen: ingen dobbel lagring.
  await expect(page.getByRole("button", { name: "💾 Lagre endringer" })).toBeDisabled();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-kokebok-status", "konflikt");
  await expect(status(page)).toContainText("er endret på en annen enhet");
  // Skjemaet står åpent med utkastet, og kan lagres igjen.
  await expect(page.getByPlaceholder("Tomatsuppe…")).toHaveValue("Fredagstaco");
  await expect(page.getByRole("button", { name: "💾 Lagre endringer" })).toBeEnabled();
  expect((await les()).a).toEqual(foer);
  expect(feil).toEqual([]);
});

test("redigering fra foreldet grunnlag i et urørt felt: begge endringene står", async ({
  page,
}) => {
  const feil = await startKokebok(page, { a: legacyOppskrift("a", "Taco") });
  await aapne(page, "Taco");
  await legacyNett(page, "goOffline");
  await settData(`${OPPSKRIFTER}/a/ingredients/0/amount`, "800 g");
  await page.getByRole("button", { name: "✏️ Rediger" }).click();
  await page.getByPlaceholder("Tomatsuppe…").fill("Fredagstaco");
  await page.getByRole("button", { name: "💾 Lagre endringer" }).click();
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).a?.name).toBe("Fredagstaco");
  expect((await les()).a?.ingredients).toEqual([
    { name: "Kjøttdeig", amount: "800 g", cat: "Kjøtt" },
  ]);
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("redigering av en oppskrift som er slettet: synlig konflikt, ingen gjenoppliving", async ({
  page,
}) => {
  const feil = await startKokebok(page, {
    a: legacyOppskrift("a", "Taco"),
    b: legacyOppskrift("b", "Brød"),
  });
  await aapne(page, "Taco");
  await legacyNett(page, "goOffline");
  await settData(`${OPPSKRIFTER}/a`, null);
  await page.getByRole("button", { name: "✏️ Rediger" }).click();
  await page.getByPlaceholder("Tomatsuppe…").fill("Fredagstaco");
  await page.getByRole("button", { name: "💾 Lagre endringer" }).click();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toContainText("finnes ikke lenger");
  await expect(page.getByPlaceholder("Tomatsuppe…")).toHaveValue("Fredagstaco");
  expect(Object.keys(await les())).toEqual(["b"]);
  expect(feil).toEqual([]);
});

test("«Slett»: foreldet grunnlag avvises synlig, slettet mål gjenopprettes ikke, uendret post slettes", async ({
  page,
}) => {
  const feil = await startKokebok(page, {
    a: legacyOppskrift("a", "Taco"),
    d: legacyOppskrift("d", "Suppe"),
    r: reactOppskrift("Laks"),
  });
  // Endret etter visningen, også bare et ukjent felt: avvises.
  await aapne(page, "Taco");
  await legacyNett(page, "goOffline");
  await settData(`${OPPSKRIFTER}/a/ukjent`, 1);
  await page.getByRole("button", { name: "🗑️ Slett" }).click();
  await legacyNett(page, "goOnline");
  await expect(status(page)).toHaveAttribute("data-kokebok-status", "konflikt");
  await expect(status(page)).toContainText("Ingenting er slettet");
  expect((await les()).a?.ukjent).toBe(1);

  // Slettet av den andre klienten: ingen gjenoppliving.
  await page.getByRole("button", { name: "← Tilbake" }).click();
  await aapne(page, "Suppe");
  await legacyNett(page, "goOffline");
  await settData(`${OPPSKRIFTER}/d`, null);
  await page.getByRole("button", { name: "🗑️ Slett" }).click();
  await legacyNett(page, "goOnline");
  await expect(status(page)).toContainText("var allerede slettet");
  expect(Object.keys(await les()).sort()).toEqual(["a", "r"]);

  // Uendret React-post (uten id-felt) slettes.
  await aapne(page, "Laks");
  await page.getByRole("button", { name: "🗑️ Slett" }).click();
  await expect.poll(async () => Object.keys(await les())).toEqual(["a"]);
  expect(feil).toEqual([]);
});

test("«Bekreft middag» teller opp fra fersk verdi og bevarer andre felt og poster", async ({
  page,
}) => {
  const feil = await startPlan(
    page,
    { a: legacyOppskrift("a", "Taco"), b: reactOppskrift("Brød") },
    { type: "recipe", name: "Taco", recipeId: "a" },
  );
  await legacyNett(page, "goOffline");
  // Den andre klienten har allerede bekreftet én gang og lagt til et felt.
  await settData(`${OPPSKRIFTER}/a/timesCooked`, 3);
  await settData(`${OPPSKRIFTER}/a/ukjent`, "x");
  await bekreft(page);
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).a?.timesCooked).toBe(4);
  const o = await les();
  expect(o.a).toMatchObject({ name: "Taco", ukjent: "x", lastCooked: expect.any(Number) });
  expect(Object.keys(o).sort()).toEqual(["a", "b"]);
  expect(o.b).not.toHaveProperty("id");
  expect(feil).toEqual([]);
});

test("«Bekreft middag» skriver til planens recipeId, ikke første navnetreff", async ({ page }) => {
  const feil = await startPlan(
    page,
    { a: legacyOppskrift("a", "Taco"), b: legacyOppskrift("b", "Taco") },
    { type: "recipe", name: "Taco", recipeId: "b" },
  );
  await bekreft(page);
  await expect.poll(async () => (await les()).b?.timesCooked).toBe(1);
  const o = await les();
  expect(o.b?.lastCooked).toEqual(expect.any(Number));
  expect(o.a).toEqual(legacyOppskrift("a", "Taco")); // urørt
  expect(feil).toEqual([]);
});

test("«Bekreft middag» med slettet planlagt oppskrift: synlig utfall, ingen navnefallback, hendelsen logges", async ({
  page,
}) => {
  const feil = await startPlan(
    page,
    { a: legacyOppskrift("a", "Taco"), x: legacyOppskrift("x", "Taco") },
    { type: "recipe", name: "Taco", recipeId: "x" },
  );
  await legacyNett(page, "goOffline");
  await settData(`${OPPSKRIFTER}/x`, null);
  await bekreft(page);
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-kokebok-status", "konflikt");
  await expect(status(page)).toContainText("finnes ikke lenger");
  const o = await les();
  expect(Object.keys(o)).toEqual(["a"]); // x er ikke gjenopprettet
  expect(o.a).toEqual(legacyOppskrift("a", "Taco")); // ingen fallback til samme navn
  expect(await bekreftelser()).toEqual([expect.objectContaining({ meal: "Taco" })]);
  expect(feil).toEqual([]);
});

test("«Bekreft middag» med tvetydig navn uten recipeId: synlig utfall, ingen skriving", async ({
  page,
}) => {
  const feil = await startPlan(
    page,
    { a: legacyOppskrift("a", "Taco"), b: reactOppskrift("taco") },
    "Taco",
  );
  const foer = await les();
  await bekreft(page);
  await expect(status(page)).toContainText("Flere oppskrifter heter «Taco»");
  expect(await bekreftelser()).toHaveLength(1);
  expect(await les()).toEqual(foer);
  expect(feil).toEqual([]);
});

test("«Bekreft middag» med entydig navn uten recipeId skriver til det ene treffet", async ({
  page,
}) => {
  const feil = await startPlan(
    page,
    { a: legacyOppskrift("a", "Taco"), r: reactOppskrift("Laks") },
    "Laks",
  );
  await bekreft(page);
  await expect.poll(async () => (await les()).r?.timesCooked).toBe(1);
  const o = await les();
  expect(o.r).not.toHaveProperty("id");
  expect(o.a).toEqual(legacyOppskrift("a", "Taco"));
  expect(feil).toEqual([]);
});

test("forsinket «Bekreft middag» ruller ikke tilbake et nyere «sist laget»", async ({ page }) => {
  const feil = await startPlan(
    page,
    { a: legacyOppskrift("a", "Taco") },
    { type: "recipe", name: "Taco", recipeId: "a" },
  );
  const nyere = Date.now() + 10 * 24 * 3600 * 1000;
  await legacyNett(page, "goOffline");
  await bekreft(page);
  // Den andre klienten bekrefter senere, mens legacy er frakoblet.
  await settData(`${OPPSKRIFTER}/a/lastCooked`, nyere);
  await settData(`${OPPSKRIFTER}/a/timesCooked`, 1);
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).a?.timesCooked).toBe(2);
  expect((await les()).a?.lastCooked).toBe(nyere);
  expect(feil).toEqual([]);
});

test("ren navneendring bevarer urørte ingredienser, grupper, ukjente felt og ukjent porsjonstall", async ({
  page,
}) => {
  const utenPorsjoner: Record<string, unknown> = legacyOppskrift("a", "Taco");
  delete utenPorsjoner.servings; // ukjent porsjonstall
  const flat = {
    ...(utenPorsjoner as Oppskrift),
    imageUrl: "https://example.invalid/taco.jpg",
    source: "url",
    ingredients: [
      { name: "Kjøttdeig", amount: "400 g", cat: "Kjøtt", ukjent: { fra: "mcp" } },
      { name: "Fløte", amount: 1.5, unit: "dl" },
      { name: "Salt" },
    ],
  };
  const gruppert: Oppskrift = {
    ...legacyOppskrift("g", "Lasagne"),
    servings: 0,
    ingredients: [],
    ingredientGroups: [
      {
        id: "g1",
        name: "Saus",
        ukjent: 1,
        ingredients: [{ name: "Tomat", amount: "2 bx", merknad: "hakket" }],
      },
      { name: "Topp", ingredients: [{ name: "Ost", amount: 200, unit: "g" }] },
    ],
  };
  delete (gruppert as Record<string, unknown>).ingredients; // gruppert post uten flat liste
  const feil = await startKokebok(page, { a: flat, g: gruppert });

  for (const [id, gammelt, nytt] of [
    ["a", "Taco", "Fredagstaco"],
    ["g", "Lasagne", "Søndagslasagne"],
  ] as const) {
    const foer = (await les())[id]!;
    await aapne(page, gammelt);
    await page.getByRole("button", { name: "✏️ Rediger" }).click();
    await page.getByPlaceholder("Tomatsuppe…").fill(nytt);
    await page.getByRole("button", { name: "💾 Lagre endringer" }).click();
    await expect(page.getByRole("button", { name: "💾 Lagre endringer" })).toBeHidden();
    await expect.poll(async () => (await les())[id]?.name).toBe(nytt);
    const etter = (await les())[id]!;
    expect(etter).toEqual({ ...foer, name: nytt, updatedAt: expect.any(Number) });
    await page.getByRole("button", { name: "← Tilbake" }).click();
  }
  expect(await les()).not.toHaveProperty("a.servings");
  expect(feil).toEqual([]);
});

test("«Slett» som besvares etter bytte til en annen oppskrift lukker ikke den nye detaljen", async ({
  page,
}) => {
  const feil = await startKokebok(page, {
    a: legacyOppskrift("a", "Taco"),
    b: legacyOppskrift("b", "Brød"),
  });
  await aapne(page, "Taco");
  await legacyNett(page, "goOffline");
  await page.getByRole("button", { name: "🗑️ Slett" }).click();
  await page.getByRole("button", { name: "← Tilbake" }).click();
  await aapne(page, "Brød");
  await legacyNett(page, "goOnline");

  await expect.poll(async () => Object.keys(await les())).toEqual(["b"]);
  // Brød-detaljen står fortsatt.
  await expect(page.getByRole("button", { name: "✏️ Rediger" })).toBeVisible();
  await expect(page.getByText("Brød", { exact: true }).first()).toBeVisible();
  expect(feil).toEqual([]);
});

for (const ugyldig of ["/", "a/ingredients"]) {
  test(`«Bekreft middag» med ugyldig lagret recipeId ${JSON.stringify(ugyldig)}: avvises før skriving, hendelsen logges`, async ({
    page,
  }) => {
    const feil = await startPlan(
      page,
      { a: legacyOppskrift("a", "Taco"), b: reactOppskrift("Brød") },
      { type: "recipe", name: "Taco", recipeId: ugyldig },
    );
    const foer = await les();
    await bekreft(page);
    await expect(status(page)).toContainText("ugyldig id");
    expect(await bekreftelser()).toHaveLength(1);
    expect(await les()).toEqual(foer); // verken samlingen eller en undernode er skrevet
    expect(feil).toEqual([]);
  });
}

test("«Bekreft middag» med eldre numerisk recipeId treffer posten med samme nøkkel", async ({
  page,
}) => {
  const feil = await startPlan(
    page,
    { "5": { ...grunn("Taco"), id: 5 }, a: legacyOppskrift("a", "Suppe") },
    { type: "recipe", name: "Taco", recipeId: 5 },
  );
  await bekreft(page);
  await expect.poll(async () => (await les())["5"]?.timesCooked).toBe(1);
  const o = await les();
  expect(o["5"]?.id).toBe(5); // lagret numerisk id røres ikke
  expect(o.a).toEqual(legacyOppskrift("a", "Suppe"));
  expect(feil).toEqual([]);
});

test("eldre post med lagret id som kolliderer med en annen nøkkel: nodenøkkelen er identiteten", async ({
  page,
}) => {
  const feil = await startKokebok(page, {
    a: legacyOppskrift("a", "Taco"),
    k2: { ...grunn("Suppe"), id: "a" }, // lagret id avviker fra nøkkelen og kolliderer
  });
  await aapne(page, "Suppe");
  await expect(page.getByRole("button", { name: "← Tilbake" })).toBeVisible();
  await expect(page.getByText("Suppe", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Taco", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "🗑️ Slett" }).click();
  await expect.poll(async () => Object.keys(await les())).toEqual(["a"]);
  expect((await les()).a).toEqual(legacyOppskrift("a", "Taco"));
  expect(feil).toEqual([]);
});

test("redigering: utkastet kan ikke endres mens svaret venter, og det sendte lagres", async ({
  page,
}) => {
  const feil = await startKokebok(page, { a: legacyOppskrift("a", "Taco") });
  await aapne(page, "Taco");
  await page.getByRole("button", { name: "✏️ Rediger" }).click();
  const navn = page.getByPlaceholder("Tomatsuppe…");
  await navn.fill("Fredagstaco");
  await legacyNett(page, "goOffline");
  await page.getByRole("button", { name: "💾 Lagre endringer" }).click();
  // Brukeren prøver å skrive videre mens svaret venter.
  await expect(navn).toBeDisabled();
  await navn.click({ force: true });
  await page.keyboard.type(" XL");
  await expect(navn).toHaveValue("Fredagstaco");
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).a?.name).toBe("Fredagstaco");
  await expect(navn).toBeHidden(); // lukket først etter bekreftet svar
  expect(feil).toEqual([]);
});

test("«Legg til»: navn og fane kan ikke endres mens svaret venter", async ({ page }) => {
  const feil = await startKokebok(page, { a: legacyOppskrift("a", "Taco") });
  await page.getByRole("button", { name: "＋ Legg til" }).click();
  const navn = page.getByPlaceholder("Navn på retten…");
  await navn.fill("Grøt");
  await legacyNett(page, "goOffline");
  await page.getByRole("button", { name: "Lagre «Grøt»" }).click();
  await expect(navn).toBeDisabled();
  await navn.click({ force: true });
  await page.keyboard.type("XYZ");
  await page.getByRole("button", { name: /URL/ }).first().click({ force: true });
  await expect(navn).toBeVisible(); // fortsatt på hurtigfanen
  await expect(navn).toHaveValue("Grøt");
  await legacyNett(page, "goOnline");

  await expect
    .poll(async () =>
      Object.values(await les())
        .map((o) => o.name)
        .sort(),
    )
    .toEqual(["Grøt", "Taco"]);
  await expect(navn).toBeHidden();
  expect(feil).toEqual([]);
});

test("avvist av databasen (tilgang fjernet): synlig terminal avvisning, ingenting slettet", async ({
  page,
}) => {
  const feil = await startKokebok(page, { a: legacyOppskrift("a", "Taco") });
  await aapne(page, "Taco");
  await legacyNett(page, "goOffline");
  await settData(`${FAM}/members`, null);
  await page.getByRole("button", { name: "🗑️ Slett" }).click();
  await legacyNett(page, "goOnline");
  await expect(status(page)).toHaveAttribute("data-kokebok-status", "avvist");
  await expect(status(page)).toContainText("Ingenting er lagret");
  expect(Object.keys(await les())).toEqual(["a"]);
  expect(feil).toEqual([]);
});
