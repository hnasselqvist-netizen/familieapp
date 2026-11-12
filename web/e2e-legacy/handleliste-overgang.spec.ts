/**
 * Legacy-QA for overgangsplanen (ADR 0003, #77 review 6355434985 pkt. 2–3):
 * `index.html` mot emulatoren, med gjeldende rules (grunnlinje) og med
 * forslaget `infra/firebase/forslag/handleliste-skrivemarkor.rules.json`.
 *
 * Fixturen bruker det endelige råformatet: markøren `shopping/_skriver` er
 * et vareformet objekt (`versjon: "web-v2"`, streng-`name`, `done: true`).
 * `_ops` er MCP-metadata, og `undefined` er det `_ops` ble til etter en
 * eldre legacy-helnodeskriving.
 *
 * Siden #20 (ordre 6817685375) skriver legacy per post. Den viser bare varer
 * (ikke reserverte nøkler eller poster uten streng-`name`), leser serverens
 * handleliste før hver skriving, og skriver ingenting når skrivermarkøren
 * finnes: da er den nye appen eneste skriver, og brukeren får en synlig
 * sperre. Serververnet i rules er uendret og gjelder fortsatt for gamle faner
 * med helnodeskriveren; det er dekket av
 * `web/src/data/handlelisteSkrivemarkor.forslag.integration.test.ts`.
 */
import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import {
  FAM,
  LEGACY_SPERRE_URL,
  aapneLegacy,
  legacyNett,
  lesData,
  nyttMedlem,
  rutLegacy,
  settData,
  settRules,
} from "./legacy-harness";

const GJELDENDE = "infra/firebase/database.rules.json";
const FORSLAG = "infra/firebase/forslag/handleliste-skrivemarkor.rules.json";

/** Endelig råformat — samme fil som rules-testene og MCP-verktøyet bruker. */
const MARKOR = JSON.parse(
  readFileSync(
    new URL("../../infra/firebase/forslag/handleliste-skrivemarkor.markor.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const OPS_POST = {
  tool: "shopping_list_add_items",
  fp: "fp",
  sub: "sub",
  uid: "uid",
  client: "c",
  at: 1,
  result: [{ status: "added", id: "m" }],
};
const MELK = {
  id: "melk",
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Meieri",
  done: false,
};
const EGG = { id: "egg", itemId: "v-egg", name: "Egg", amount: "6", cat: "Meieri", done: true };

const SHOPPING = `${FAM}/shopping`;

/**
 * Syntetisk speiling av produksjonsfunnet 26. oktober (#77 review
 * 5654569092 pkt. 3): 12 poster med UUID-nøkler, der de 5 første mangler
 * eget `id`. Ingen produksjonsdata.
 */
const TOLV_NOKLER = Array.from(
  { length: 12 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
);
const TOLV = Object.fromEntries(
  TOLV_NOKLER.map((k, i) => [
    k,
    {
      ...(i < 5 ? {} : { id: k }),
      itemId: `v-${i}`,
      name: `Vare ${String(i).padStart(2, "0")}`,
      amount: "",
      cat: "Diverse",
      done: false,
    },
  ]),
);

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

async function nyFamilie(
  rules: string,
  shopping: unknown,
): Promise<{ email: string; password: string }> {
  await settRules(rules);
  await settData(FAM, null);
  const { uke, dag } = iDag();
  await settData(FAM, {
    meta: { itemsBootstrapped: true },
    meals: { [uke]: { [dag]: "Pannekaker" } },
    mealLibrary: {
      pk: { name: "Pannekaker", shoppingBase: [{ name: "Mel", amount: "3", cat: "Tørrvarer" }] },
    },
    shopping,
  });
  return nyttMedlem();
}

async function tilHandleliste(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Mat", exact: true }).click();
  await page.getByRole("button", { name: /Handle$/ }).click();
  await expect(page.getByText("Handleliste", { exact: true })).toBeVisible();
}

const status = (page: Page) => page.getByText(/✓ \d+ fullført · ⏱ \d+ gjenstaar/);
const sperre = (page: Page) => page.locator('[data-handle-status="sperret"]');
const avhuk = (page: Page, navn: string) =>
  page.getByText(navn, { exact: true }).locator("xpath=preceding-sibling::button[1]");
const fjern = (page: Page, navn: string) =>
  page.getByText(navn, { exact: true }).locator("xpath=following-sibling::button[1]");

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
});

test.describe("grunnlinje: gjeldende rules", () => {
  test("legacy ser skrivermarkøren og skriver ingenting: markør og _ops står urørt", async ({
    page,
  }) => {
    const node = { _skriver: MARKOR, _ops: { r1: OPS_POST }, melk: MELK };
    const bruker = await nyFamilie(GJELDENDE, node);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await avhuk(page, "Melk").click();
    await expect(sperre(page)).toContainText("flyttet til den nye appen");
    await page.waitForTimeout(500);
    expect(await lesData(SHOPPING)).toEqual(node);
    expect(feil).toEqual([]);
  });
});

test.describe("poster uten id (review 5654569092 pkt. 3): 12 poster, 5 uten id", () => {
  test("gjeldende rules uten markør: legacy-avhuking endrer bare målposten — ingen poster tapes eller flyttes", async ({
    page,
  }) => {
    const bruker = await nyFamilie(GJELDENDE, TOLV);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await expect(status(page)).toHaveText("✓ 0 fullført · ⏱ 12 gjenstaar");
    await avhuk(page, "Vare 07").click();
    const k7 = TOLV_NOKLER[7]!;
    await expect
      .poll(async () => ((await lesData(SHOPPING)) as Record<string, { done?: boolean }>)[k7]?.done)
      .toBe(true);
    // Bare Vare 07 er endret; de 5 uten id-felt står under sine nøkler, uten id.
    expect(await lesData(SHOPPING)).toEqual({ ...TOLV, [k7]: { ...TOLV[k7], done: true } });
    expect(feil).toEqual([]);
  });

  test("foreslått serververn med markør: legacy forsøker ingen skriving, og alle rådata er bevart", async ({
    page,
  }) => {
    const node = { _skriver: MARKOR, ...TOLV };
    const bruker = await nyFamilie(FORSLAG, node);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await avhuk(page, "Vare 07").click();
    await expect(sperre(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(node);
  });
});

test.describe("forslag: skrivermarkør validert av rules", () => {
  const FULL = {
    _skriver: MARKOR,
    _ops: { r1: OPS_POST },
    undefined: { r0: OPS_POST },
    melk: MELK,
    egg: EGG,
  };

  test("vanlig liste med markør, _ops og «undefined» vises uten sidefeil", async ({ page }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await expect(page.getByText("Melk", { exact: true })).toBeVisible();
    // Bare varer telles: Egg er fullført og Melk gjenstår. Markør, _ops og
    // «undefined» (uten streng-name) er ikke varer.
    await expect(status(page)).toHaveText("✓ 1 fullført · ⏱ 1 gjenstaar");
    await page.screenshot({ path: "test-results/legacy-forslag-vanlig.png", fullPage: true });
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(FULL);
  });

  test("tom liste (bare markør) vises uten sidefeil", async ({ page }) => {
    const bruker = await nyFamilie(FORSLAG, { _skriver: MARKOR });
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await expect(status(page)).toHaveText("✓ 0 fullført · ⏱ 0 gjenstaar");
    await expect(page.getByText("Listen er tom")).toBeVisible();
    await page.screenshot({ path: "test-results/legacy-forslag-tom.png", fullPage: true });
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual({ _skriver: MARKOR });
  });

  test("avhuking, fjerning og «Fjern fullførte» med markør: synlig sperre, ingen skriving forsøkt, noden er uendret", async ({
    page,
  }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await expect(status(page)).toHaveText("✓ 1 fullført · ⏱ 1 gjenstaar");

    await avhuk(page, "Melk").click();
    await expect(sperre(page)).toBeVisible();
    await page.getByRole("button", { name: "Lukk" }).click();
    await fjern(page, "Melk").click();
    await expect(sperre(page)).toBeVisible();
    await page.getByRole("button", { name: "Lukk" }).click();
    await page.getByRole("button", { name: /Fjern fullførte/ }).click();
    await expect(sperre(page)).toBeVisible();
    await expect(status(page)).toHaveText("✓ 1 fullført · ⏱ 1 gjenstaar");
    await expect(page.getByText("Melk", { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(FULL);
  });

  test("frakoblet SDK: markøren leses fra serveren, og ingen skriving legges i kø", async ({
    page,
  }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await legacyNett(page, "goOffline");
    await avhuk(page, "Melk").click();
    await expect(sperre(page)).toBeVisible();
    await legacyNett(page, "goOnline");
    await page.waitForTimeout(1000);
    await expect(status(page)).toHaveText("✓ 1 fullført · ⏱ 1 gjenstaar");
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(FULL);
  });

  test("markør med `id` ville fulgt med legacy-skrivingen — regelen avviser derfor `_skriver/id`", async ({
    page,
  }) => {
    // Funnet i denne harnessen: med `id: "_skriver"` i markøren skrev den eldre
    // helnodeskriveren den tilbake under `_skriver`, og en ren versjonssjekk
    // ville godtatt det. Endelig format har ingen `id`, og regelen krever det
    // (gjelder fortsatt gamle faner). Dagens legacy ser markøren og skriver ikke.
    const node = { _skriver: { ...MARKOR, id: "_skriver" }, melk: MELK };
    const bruker = await nyFamilie(FORSLAG, node);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await avhuk(page, "Melk").click();
    await expect(sperre(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(node);
  });

  test("generator uten _ops: «Legg til» gir synlig sperre og noden er uendret", async ({
    page,
  }) => {
    const node = { _skriver: MARKOR, melk: MELK };
    const bruker = await nyFamilie(FORSLAG, node);
    const feil = await aapneLegacy(page, bruker);
    await page.getByRole("button", { name: "Mat", exact: true }).click();
    await page.getByRole("button", { name: /Lag handleliste/ }).click();
    await page.getByRole("button", { name: /Hent ingredienser/ }).click();
    await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
    await expect(sperre(page)).toBeVisible();
    await page.getByRole("button", { name: /Handle$/ }).click();
    await expect(page.getByText("Melk", { exact: true })).toBeVisible();
    await expect(page.getByText("Mel", { exact: true })).toHaveCount(0);
    expect(await lesData(SHOPPING)).toEqual(node);
    expect(feil).toEqual([]);
  });

  test("generator med _ops/«undefined» i noden: ingen krasj, synlig sperre, noden er uendret", async ({
    page,
  }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    const feil = await aapneLegacy(page, bruker);
    await page.getByRole("button", { name: "Mat", exact: true }).click();
    await page.getByRole("button", { name: /Lag handleliste/ }).click();
    await page.getByRole("button", { name: /Hent ingredienser/ }).click();
    await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
    await expect(sperre(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(FULL);
  });
});

test.describe("forslag + foreslått index.html-sperre (ADR 0003-vedlegg, midlertidig kopi)", () => {
  const FULL = {
    _skriver: MARKOR,
    _ops: { r1: OPS_POST },
    undefined: { r0: OPS_POST },
    melk: MELK,
    egg: EGG,
  };

  test("banner vises; avhuking varsler én gang og forsøker ikke å skrive", async ({ page }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    const dialoger: string[] = [];
    page.on("dialog", (d) => {
      dialoger.push(d.message());
      void d.accept();
    });
    const feil = await aapneLegacy(page, bruker, LEGACY_SPERRE_URL);
    await tilHandleliste(page);
    await expect(page.getByText("Handlelisten er flyttet til den nye appen.")).toBeVisible();
    await avhuk(page, "Melk").click();
    await fjern(page, "Melk").click();
    await expect.poll(() => dialoger.length).toBe(1);
    expect(dialoger[0]).toMatch(/flyttet til den nye appen/);
    await expect(status(page)).toHaveText("✓ 1 fullført · ⏱ 1 gjenstaar");
    // Ingen skriving forsøkt: ingen avvisninger, og noden er uendret.
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(FULL);
  });

  test("generatoren med _ops/«undefined»: sperren stopper før serverlesing og skriving", async ({
    page,
  }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    page.on("dialog", (d) => void d.accept());
    const feil = await aapneLegacy(page, bruker, LEGACY_SPERRE_URL);
    await page.getByRole("button", { name: "Mat", exact: true }).click();
    await page.getByRole("button", { name: /Lag handleliste/ }).click();
    await page.getByRole("button", { name: /Hent ingredienser/ }).click();
    await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
    await page.getByRole("button", { name: /Handle$/ }).click();
    await expect(page.getByText("Melk", { exact: true })).toBeVisible();
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(FULL);
  });
});
