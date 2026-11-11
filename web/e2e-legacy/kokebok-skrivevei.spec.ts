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
  await legacyNett(page, "goOnline");

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

test("redigering fra foreldet grunnlag: synlig konflikt, ingenting overskrives", async ({
  page,
}) => {
  const feil = await startKokebok(page, { a: legacyOppskrift("a", "Taco") });
  await aapne(page, "Taco");
  await legacyNett(page, "goOffline");
  await settData(`${OPPSKRIFTER}/a/ingredients/0/amount`, "800 g");
  const foer = (await les()).a;
  await page.getByRole("button", { name: "✏️ Rediger" }).click();
  await page.getByPlaceholder("Tomatsuppe…").fill("Fredagstaco");
  await page.getByRole("button", { name: "💾 Lagre endringer" }).click();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-kokebok-status", "konflikt");
  await expect(status(page)).toContainText("er endret på en annen enhet");
  expect((await les()).a).toEqual(foer);
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
  await settData(FAM, null);
  await settData(OPPSKRIFTER, { a: legacyOppskrift("a", "Taco"), b: reactOppskrift("Brød") });
  const feil = await aapneLegacy(page, await nyttMedlem());
  const { uke, dag } = await page.evaluate(() => {
    const g = globalThis as unknown as {
      getWeekKey: (d: Date) => string;
      DAYS?: string[];
    };
    const dager = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return { uke: g.getWeekKey(new Date()), dag: dager[(new Date().getDay() + 6) % 7]! };
  });
  await settData(`${FAM}/meals/${uke}/${dag}`, { type: "recipe", name: "Taco", recipeId: "a" });
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Plan", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "✓ Bekreft" })).toBeVisible();

  await legacyNett(page, "goOffline");
  // Den andre klienten har allerede bekreftet én gang og lagt til et felt.
  await settData(`${OPPSKRIFTER}/a/timesCooked`, 3);
  await settData(`${OPPSKRIFTER}/a/ukjent`, "x");
  await page.getByRole("button", { name: "✓ Bekreft" }).click();
  await page.getByRole("button", { name: "✓ Ja" }).click();
  await page.getByRole("button", { name: /Fungerte fint/ }).click();
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).a?.timesCooked).toBe(4);
  const o = await les();
  expect(o.a).toMatchObject({ name: "Taco", ukjent: "x", lastCooked: expect.any(Number) });
  expect(Object.keys(o).sort()).toEqual(["a", "b"]);
  expect(o.b).not.toHaveProperty("id");
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
