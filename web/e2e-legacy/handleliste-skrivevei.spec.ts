/**
 * Legacy-Handleliste skriver per post (#20, ordre 6817685375). Testene kjører
 * ekte legacy `index.html` mot Firebase-emulatoren med syntetiske data. «Den
 * andre klienten» er emulator-REST (som React, MCP eller en annen enhet).
 *
 * Før rettingen skrev `setShopping` hele `shopping` fra lokal liste
 * (`Object.values`, nøkkel = `i.id`) ved hver handling, og deretter hele
 * `itemHistory` fra lokal historikk. En foreldet fane kunne da overskrive
 * nyere poster, gjenopplive slettede, flytte reserverte poster (`_ops`,
 * `_skriver`) og poster uten `id`-felt til nøkkelen «undefined», og
 * overskrive historikk. Metadata ble vist og telt som varer, og generatoren
 * krasjet på dem.
 */
import { readFileSync } from "node:fs";
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

const SHOPPING = `${FAM}/shopping`;
const HISTORIKK = `${FAM}/itemHistory`;
type Post = Record<string, unknown>;

const MARKOR = JSON.parse(
  readFileSync(
    new URL("../../infra/firebase/forslag/handleliste-skrivemarkor.markor.json", import.meta.url),
    "utf8",
  ),
) as Post;
const OPS = { r1: { tool: "shopping_list_add_items", at: 1, result: [{ status: "added" }] } };
const MELK: Post = {
  id: "a",
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Meieri",
  done: false,
};
const EGG: Post = {
  id: "b",
  itemId: "v-egg",
  name: "Egg",
  amount: "6",
  cat: "Meieri",
  done: false,
};

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

/** Familie med dagens middag «Pannekaker» (handlegrunnlag: 3 Mel). */
async function start(page: Page, shopping: unknown, historikk: unknown = null) {
  await settData(FAM, null);
  const { uke, dag } = iDag();
  await settData(FAM, {
    meta: { itemsBootstrapped: true, mealLibraryBootstrapped: true },
    meals: { [uke]: { [dag]: "Pannekaker" } },
    mealLibrary: {
      pk: { name: "Pannekaker", shoppingBase: [{ name: "Mel", amount: "3", cat: "Tørrvarer" }] },
    },
    items: { v1: { name: "Laks", cat: "Fisk og sjømat" } },
    shopping,
    itemHistory: historikk,
  });
  return aapneLegacy(page, await nyttMedlem());
}

async function tilHandleliste(page: Page) {
  await page.getByRole("button", { name: "Mat", exact: true }).click();
  await page.getByRole("button", { name: /Handle$/ }).click();
  await expect(page.getByText("Handleliste", { exact: true })).toBeVisible();
}
/** Åpner Plan (Mat-data lastes ved første besøk) før eventuell frakobling. */
async function tilPlan(page: Page) {
  await page.getByRole("button", { name: "Mat", exact: true }).click();
  await expect(page.getByRole("button", { name: /Lag handleliste/ })).toBeVisible();
}
async function generer(page: Page) {
  await page.getByRole("button", { name: /Lag handleliste/ }).click();
  await page.getByRole("button", { name: /Hent ingredienser/ }).click();
  await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
}
const teller = (page: Page) => page.getByText(/✓ \d+ fullført · ⏱ \d+ gjenstaar/);
const avhuk = (page: Page, navn: string) =>
  page.getByText(navn, { exact: true }).locator("xpath=preceding-sibling::button[1]");
const status = (page: Page) => page.locator("[data-handle-status]");
const les = async () => ((await lesData(SHOPPING)) ?? {}) as Record<string, Post>;

test("foreldet fane: avhuking endrer bare målposten, nyere poster står og slettede gjenoppstår ikke", async ({
  page,
}) => {
  const feil = await start(page, { a: MELK, b: EGG });
  await tilHandleliste(page);
  await expect(teller(page)).toHaveText("✓ 0 fullført · ⏱ 2 gjenstaar");
  await legacyNett(page, "goOffline");
  await settData(`${SHOPPING}/b`, null); // slettet av den andre klienten
  await settData(`${SHOPPING}/a/amount`, "2"); // nyere endring
  await settData(`${SHOPPING}/c`, { name: "Brød", amount: "", cat: "Diverse", done: false });
  await avhuk(page, "Melk").click();
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).a?.done).toBe(true);
  const o = await les();
  expect(o.a).toEqual({ ...MELK, amount: "2", done: true });
  expect(Object.keys(o).sort()).toEqual(["a", "c"]);
  expect(feil).toEqual([]);
});

test("reserverte poster vises ikke som varer og bevares byte for byte ved skriving", async ({
  page,
}) => {
  const node = {
    _ops: OPS,
    a: MELK,
    u: { name: "Uten id", amount: "", cat: "Diverse", done: false },
  };
  const feil = await start(page, node);
  await tilHandleliste(page);
  await expect(teller(page)).toHaveText("✓ 0 fullført · ⏱ 2 gjenstaar");
  await avhuk(page, "Melk").click();
  await expect.poll(async () => (await les()).a?.done).toBe(true);
  expect(await les()).toEqual({ ...node, a: { ...MELK, done: true } });
  expect(feil).toEqual([]);
});

test("skrivermarkør (ADR 0003): legacy skriver ingenting og viser at listen er flyttet", async ({
  page,
}) => {
  const node = { _skriver: MARKOR, _ops: OPS, a: MELK };
  const feil = await start(page, node);
  await tilHandleliste(page);
  await expect(teller(page)).toHaveText("✓ 0 fullført · ⏱ 1 gjenstaar");
  await avhuk(page, "Melk").click();
  await expect(status(page)).toHaveAttribute("data-handle-status", "sperret");
  await expect(status(page)).toContainText("flyttet til den nye appen");
  await page.waitForTimeout(500);
  expect(await les()).toEqual(node);
  expect(feil).toEqual([]);
});

test("Fjern fullførte sletter aldri en vare som er gjenåpnet på en annen enhet", async ({
  page,
}) => {
  const feil = await start(page, { a: { ...MELK, done: true }, b: { ...EGG, done: true } });
  await tilHandleliste(page);
  await expect(teller(page)).toHaveText("✓ 2 fullført · ⏱ 0 gjenstaar");
  await legacyNett(page, "goOffline");
  await settData(`${SHOPPING}/a/done`, false); // gjenåpnet
  await page.getByRole("button", { name: /Fjern fullførte/ }).click();
  await legacyNett(page, "goOnline");

  await expect.poll(async () => Object.keys(await les())).toEqual(["a"]);
  expect((await les()).a).toEqual(MELK);
  expect(feil).toEqual([]);
});

test("redigering skriver bare feltet på målposten; råfelt og andres nye poster står", async ({
  page,
}) => {
  const a = { ...MELK, ukjent: { x: 1 }, sammenslaing: { opId: "op1", kilder: { k: true } } };
  const feil = await start(page, { a });
  await tilHandleliste(page);
  await page.getByText("Melk", { exact: true }).click(); // åpner redigering
  await legacyNett(page, "goOffline");
  await settData(`${SHOPPING}/c`, { name: "Brød", amount: "", cat: "Diverse", done: false });
  const mengde = page.getByPlaceholder("Mengde").last();
  await mengde.fill("3");
  await mengde.press("Enter");
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).a?.amount).toBe("3");
  const o = await les();
  expect(o.a).toEqual({ ...a, amount: "3" });
  expect(o.c).toEqual({ name: "Brød", amount: "", cat: "Diverse", done: false });
  expect(feil).toEqual([]);
});

test("legg til: bare en ny node skrives; poster uten id-felt flyttes ikke, og historikken får varen", async ({
  page,
}) => {
  const u = { name: "Uten id", amount: "", cat: "Diverse", done: false };
  const feil = await start(page, { u }, { 0: { name: "Brød", cat: "Diverse" } });
  await tilHandleliste(page);
  await page.getByPlaceholder("Hva trenger du?").fill("Laks");
  await page.getByPlaceholder("Mengde").first().fill("2");
  await page.getByPlaceholder("Mengde").first().press("Enter");

  await expect.poll(async () => Object.keys(await les()).length).toBe(2);
  const o = await les();
  expect(o.u).toEqual(u);
  const [nokkel, ny] = Object.entries(o).find(([k]) => k !== "u")!;
  expect(ny).toEqual({
    id: nokkel,
    itemId: "v1",
    name: "Laks",
    amount: "2",
    cat: "Fisk og sjømat",
    done: false,
  });
  await expect
    .poll(async () => lesData(HISTORIKK))
    .toEqual([
      { name: "Brød", cat: "Diverse" },
      { name: "Laks", cat: "Fisk og sjømat" },
    ]);
  expect(feil).toEqual([]);
});

test("generator: mengdefletting bygger på fersk servertilstand og andres poster står", async ({
  page,
}) => {
  const mel = { id: "m", name: "Mel", amount: "1", cat: "Tørrvarer", done: false };
  const feil = await start(page, { m: mel });
  await tilPlan(page);
  await legacyNett(page, "goOffline");
  await settData(`${SHOPPING}/m/amount`, "2"); // nyere mengde
  await settData(`${SHOPPING}/b`, EGG);
  await generer(page);
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await les()).m?.amount).toBe("5");
  const o = await les();
  expect(o.m).toEqual({ ...mel, amount: "5" });
  expect(o.b).toEqual(EGG);
  expect(Object.keys(o).sort()).toEqual(["b", "m"]);
  expect(feil).toEqual([]);
});

test("generator: ny vare legges til, og historikken utvides uten å overskrive andres historikk", async ({
  page,
}) => {
  const feil = await start(
    page,
    { _ops: OPS, undefined: { r0: OPS.r1 }, a: MELK },
    {
      0: { name: "Laks", cat: "Fisk og sjømat" },
    },
  );
  await tilPlan(page);
  await legacyNett(page, "goOffline");
  await settData(`${HISTORIKK}/1`, { name: "Ost", cat: "Meieri" }); // en annen klient
  await generer(page);
  await legacyNett(page, "goOnline");

  await expect.poll(async () => Object.keys(await les()).length).toBe(4);
  const o = await les();
  expect(o._ops).toEqual(OPS);
  expect(o.undefined).toEqual({ r0: OPS.r1 });
  expect(o.a).toEqual(MELK);
  const [nokkel, ny] = Object.entries(o).find(([, v]) => v.name === "Mel")!;
  // `itemId: null` lagres ikke av RTDB (som før).
  expect(ny).toEqual({ id: nokkel, name: "Mel", amount: "3", cat: "Tørrvarer", done: false });
  await expect
    .poll(async () => lesData(HISTORIKK))
    .toEqual([
      { name: "Laks", cat: "Fisk og sjømat" },
      { name: "Ost", cat: "Meieri" },
      { name: "Mel", cat: "Tørrvarer" },
    ]);
  expect(feil).toEqual([]);
});

test("generator med skrivermarkør: ingen skriving, synlig sperre, ingen krasj", async ({
  page,
}) => {
  const node = { _skriver: MARKOR, _ops: OPS, undefined: { r0: OPS.r1 }, a: MELK };
  const feil = await start(page, node);
  await tilPlan(page);
  await generer(page);
  await expect(status(page)).toHaveAttribute("data-handle-status", "sperret");
  await page.waitForTimeout(500);
  expect(await les()).toEqual(node);
  expect(await lesData(HISTORIKK)).toBeNull();
  expect(feil).toEqual([]);
});

test("avvist av databasen: synlig avvisning, ingenting endret", async ({ page }) => {
  const feil = await start(page, { a: MELK });
  await tilHandleliste(page);
  await settData(`${FAM}/members`, null);
  await avhuk(page, "Melk").click();
  await expect(status(page)).toHaveAttribute("data-handle-status", "avvist");
  expect(await les()).toEqual({ a: MELK });
  expect(feil).toEqual([]);
});

test("legg til med tapt svar: ukjent utfall, og nytt forsøk lager ingen duplikat", async ({
  page,
}) => {
  const feil = await start(page, { a: MELK });
  await tilHandleliste(page);
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
      if (brutt || !/\/shopping\/[^/]+$/.test(this.toString())) return p;
      brutt = true;
      return p.then(() => {
        throw new Error("simulert brudd etter commit");
      });
    };
  });
  await page.getByPlaceholder("Hva trenger du?").fill("Laks");
  await page.getByPlaceholder("Mengde").first().fill("2");
  await page.getByRole("button", { name: "→" }).click();
  await expect(status(page)).toHaveAttribute("data-handle-status", "ukjent");
  await expect(status(page)).toContainText("kan være lagret");
  expect(Object.keys(await les())).toHaveLength(2); // serveren committet

  await page.getByRole("button", { name: "→" }).click(); // samme innsending på nytt
  await expect(status(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(Object.values(await les()).filter((p) => p.name === "Laks")).toHaveLength(1);
  expect(feil).toEqual([]);
});
