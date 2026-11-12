/**
 * Legacy-Middagsbiblioteket skriver per post (#20, ordre 6810417764). Testene
 * kjører ekte legacy `index.html` mot Firebase-emulatoren, med syntetiske data.
 * Legacy kobles fra (`goOffline`) eller holdes igjen, og «den andre klienten»
 * (emulator-REST, som React, MCP eller en annen enhet) endrer. Ved
 * gjenoppkobling skal ingen andres poster eller felt gå tapt, ingen slettet
 * post gjenoppstå, og et endret mål skal gi synlig utfall.
 *
 * Før rettingen skrev legacy HELE `mealLibrary` fra lokal state
 * (`setMealLibrary` → `dbSet`) ved oppretting, sletting og endring i
 * handlegrunnlaget, og bootstrap kunne skrive en hel samling etter en tom
 * lesing. Samme mønster som `kokebok-skrivevei.spec.ts`.
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

const BIBLIOTEK = `${FAM}/mealLibrary`;
type Post = Record<string, unknown> & { name?: string };

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

async function startBibliotek(page: Page, poster: Record<string, Post>) {
  await settData(FAM, null);
  await settData(BIBLIOTEK, poster);
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Bibliotek", { exact: true }).first().click();
  await expect(page.getByText("Middagsbibliotek", { exact: true })).toBeVisible();
  return feil;
}

const les = async () => ((await lesData(BIBLIOTEK)) ?? {}) as Record<string, Post>;
const rad = (page: Page, id: string) => page.locator(`[data-bibliotek-post="${id}"]`);
const status = (page: Page) => page.locator("[data-bibliotek-status]");

const taco: Post = {
  name: "Taco",
  ukjent: { fra: "mcp" },
  varianter: [{ id: "v1", name: "Fisketaco", ukjent: 1 }],
  shoppingBase: [
    {
      id: "s1",
      itemId: "i1",
      name: "Tortilla",
      amount: "8",
      unit: "stk",
      cat: "Bakst",
      merknad: "myke",
    },
    { id: "s2", name: "Ost", amount: "", unit: "", cat: "", ukjent: true },
  ],
};

test("ny middag fra foreldet fane: andres nye og endrede poster står, slettet post gjenoppstår ikke", async ({
  page,
}) => {
  const feil = await startBibliotek(page, {
    a: { name: "Taco" },
    d: { name: "Suppe" },
    r: { name: "Laks" },
  });
  await expect(rad(page, "d")).toBeVisible();
  await legacyNett(page, "goOffline");
  // Den andre klienten:
  await settData(`${BIBLIOTEK}/d`, null);
  await settData(`${BIBLIOTEK}/b`, { name: "Brød" });
  await settData(`${BIBLIOTEK}/r/shoppingBase`, [
    { id: "x", name: "Sitron", amount: "1", unit: "stk" },
  ]);
  await settData(`${BIBLIOTEK}/r/ukjent`, "x");
  await page.getByPlaceholder("f.eks. Kyllingsuppe").fill("Grøt");
  await page.getByRole("button", { name: "Legg til", exact: true }).click();
  await expect(page.getByPlaceholder("f.eks. Kyllingsuppe")).toBeDisabled(); // venter på svar
  await legacyNett(page, "goOnline");

  await expect
    .poll(async () => Object.values(await les()).some((p) => p.name === "Grøt"))
    .toBe(true);
  const o = await les();
  expect(Object.keys(o)).not.toContain("d");
  expect(Object.keys(o)).toEqual(expect.arrayContaining(["a", "b", "r"]));
  expect(Object.keys(o)).toHaveLength(4);
  expect(o.r).toEqual({
    name: "Laks",
    ukjent: "x",
    shoppingBase: [{ id: "x", name: "Sitron", amount: "1", unit: "stk" }],
  });
  const ny = Object.values(o).find((p) => p.name === "Grøt")!;
  expect(ny).toEqual({ name: "Grøt" });
  await expect(page.getByPlaceholder("f.eks. Kyllingsuppe")).toHaveValue("");
  expect(feil).toEqual([]);
});

test("«Slett»: endret grunnlag og allerede slettet gir synlig utfall; uendret post slettes", async ({
  page,
}) => {
  const feil = await startBibliotek(page, {
    a: { name: "Taco" },
    d: { name: "Suppe" },
    r: { name: "Laks" },
  });
  // Endret av den andre klienten etter visningen: avvises.
  await legacyNett(page, "goOffline");
  await settData(`${BIBLIOTEK}/a/ukjent`, 1);
  await rad(page, "a").getByRole("button", { name: "✕" }).click();
  await page.getByRole("button", { name: "Slett", exact: true }).click();
  await legacyNett(page, "goOnline");
  await expect(status(page)).toHaveAttribute("data-bibliotek-status", "konflikt");
  await expect(status(page)).toContainText("Ingenting er slettet");
  expect((await les()).a).toEqual({ name: "Taco", ukjent: 1 });

  // Slettet av den andre klienten: ingen gjenoppliving.
  await page.getByRole("button", { name: "Lukk" }).click();
  await legacyNett(page, "goOffline");
  await settData(`${BIBLIOTEK}/d`, null);
  await rad(page, "d").getByRole("button", { name: "✕" }).click();
  await page.getByRole("button", { name: "Slett", exact: true }).click();
  await legacyNett(page, "goOnline");
  await expect(status(page)).toContainText("var allerede slettet");
  expect(Object.keys(await les()).sort()).toEqual(["a", "r"]);

  // Uendret post slettes, de andre står.
  await page.getByRole("button", { name: "Lukk" }).click();
  await rad(page, "r").getByRole("button", { name: "✕" }).click();
  await page.getByRole("button", { name: "Slett", exact: true }).click();
  await expect.poll(async () => Object.keys(await les())).toEqual(["a"]);
  expect(feil).toEqual([]);
});

test("handlegrunnlag: endring bevarer ukjente felt, urørte varer og varianter, og andre poster", async ({
  page,
}) => {
  const feil = await startBibliotek(page, { a: taco, r: { name: "Laks" } });
  await rad(page, "a").click();
  const mengde = page.getByPlaceholder("mengde");
  await expect(mengde.first()).toHaveValue("8");
  await legacyNett(page, "goOffline");
  await settData(`${BIBLIOTEK}/r/name`, "Laks med dill"); // annen post
  await mengde.first().fill("10");
  await legacyNett(page, "goOnline");

  await expect
    .poll(
      async () => ((await les()).a?.shoppingBase as { amount?: string }[] | undefined)?.[0]?.amount,
    )
    .toBe("10");
  const o = await les();
  expect(o.a).toEqual({
    ...taco,
    shoppingBase: [
      { ...(taco.shoppingBase as object[])[0], amount: "10" },
      (taco.shoppingBase as object[])[1],
    ],
  });
  expect(o.r).toEqual({ name: "Laks med dill" });

  // Fjern en vare og skriv videre: ordnet, uten falsk konflikt.
  await page.getByRole("button", { name: "✕" }).last().click();
  await mengde.first().fill("12");
  await expect
    .poll(async () => (await les()).a?.shoppingBase)
    .toEqual([{ ...(taco.shoppingBase as object[])[0], amount: "12" }]);
  expect((await les()).a).toMatchObject({ ukjent: { fra: "mcp" }, varianter: taco.varianter });
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("handlegrunnlag fra foreldet grunnlag: synlig konflikt, utkastet står, andres endring står", async ({
  page,
}) => {
  const feil = await startBibliotek(page, { a: taco, r: { name: "Laks" } });
  await rad(page, "a").click();
  const mengde = page.getByPlaceholder("mengde");
  await expect(mengde.first()).toHaveValue("8");
  // Den andre klienten endrer samme post, og lytteren mottar det.
  await settData(`${BIBLIOTEK}/a/shoppingBase/0/amount`, "6");
  await settData(`${BIBLIOTEK}/r/name`, "Laks med dill");
  await expect(rad(page, "r")).toContainText("Laks med dill");
  await mengde.first().fill("10");

  await expect(status(page)).toHaveAttribute("data-bibliotek-status", "konflikt");
  await expect(status(page)).toContainText("endret på en annen enhet");
  await expect(mengde.first()).toHaveValue("10"); // utkastet står
  await expect(mengde.first()).toBeDisabled(); // økten er stoppet
  expect(((await les()).a?.shoppingBase as { amount?: string }[])[0]?.amount).toBe("6");
  expect(feil).toEqual([]);
});

test("bootstrap etter tom lesing overskriver ikke en post som kommer til før skrivingen", async ({
  page,
}) => {
  await settData(FAM, null); // ingen markør, tomt bibliotek
  // Hold igjen legacy sin lesing av mealLibrary til den andre klienten har skrevet.
  await page.addInitScript(() => {
    const w = globalThis as unknown as {
      firebase?: { database?: { Query?: { prototype: Record<string, unknown> } } };
      __bibliotekLest?: boolean;
      __slippBibliotek?: () => void;
    };
    let slipp: () => void = () => {};
    const port = new Promise<void>((r) => (slipp = r));
    w.__slippBibliotek = () => slipp();
    const patch = setInterval(() => {
      const proto = w.firebase?.database?.Query?.prototype;
      if (!proto) return;
      clearInterval(patch);
      const orig = proto.once as (...a: unknown[]) => Promise<unknown>;
      proto.once = function (this: { toString(): string }, ...a: unknown[]) {
        const p = orig.apply(this, a);
        if (this.toString().endsWith("/mealLibrary")) {
          w.__bibliotekLest = true;
          return p.then((v) => port.then(() => v));
        }
        return p;
      };
    }, 1);
  });
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as { __bibliotekLest?: boolean }).__bibliotekLest === true),
    )
    .toBe(true);
  // Lesingen så et tomt bibliotek. Den andre klienten oppretter en post nå.
  await settData(`${BIBLIOTEK}/b`, { name: "Fra annen klient", ukjent: 1 });
  await page.evaluate(() => (globalThis as { __slippBibliotek?: () => void }).__slippBibliotek?.());

  await expect.poll(async () => lesData(`${FAM}/meta/mealLibraryBootstrapped`)).toBe(true);
  expect(await les()).toEqual({ b: { name: "Fra annen klient", ukjent: 1 } });
  expect(feil).toEqual([]);
});

test("bootstrap på tomt bibliotek: startrepertoaret skrives, og markøren settes etterpå", async ({
  page,
}) => {
  await settData(FAM, null);
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await expect.poll(async () => lesData(`${FAM}/meta/mealLibraryBootstrapped`)).toBe(true);
  const o = await les();
  expect(Object.values(o).map((p) => p.name)).toContain("Taco");
  expect(Object.keys(o).length).toBeGreaterThan(10);
  expect(feil).toEqual([]);
});

test("«Slett»: dialogen er bundet til posten slik den var da den ble åpnet", async ({ page }) => {
  const feil = await startBibliotek(page, { a: { name: "Taco" }, r: { name: "Laks" } });
  await rad(page, "a").getByRole("button", { name: "✕" }).click();
  await expect(page.getByRole("button", { name: "Slett", exact: true })).toBeVisible();
  // Klient B endrer posten mens dialogen står åpen, og lytteren mottar det.
  await settData(`${BIBLIOTEK}/a/ukjent`, "nyere");
  await settData(`${BIBLIOTEK}/r/name`, "Laks med dill");
  await expect(rad(page, "r")).toContainText("Laks med dill");
  await page.getByRole("button", { name: "Slett", exact: true }).click();

  await expect(status(page)).toHaveAttribute("data-bibliotek-status", "konflikt");
  await expect(status(page)).toContainText("Ingenting er slettet");
  expect((await les()).a).toEqual({ name: "Taco", ukjent: "nyere" });
  expect(feil).toEqual([]);
});

test("handlegrunnlag lagret som objekt, rader uten id: lagringsnøkler og urørte rader står", async ({
  page,
}) => {
  const post: Post = {
    name: "Taco",
    shoppingBase: {
      k1: { name: "Tortilla", amount: "8", unit: "stk" },
      k2: { name: "Ost", amount: "", ukjent: 1 },
      k3: { name: "Salsa", amount: "1", merknad: "sterk" },
    },
  };
  const feil = await startBibliotek(page, { a: post });
  await rad(page, "a").click();
  const k1 = page.locator('[data-vare-nokkel="k1"]');
  await expect(k1.getByPlaceholder("mengde")).toHaveValue("8");
  await k1.getByPlaceholder("mengde").fill("10");
  await expect
    .poll(
      async () =>
        ((await les()).a?.shoppingBase as Record<string, { amount?: string }>)?.k1?.amount,
    )
    .toBe("10");
  expect((await les()).a).toEqual({
    name: "Taco",
    shoppingBase: {
      k1: { name: "Tortilla", amount: "10", unit: "stk" },
      k2: { name: "Ost", amount: "", ukjent: 1 },
      k3: { name: "Salsa", amount: "1", merknad: "sterk" },
    },
  });
  // Fjern k2: bare den nøkkelen forsvinner.
  await page.locator('[data-vare-nokkel="k2"]').getByRole("button", { name: "✕" }).click();
  await expect
    .poll(async () => Object.keys(((await les()).a?.shoppingBase as object) ?? {}).sort())
    .toEqual(["k1", "k3"]);
  expect(((await les()).a?.shoppingBase as Record<string, unknown>).k3).toEqual({
    name: "Salsa",
    amount: "1",
    merknad: "sterk",
  });
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("handlegrunnlag med duplikat-id: endringen treffer bare den ene raden", async ({ page }) => {
  const post: Post = {
    name: "Taco",
    shoppingBase: [
      { id: "d", name: "A", amount: "1" },
      { id: "d", name: "B", amount: "2", ukjent: true },
      { name: "C", amount: "3" },
    ],
  };
  const feil = await startBibliotek(page, { a: post });
  await rad(page, "a").click();
  await page.locator('[data-vare-nokkel="1"]').getByPlaceholder("mengde").fill("20");
  await expect
    .poll(async () => ((await les()).a?.shoppingBase as { amount?: string }[])?.[1]?.amount)
    .toBe("20");
  expect((await les()).a?.shoppingBase).toEqual([
    { id: "d", name: "A", amount: "1" },
    { id: "d", name: "B", amount: "20", ukjent: true },
    { name: "C", amount: "3" },
  ]);
  expect(feil).toEqual([]);
});

test("handlegrunnlag i uventet form: synlig stopp før skriving, ingenting endres", async ({
  page,
}) => {
  const feil = await startBibliotek(page, { a: { name: "Taco", shoppingBase: "rar verdi" } });
  await rad(page, "a").click();
  await expect(status(page)).toContainText("ikke kan redigeres trygt");
  await expect(page.getByPlaceholder("Legg til vare…")).toBeDisabled();
  expect((await les()).a).toEqual({ name: "Taco", shoppingBase: "rar verdi" });
  expect(feil).toEqual([]);
});

test("bootstrap med uventet råverdi i mealLibrary: urørt og uten ferdigmarkør", async ({
  page,
}) => {
  await settData(FAM, null);
  await settData(BIBLIOTEK, "rar verdi");
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  // Varebase-bootstrapen leser også mealLibrary og setter sin markør; vent på den.
  await expect.poll(async () => lesData(`${FAM}/meta/itemsBootstrapped`)).toBe(true);
  await page.waitForTimeout(500);
  expect(await lesData(BIBLIOTEK)).toBe("rar verdi");
  expect(await lesData(`${FAM}/meta/mealLibraryBootstrapped`)).toBeNull();
  expect(feil).toEqual([]);
});

test("handlegrunnlag i liste: sletting av midtraden flytter ingen nøkler, og neste endring treffer riktig rad", async ({
  page,
}) => {
  const post: Post = {
    name: "Taco",
    shoppingBase: [
      { name: "A", amount: "1" },
      { name: "B", amount: "2", ukjent: 1 },
      { name: "C", amount: "3", merknad: "x" },
    ],
  };
  const feil = await startBibliotek(page, { a: post });
  await rad(page, "a").click();
  await page.locator('[data-vare-nokkel="1"]').getByRole("button", { name: "✕" }).click();
  await expect(page.locator('[data-vare-nokkel="1"]')).toHaveCount(0);
  await page.locator('[data-vare-nokkel="2"]').getByPlaceholder("mengde").fill("30");
  await expect.poll(async () => lesData(`${BIBLIOTEK}/a/shoppingBase/2/amount`)).toBe("30");
  // Rånøklene: 0 og 2 står, 1 er borte, ingenting er flyttet.
  expect(await lesData(`${BIBLIOTEK}/a/shoppingBase/0`)).toEqual({ name: "A", amount: "1" });
  expect(await lesData(`${BIBLIOTEK}/a/shoppingBase/1`)).toBeNull();
  expect(await lesData(`${BIBLIOTEK}/a/shoppingBase/2`)).toEqual({
    name: "C",
    amount: "30",
    merknad: "x",
  });
  await expect(status(page)).toHaveCount(0);

  // Handlelistegeneratoren tar med de gjenværende varene fra den lagrede formen.
  const varer = await page.evaluate(async (sti) => {
    const g = globalThis as unknown as {
      firebase: {
        database: () => {
          ref: (s: string) => { once: (e: string) => Promise<{ val(): unknown }> };
        };
      };
      resolveMealShoppingItems: (
        m: unknown,
        r: unknown[],
        l: unknown[],
      ) => { name: string; amount: string }[];
    };
    const val = (await g.firebase.database().ref(sti).once("value")).val() as object;
    return g
      .resolveMealShoppingItems(
        { type: "recipe", name: "Taco", recipeId: null },
        [],
        [{ ...val, id: "a" }],
      )
      .map((v) => `${v.name}:${v.amount}`);
  }, `${BIBLIOTEK}/a`);
  expect(varer).toEqual(["A:1", "C:30"]);
  expect(feil).toEqual([]);
});

test("samling med numeriske biblioteknøkler: riktig post åpnes og endres, naboposter står", async ({
  page,
}) => {
  const feil = await startBibliotek(page, {
    "0": { name: "Grøt", ukjent: 0 },
    "1": { name: "Lasagne", shoppingBase: [{ name: "Pasta", amount: "1" }] },
    "2": { name: "Wok", ukjent: 2 },
  });
  await expect(rad(page, "0")).toContainText("Grøt");
  await expect(rad(page, "2")).toContainText("Wok");
  await rad(page, "1").click();
  await expect(page.getByPlaceholder("mengde").first()).toHaveValue("1");
  await page.getByPlaceholder("mengde").first().fill("2");
  await expect.poll(async () => lesData(`${BIBLIOTEK}/1/shoppingBase/0/amount`)).toBe("2");
  expect(await lesData(`${BIBLIOTEK}/0`)).toEqual({ name: "Grøt", ukjent: 0 });
  expect(await lesData(`${BIBLIOTEK}/2`)).toEqual({ name: "Wok", ukjent: 2 });
  expect(await lesData(`${BIBLIOTEK}/1`)).toEqual({
    name: "Lasagne",
    shoppingBase: [{ name: "Pasta", amount: "2" }],
  });
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("avvist av databasen (tilgang fjernet): synlig avvisning, ingenting slettet", async ({
  page,
}) => {
  const feil = await startBibliotek(page, { a: { name: "Taco" } });
  await legacyNett(page, "goOffline");
  await settData(`${FAM}/members`, null);
  await rad(page, "a").getByRole("button", { name: "✕" }).click();
  await page.getByRole("button", { name: "Slett", exact: true }).click();
  await legacyNett(page, "goOnline");
  await expect(status(page)).toHaveAttribute("data-bibliotek-status", "avvist");
  expect(await les()).toEqual({ a: { name: "Taco" } });
  expect(feil).toEqual([]);
});
