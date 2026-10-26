/**
 * Legacy-QA for overgangsplanen (ADR 0003, #77 review 6355434985 pkt. 2–3):
 * den UENDREDE `index.html` mot emulatoren, med gjeldende rules (grunnlinje)
 * og med forslaget `infra/firebase/forslag/handleliste-skrivemarkor.rules.json`.
 *
 * Fixturen bruker det endelige råformatet: markøren `shopping/_skriver` er
 * et vareformet objekt (`versjon: "web-v2"`, streng-`name`, `done: true`),
 * fordi legacy gjør `Object.values(shopping)` og flere legacy-stier kaller
 * `.name.toLowerCase()` på hvert element. `_ops` er MCP-metadata, og
 * `undefined` er det `_ops` blir til etter en legacy-helnodeskriving.
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

/** Legacy fanger ikke avviste skrivinger: de eneste sidefeilene skal være avvisningene. */
const bareAvvisninger = (feil: string[]) =>
  expect(feil.filter((f) => !/^PERMISSION_DENIED: Permission denied$/.test(f))).toEqual([]);

const status = (page: Page) => page.getByText(/✓ \d+ fullført · ⏱ \d+ gjenstaar/);
const avhuk = (page: Page, navn: string) =>
  page.getByText(navn, { exact: true }).locator("xpath=preceding-sibling::button[1]");
const fjern = (page: Page, navn: string) =>
  page.getByText(navn, { exact: true }).locator("xpath=following-sibling::button[1]");

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
});

test.describe("grunnlinje: gjeldende rules", () => {
  test("legacy-avhuking skriver hele noden: markør og _ops forsvinner under «undefined»", async ({
    page,
  }) => {
    const bruker = await nyFamilie(GJELDENDE, {
      _skriver: MARKOR,
      _ops: { r1: OPS_POST },
      melk: MELK,
    });
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await avhuk(page, "Melk").click();
    await expect
      .poll(
        async () => ((await lesData(SHOPPING)) as Record<string, { done?: boolean }>).melk?.done,
      )
      .toBe(true);
    const node = (await lesData(SHOPPING)) as Record<string, unknown>;
    // Elementer uten `id` (markøren og `_ops`) kolliderer under nøkkelen «undefined».
    expect(Object.keys(node).sort()).toEqual(["melk", "undefined"]);
    // Eksisterende legacy-funn: oppfølgingsskrivingen til itemHistory feiler
    // når et element uten `name` (her `_ops`) ligger i listen.
    await expect.poll(() => feil.join("\n")).toMatch(/itemHistory\.\d+\.name/);
  });
});

test.describe("poster uten id (review 5654569092 pkt. 3): 12 poster, 5 uten id", () => {
  test("gjeldende rules: én vanlig legacy-avhuking slår de 5 sammen under «undefined» — 4 poster tapes", async ({
    page,
  }) => {
    const bruker = await nyFamilie(GJELDENDE, TOLV);
    await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    // Avhuk en post MED id (Vare 07); legacy skriver likevel hele noden.
    await avhuk(page, "Vare 07").click();
    await expect
      .poll(
        async () =>
          ((await lesData(SHOPPING)) as Record<string, { done?: boolean }>)[TOLV_NOKLER[7]!]?.done,
      )
      .toBe(true);
    const node = (await lesData(SHOPPING)) as Record<string, { name: string }>;
    expect(Object.keys(node)).toHaveLength(8);
    expect(Object.keys(node)).toContain("undefined");
    for (const k of TOLV_NOKLER.slice(0, 5)) expect(node).not.toHaveProperty(k);
    for (const k of TOLV_NOKLER.slice(5)) expect(node).toHaveProperty(k);
    const overlevendeUtenId = Object.values(node)
      .map((v) => v.name)
      .filter((n) => ["Vare 00", "Vare 01", "Vare 02", "Vare 03", "Vare 04"].includes(n));
    expect(overlevendeUtenId).toHaveLength(1);
  });

  test("foreslått serververn: samme legacy-avhuking avvises, og alle rådata er bevart", async ({
    page,
  }) => {
    const node = { _skriver: MARKOR, ...TOLV };
    const bruker = await nyFamilie(FORSLAG, node);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await avhuk(page, "Vare 07").click();
    await expect.poll(() => feil.length).toBeGreaterThan(0);
    bareAvvisninger(feil);
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
    // Object.values: markør + Egg er fullført; Melk, _ops og «undefined» regnes som gjenstående.
    await expect(status(page)).toHaveText("✓ 2 fullført · ⏱ 3 gjenstaar");
    await page.screenshot({ path: "test-results/legacy-forslag-vanlig.png", fullPage: true });
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(FULL);
  });

  test("tom liste (bare markør) vises uten sidefeil", async ({ page }) => {
    const bruker = await nyFamilie(FORSLAG, { _skriver: MARKOR });
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await expect(status(page)).toHaveText("✓ 1 fullført · ⏱ 0 gjenstaar");
    await page.screenshot({ path: "test-results/legacy-forslag-tom.png", fullPage: true });
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual({ _skriver: MARKOR });
  });

  test("avhuking, fjerning og «Fjern fullførte» avvises; noden er uendret og UI-en ruller tilbake", async ({
    page,
  }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await expect(status(page)).toHaveText("✓ 2 fullført · ⏱ 3 gjenstaar");

    await avhuk(page, "Melk").click();
    await expect(status(page)).toHaveText("✓ 2 fullført · ⏱ 3 gjenstaar");
    await fjern(page, "Melk").click();
    await expect(page.getByText("Melk", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Fjern fullførte/ }).click();
    await expect(status(page)).toHaveText("✓ 2 fullført · ⏱ 3 gjenstaar");
    await expect.poll(() => feil.length).toBe(3);

    expect(await lesData(SHOPPING)).toEqual(FULL);
    bareAvvisninger(feil);
  });

  test("offline-kø: avhuking mens legacy er frakoblet avvises ved gjenoppkobling", async ({
    page,
  }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await legacyNett(page, "goOffline");
    await avhuk(page, "Melk").click();
    // Lokalt (optimistisk) er Melk nå fullført …
    await expect(status(page)).toHaveText("✓ 3 fullført · ⏱ 2 gjenstaar");
    await legacyNett(page, "goOnline");
    // … men serveren avviser den køede helnodeskrivingen, og klienten ruller tilbake.
    await expect(status(page)).toHaveText("✓ 2 fullført · ⏱ 3 gjenstaar");
    await expect.poll(() => feil.length).toBeGreaterThan(0);
    expect(await lesData(SHOPPING)).toEqual(FULL);
    bareAvvisninger(feil);
  });

  test("markør med `id` ville fulgt med legacy-skrivingen — regelen avviser derfor `_skriver/id`", async ({
    page,
  }) => {
    // Funnet i denne harnessen: med `id: "_skriver"` i markøren skriver legacy
    // den tilbake under `_skriver`, og en ren versjonssjekk ville godtatt
    // helnodeskrivingen. Endelig format har ingen `id`, og regelen krever det.
    const node = { _skriver: { ...MARKOR, id: "_skriver" }, melk: MELK };
    const bruker = await nyFamilie(FORSLAG, node);
    const feil = await aapneLegacy(page, bruker);
    await tilHandleliste(page);
    await avhuk(page, "Melk").click();
    await expect.poll(() => feil.length).toBeGreaterThan(0);
    bareAvvisninger(feil);
    expect(await lesData(SHOPPING)).toEqual(node);
  });

  test("generator uten _ops: «Legg til» avvises og noden er uendret", async ({ page }) => {
    const node = { _skriver: MARKOR, melk: MELK };
    const bruker = await nyFamilie(FORSLAG, node);
    const feil = await aapneLegacy(page, bruker);
    await page.getByRole("button", { name: "Mat", exact: true }).click();
    await page.getByRole("button", { name: /Lag handleliste/ }).click();
    await page.getByRole("button", { name: /Hent ingredienser/ }).click();
    await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
    await page.getByRole("button", { name: /Handle$/ }).click();
    await expect(page.getByText("Melk", { exact: true })).toBeVisible();
    await expect.poll(() => feil.length).toBeGreaterThan(0);
    await expect(page.getByText("Mel", { exact: true })).toHaveCount(0);
    expect(await lesData(SHOPPING)).toEqual(node);
    bareAvvisninger(feil);
  });

  test("generator med _ops/«undefined» i noden: kjent legacy-krasj før skriving, noden er uendret", async ({
    page,
  }) => {
    const bruker = await nyFamilie(FORSLAG, FULL);
    const feil = await aapneLegacy(page, bruker);
    await page.getByRole("button", { name: "Mat", exact: true }).click();
    await page.getByRole("button", { name: /Lag handleliste/ }).click();
    await page.getByRole("button", { name: /Hent ingredienser/ }).click();
    await page.getByRole("button", { name: /Legg til 1 varer/ }).click();
    await expect.poll(() => feil.length).toBeGreaterThan(0);
    expect(feil.join("\n")).toMatch(/toLowerCase/);
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
    await expect(status(page)).toHaveText("✓ 2 fullført · ⏱ 3 gjenstaar");
    // Ingen skriving forsøkt: ingen avvisninger, og noden er uendret.
    expect(feil).toEqual([]);
    expect(await lesData(SHOPPING)).toEqual(FULL);
  });

  test("generatoren med _ops/«undefined» krasjer ikke lenger: sperren stopper før oppdatereren", async ({
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
