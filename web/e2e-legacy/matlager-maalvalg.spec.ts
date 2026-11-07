/**
 * Legacy-Matlager «Legg til» velger målpost ved commit (#20, ordre
 * 6698904630) — ekte legacy `index.html` mot Firebase-emulatoren,
 * syntetiske data. Legacy kobles fra (`goOffline`) med sitt gamle bilde,
 * en annen klient (emulator-REST i React-form, eller en annen legacy-side)
 * skriver, og legacy-tillegget committes først ved gjenoppkobling.
 * Før rettingen valgte legacy mål fra lokal navneliste og laget ellers en
 * ny node.
 */
import { type Browser, type Page, expect, test } from "@playwright/test";
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

const FRYS = `${FAM}/freezer`;
type Batch = { id: string; count: number; unit: string; gramsPerUnit?: number };
type Post = { id?: string; itemId?: string; name: string; batches: Batch[]; [k: string]: unknown };

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

async function tilFryser(page: Page) {
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Fryser", { exact: true }).first().click();
  await expect(page.getByText("Legg til i fryseren", { exact: true })).toBeVisible();
}

async function start(page: Page, freezer: Record<string, Post>) {
  await settData(FAM, null);
  await settData(FRYS, freezer);
  const feil = await aapneLegacy(page, await nyttMedlem());
  await tilFryser(page);
  return feil;
}

async function nySide(browser: Browser) {
  const ctx = await browser.newContext();
  await rutLegacy(ctx);
  const page = await ctx.newPage();
  const feil = await aapneLegacy(page, await nyttMedlem());
  await tilFryser(page);
  return { ctx, page, feil };
}

async function leggTil(page: Page, navn: string, enhet = "stk", antall = "1") {
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill(navn);
  await page.getByRole("combobox").selectOption(enhet);
  await page.locator("input[type=number]").first().fill(antall);
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
}

const lesFrys = async () => ((await lesData(FRYS)) ?? {}) as Record<string, Post>;
const status = (page: Page) => page.locator("[data-matlager-status]");
const erter: Post = {
  itemId: "v-erter",
  name: "Erter",
  batches: [{ id: "e1", count: 2, unit: "pose" }],
  sted: "fryser",
  ukjent: { nested: true },
};

test("to legacy-sider legger samtidig til ny vare med samme navn → én post med begge tilleggene", async ({
  page,
  browser,
}) => {
  const feil = await start(page, { erter });
  const b = await nySide(browser);
  await legacyNett(page, "goOffline");
  await legacyNett(b.page, "goOffline");
  await leggTil(page, "Laks", "pk", "2");
  await leggTil(b.page, "Laks", "pk", "3");
  await legacyNett(page, "goOnline");
  await legacyNett(b.page, "goOnline");

  await expect
    .poll(async () => {
      const laks = Object.values(await lesFrys()).filter((p) => p.name === "Laks");
      return laks.map((p) => p.batches.reduce((s, x) => s + x.count, 0));
    })
    .toEqual([5]);
  const f = await lesFrys();
  expect(Object.keys(f)).toHaveLength(2);
  expect(f.erter).toEqual(erter);
  await expect(page.getByPlaceholder("f.eks. Karbonadedeig")).toHaveValue("");
  await expect(b.page.getByPlaceholder("f.eks. Karbonadedeig")).toHaveValue("");
  expect([...feil, ...b.feil]).toEqual([]);
  await b.ctx.close();
});

test("foreldet legacy-liste uten treff finner React-posten (annen itemId) → én node, nøkkel og kobling bevart", async ({
  page,
}) => {
  const feil = await start(page, { erter });
  await legacyNett(page, "goOffline");
  await leggTil(page, "Kjøttdeig", "pk", "1");
  await settData(`${FRYS}/react-node`, {
    itemId: "v-react",
    name: "kjøttdeig",
    batches: [{ id: "r1", count: 2, unit: "pk" }],
    ekstra: "bevares",
  });
  await settData(`${FRYS}/erter/batches/0/count`, 9);
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await lesFrys())["react-node"]?.batches.length).toBe(2);
  const f = await lesFrys();
  expect(Object.keys(f).sort()).toEqual(["erter", "react-node"]);
  const r = f["react-node"]!;
  expect(r.itemId).toBe("v-react");
  expect(r.id).toBeUndefined(); // React-posten får ikke id-felt
  expect(r.ekstra).toBe("bevares");
  expect(r.batches.map((x) => [x.id, x.count, x.unit])).toEqual([
    ["r1", 2, "pk"],
    [r.batches[1]!.id, 1, "pk"], // «pk» uten vekt slås ikke sammen (dagens regel)
  ]);
  expect(f.erter?.batches[0]?.count).toBe(9);
  expect(feil).toEqual([]);
});

test("flere eksisterende treff → synlig avvisning, ingen verdiendring, skjemaet beholdes", async ({
  page,
}) => {
  const data = {
    d1: { id: "d1", itemId: "v1", name: "Brød", batches: [{ id: "x", count: 1, unit: "stk" }] },
    d2: { itemId: "v2", name: "BRØD", batches: [{ id: "y", count: 1, unit: "stk" }] },
    erter,
  };
  const feil = await start(page, data);
  await expect(page.getByText("BRØD", { exact: true })).toBeVisible();
  await leggTil(page, "Brød");
  await expect(status(page)).toHaveAttribute("data-matlager-status", "konflikt");
  await expect(status(page)).toContainText("Det finnes 2 varer som heter «Brød»");
  expect(await lesFrys()).toEqual(data);
  await expect(page.getByPlaceholder("f.eks. Karbonadedeig")).toHaveValue("Brød");
  expect(feil).toEqual([]);
});

test("observert mål slettet → konflikt, ingen gjenoppliving og ingen tillegg på en annen navnelik post", async ({
  page,
}) => {
  const feil = await start(page, {
    obs: { id: "obs", itemId: "v", name: "Laks", batches: [{ id: "o", count: 1, unit: "stk" }] },
  });
  await expect(page.getByText("Laks", { exact: true })).toBeVisible();
  await legacyNett(page, "goOffline");
  await leggTil(page, "Laks");
  await settData(`${FRYS}/obs`, null);
  await settData(`${FRYS}/ny`, {
    itemId: "v2",
    name: "Laks",
    batches: [{ id: "z", count: 4, unit: "stk" }],
  });
  await legacyNett(page, "goOnline");
  await expect(status(page)).toContainText("«Laks» finnes ikke lenger");
  expect(await lesFrys()).toEqual({
    ny: { itemId: "v2", name: "Laks", batches: [{ id: "z", count: 4, unit: "stk" }] },
  });
  expect(feil).toEqual([]);
});

test("observert mål omdøpt → konflikt; tillegget havner ikke under feil vare", async ({ page }) => {
  const obs = {
    id: "obs",
    itemId: "v",
    name: "Laks",
    batches: [{ id: "o", count: 1, unit: "stk" }],
  };
  const feil = await start(page, { obs });
  await expect(page.getByText("Laks", { exact: true })).toBeVisible();
  await legacyNett(page, "goOffline");
  await leggTil(page, "Laks");
  await settData(`${FRYS}/obs/name`, "Ørret");
  await legacyNett(page, "goOnline");
  await expect(status(page)).toContainText("har fått nytt navn («Ørret»)");
  expect(await lesFrys()).toEqual({ obs: { ...obs, name: "Ørret" } });
  expect(feil).toEqual([]);
});
