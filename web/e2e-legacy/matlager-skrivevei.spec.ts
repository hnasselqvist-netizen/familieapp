/**
 * Legacy-Matlager skriver per post (#20, ordre 6697139613) — ekte legacy
 * `index.html` mot Firebase-emulatoren, syntetiske data. Legacy kobles fra
 * (`goOffline`), «den andre klienten» (emulator-REST, som React eller en
 * annen enhet) endrer, og legacy handler fra sitt gamle bilde. Ved
 * gjenoppkobling skal ingen andres endringer gå tapt, ingen slettet post
 * gjenoppstå, og et manglende mål eller foreldet grunnlag gi synlig konflikt.
 * Før rettingen skrev legacy HELE `freezer` fra lokal liste.
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

const FRYS = `${FAM}/freezer`;
type Batch = { id: string; count: number; unit: string; gramsPerUnit?: number | null };
type Post = { id?: string; itemId: string; name: string; batches: Batch[] };

/** Legacy-opprettet post (har id-felt i noden). */
const legacyPost = (id: string, name: string, batches: Batch[]): Post => ({
  id,
  itemId: `v-${id}`,
  name,
  batches,
});
/** React-opprettet post (ingen id-felt i noden — id er nøkkelen). */
const reactPost = (id: string, name: string, batches: Batch[]): Post => ({
  itemId: `v-${id}`,
  name,
  batches,
});

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

async function startMatlager(page: Page, freezer: Record<string, Post>) {
  await settData(FAM, null);
  await settData(FRYS, freezer);
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Fryser", { exact: true }).first().click();
  await expect(page.getByText("Legg til i fryseren", { exact: true })).toBeVisible();
  return feil;
}

const kort = (page: Page, navn: string) =>
  page.getByText(navn, { exact: true }).locator("xpath=ancestor::*[.//button[text()='−']][1]");
const pluss = (page: Page, navn: string, etikett: string) =>
  kort(page, navn)
    .getByText(etikett, { exact: true })
    .locator("xpath=..")
    .getByRole("button", { name: "＋" });
const lesFrys = async () => ((await lesData(FRYS)) ?? {}) as Record<string, Post>;
const statusMelding = (page: Page) => page.locator("[data-matlager-status]");

test("foreldet legacy-side: +1 på én post bevarer andres nye, endrede og slettede poster", async ({
  page,
}) => {
  const feil = await startMatlager(page, {
    a: legacyPost("a", "Kjøttdeig", [{ id: "a1", count: 2, unit: "pk", gramsPerUnit: 400 }]),
    c: legacyPost("c", "Erter", [{ id: "c1", count: 1, unit: "pose" }]),
    r: reactPost("r", "Laks", [{ id: "r1", count: 3, unit: "stk" }]),
  });
  await expect(kort(page, "Laks")).toBeVisible();
  await legacyNett(page, "goOffline");
  // Den andre klienten:
  await settData(`${FRYS}/b`, reactPost("b", "Brød", [{ id: "b1", count: 2, unit: "stk" }]));
  await settData(`${FRYS}/c`, null);
  await settData(`${FRYS}/r/batches/0/count`, 5);
  // Legacy, fra sitt gamle bilde:
  await pluss(page, "Kjøttdeig", "2 pk à 400 g").click();
  await legacyNett(page, "goOnline");

  await expect.poll(async () => (await lesFrys()).a?.batches[0]?.count).toBe(3);
  const f = await lesFrys();
  expect(Object.keys(f).sort()).toEqual(["a", "b", "r"]); // c ikke gjenopplivet, ingen "undefined"
  expect(f.b?.name).toBe("Brød");
  expect(f.r?.batches[0]?.count).toBe(5);
  expect(f.r?.id).toBeUndefined(); // React-posten får ikke id-felt skrevet inn
  expect(feil).toEqual([]);
});

test("+1 på samme pakning som en annen klient endret: begge bevares", async ({ page }) => {
  const feil = await startMatlager(page, {
    r: reactPost("r", "Laks", [{ id: "r1", count: 2, unit: "stk" }]),
  });
  await expect(kort(page, "Laks")).toBeVisible();
  await legacyNett(page, "goOffline");
  await settData(`${FRYS}/r/batches/0/count`, 5); // andre klient: 2 → 5
  await pluss(page, "Laks", "2 stk").click(); // legacy +1 fra gammelt bilde
  await legacyNett(page, "goOnline");
  await expect.poll(async () => (await lesFrys()).r?.batches[0]?.count).toBe(6);
  expect(feil).toEqual([]);
});

test("ny pakning på eksisterende post mens en annen klient legger til: begge pakningene står", async ({
  page,
}) => {
  const feil = await startMatlager(page, {
    a: legacyPost("a", "Kjøttdeig", [{ id: "a1", count: 1, unit: "pk", gramsPerUnit: 400 }]),
  });
  await expect(kort(page, "Kjøttdeig")).toBeVisible();
  await legacyNett(page, "goOffline");
  await settData(`${FRYS}/a/batches/1`, { id: "a2", count: 2, unit: "boks" });
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("Kjøttdeig");
  await page.getByRole("combobox").selectOption("stk");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
  await legacyNett(page, "goOnline");
  await expect
    .poll(async () => (await lesFrys()).a?.batches.map((b) => b.unit).sort())
    .toEqual(["boks", "pk", "stk"]);
  expect(Object.keys(await lesFrys())).toEqual(["a"]);
  await expect(page.getByPlaceholder("f.eks. Karbonadedeig")).toHaveValue("");
  expect(feil).toEqual([]);
});

test("+1 på en post som er slettet: synlig konflikt, ingen gjenoppliving", async ({ page }) => {
  const feil = await startMatlager(page, {
    a: legacyPost("a", "Kjøttdeig", [{ id: "a1", count: 2, unit: "pk", gramsPerUnit: 400 }]),
    b: legacyPost("b", "Erter", [{ id: "b1", count: 1, unit: "pose" }]),
  });
  await expect(kort(page, "Kjøttdeig")).toBeVisible();
  await legacyNett(page, "goOffline");
  await settData(`${FRYS}/a`, null);
  await pluss(page, "Kjøttdeig", "2 pk à 400 g").click();
  await legacyNett(page, "goOnline");
  await expect(statusMelding(page)).toHaveAttribute("data-matlager-status", "konflikt");
  await expect(statusMelding(page)).toContainText("finnes ikke lenger");
  const f = await lesFrys();
  expect(Object.keys(f)).toEqual(["b"]);
  expect(feil).toEqual([]);
});

test("+1 på en pakning som er fjernet: synlig konflikt, posten uendret", async ({ page }) => {
  const feil = await startMatlager(page, {
    a: legacyPost("a", "Kjøttdeig", [
      { id: "a1", count: 2, unit: "pk", gramsPerUnit: 400 },
      { id: "a2", count: 1, unit: "boks" },
    ]),
  });
  await expect(kort(page, "Kjøttdeig")).toBeVisible();
  await legacyNett(page, "goOffline");
  await settData(`${FRYS}/a/batches`, [{ id: "a2", count: 1, unit: "boks" }]);
  await pluss(page, "Kjøttdeig", "2 pk à 400 g").click();
  await legacyNett(page, "goOnline");
  await expect(statusMelding(page)).toContainText("Pakningen av «Kjøttdeig» finnes ikke lenger");
  expect((await lesFrys()).a?.batches).toEqual([{ id: "a2", count: 1, unit: "boks" }]);
  expect(feil).toEqual([]);
});

test("ny vare når et tidligere kjent mål er slettet: legg til på slettet post gir konflikt, ikke gjenoppliving", async ({
  page,
}) => {
  const feil = await startMatlager(page, {
    a: legacyPost("a", "Kjøttdeig", [{ id: "a1", count: 1, unit: "pk", gramsPerUnit: 400 }]),
  });
  await expect(kort(page, "Kjøttdeig")).toBeVisible();
  await legacyNett(page, "goOffline");
  await settData(`${FRYS}/a`, null);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("Kjøttdeig");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
  await legacyNett(page, "goOnline");
  await expect(statusMelding(page)).toContainText("finnes ikke lenger i fryseren");
  expect(await lesFrys()).toEqual({});
  // Skjemaet beholdes ved terminal avvisning.
  await expect(page.getByPlaceholder("f.eks. Karbonadedeig")).toHaveValue("Kjøttdeig");
  expect(feil).toEqual([]);
});

test("«Fjern» fra foreldet grunnlag avvises synlig; uendret post fjernes", async ({ page }) => {
  const feil = await startMatlager(page, {
    a: legacyPost("a", "Kjøttdeig", [{ id: "a1", count: 2, unit: "pk", gramsPerUnit: 400 }]),
    r: reactPost("r", "Laks", [{ id: "r1", count: 3, unit: "stk" }]),
  });
  await expect(kort(page, "Laks")).toBeVisible();
  await legacyNett(page, "goOffline");
  await settData(`${FRYS}/a/batches/0/count`, 7);
  await page.getByRole("button", { name: "Fjern Kjøttdeig fra fryseren" }).click();
  await legacyNett(page, "goOnline");
  await expect(statusMelding(page)).toContainText("er endret på en annen enhet");
  expect((await lesFrys()).a?.batches[0]?.count).toBe(7);

  // Uendret React-post (uten id-felt) kan fjernes.
  await page.getByRole("button", { name: "Fjern Laks fra fryseren" }).click();
  await expect.poll(async () => Object.keys(await lesFrys())).toEqual(["a"]);
  expect(feil).toEqual([]);
});

test("avvist av databasen (tilgang fjernet): synlig terminal avvisning, ingenting lagret", async ({
  page,
}) => {
  const feil = await startMatlager(page, {
    a: legacyPost("a", "Kjøttdeig", [{ id: "a1", count: 2, unit: "pk", gramsPerUnit: 400 }]),
  });
  await expect(kort(page, "Kjøttdeig")).toBeVisible();
  await legacyNett(page, "goOffline");
  await settData(`${FAM}/members`, null);
  await pluss(page, "Kjøttdeig", "2 pk à 400 g").click();
  await legacyNett(page, "goOnline");
  await expect(statusMelding(page)).toHaveAttribute("data-matlager-status", "avvist");
  await expect(statusMelding(page)).toContainText("Ingenting er lagret");
  expect((await lesFrys()).a?.batches[0]?.count).toBe(2);
  expect(feil).toEqual([]);
});
