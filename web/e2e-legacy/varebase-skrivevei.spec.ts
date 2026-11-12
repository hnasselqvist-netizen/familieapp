/**
 * Legacy-varebasen: serverforankret finn/opprett (#20, ordre 6813547091).
 * Testene kjører ekte legacy `index.html` mot Firebase-emulatoren, med
 * syntetiske data. «Den andre klienten» er emulator-REST (som React, MCP eller
 * en annen enhet).
 *
 * Før rettingen erstattet `finnEllerOpprettVare` hele `items` fra lokal
 * tilstand ved hver ny vare (Kokebok, Middagsbibliotek, Handleliste, Fryser),
 * og `bootstrapItems` kunne skrive en hel samling etter en tom lesing. En
 * foreldet fane kunne da overskrive nyere varer eller gjenopplive slettede.
 */
import { type Page, expect, test } from "@playwright/test";
import {
  FAM,
  aapneLegacy,
  legacyNett,
  lesData,
  lesEksport,
  nyttMedlem,
  rutLegacy,
  settData,
  settRules,
} from "./legacy-harness";

const VARER = `${FAM}/items`;
type Vare = Record<string, unknown> & { name?: string };

test.beforeEach(async ({ context }) => {
  await rutLegacy(context);
  await settRules("infra/firebase/database.rules.json");
});

async function start(page: Page, varer: Record<string, Vare>, ekstra?: () => Promise<void>) {
  await settData(FAM, null);
  await settData(VARER, varer);
  await settData(`${FAM}/meta/itemsBootstrapped`, true);
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  if (ekstra) await ekstra();
  return aapneLegacy(page, await nyttMedlem());
}

const les = async () => ((await lesData(VARER)) ?? {}) as Record<string, Vare>;
const status = (page: Page) => page.locator("[data-vare-status]");

async function tilFryser(page: Page) {
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Fryser", { exact: true }).first().click();
  await expect(page.getByText("Legg til i fryseren", { exact: true })).toBeVisible();
}

async function aapneBibliotekpost(page: Page) {
  await page.getByText("Mat", { exact: true }).first().click();
  await page.getByText("Bibliotek", { exact: true }).first().click();
  await page.locator('[data-bibliotek-post="p"]').click();
  await expect(page.getByPlaceholder("Legg til vare…")).toBeVisible();
}

async function opprettIVelger(page: Page, navn: string) {
  await page.getByPlaceholder("Legg til vare…").fill(navn);
  await page.getByText(`＋ Opprett «${navn}»`).click();
  await page.getByRole("button", { name: "Ost og meieri", exact: true }).click();
}

test("foreldet fane: oppretting overskriver ikke nyere varer og gjenoppliver ikke slettede", async ({
  page,
}) => {
  const feil = await start(
    page,
    { d: { name: "Brød", cat: "Brød og bakst" }, r: { name: "Laks", cat: "Fisk og sjømat" } },
    async () => settData(`${FAM}/mealLibrary/p`, { name: "Taco" }),
  );
  await aapneBibliotekpost(page);
  await legacyNett(page, "goOffline");
  // Den andre klienten sletter én vare og endrer en annen.
  await settData(`${VARER}/d`, null);
  await settData(`${VARER}/r/ukjent`, "nyere");
  await opprettIVelger(page, "Melk"); // venter til fanen er tilkoblet igjen
  await legacyNett(page, "goOnline");

  await expect
    .poll(async () => Object.values(await les()).some((v) => v.name === "Melk"))
    .toBe(true);
  const o = await les();
  expect(Object.keys(o)).not.toContain("d"); // ikke gjenopplivet
  expect(o.r).toEqual({ name: "Laks", cat: "Fisk og sjømat", ukjent: "nyere" });
  expect(Object.keys(o)).toHaveLength(2);
  const [nokkel] = Object.entries(o).find(([, v]) => v.name === "Melk")!;
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe(nokkel);
  expect(feil).toEqual([]);
});

test("foreldet fane, fritekst: varen som er slettet på serveren gjenopplives ikke, og oppslaget gjøres mot serveren", async ({
  page,
}) => {
  const feil = await start(page, {
    m1: { name: "Kjøttdeig", cat: "Kjøtt" },
    x: { name: "Laks", cat: "Fisk og sjømat" },
  });
  await tilFryser(page);
  await legacyNett(page, "goOffline");
  await settData(`${VARER}/m1`, null); // slettet av den andre klienten
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("Kjøttdeig");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
  await legacyNett(page, "goOnline");

  // Fritekst: serveren har ingen «Kjøttdeig», så det blir en NY vare på en ny
  // nøkkel. Den slettede noden gjenopplives ikke, og Laks er urørt.
  await expect
    .poll(async () => Object.keys((await lesData(`${FAM}/freezer`)) ?? {}).length)
    .toBe(1);
  const o = await les();
  expect(Object.keys(o)).not.toContain("m1");
  expect(o.x).toEqual({ name: "Laks", cat: "Fisk og sjømat" });
  const [ny] = Object.entries(o).find(([, v]) => v.name === "Kjøttdeig")!;
  const post = Object.values(
    (await lesData(`${FAM}/freezer`)) as Record<string, { itemId: string }>,
  );
  expect(post.map((p) => p.itemId)).toEqual([ny]);
  expect(feil).toEqual([]);
});

test("ny vare skrives bare til en ny node, og kalleren kobler til den bekreftede nøkkelen", async ({
  page,
}) => {
  const feil = await start(
    page,
    { r: { name: "Laks", cat: "Fisk og sjømat", ukjent: 1 } },
    async () => settData(`${FAM}/mealLibrary/p`, { name: "Taco" }),
  );
  await aapneBibliotekpost(page);
  await opprettIVelger(page, "Melk");

  await expect
    .poll(async () => Object.values(await les()).some((v) => v.name === "Melk"))
    .toBe(true);
  const o = await les();
  const [nokkel, melk] = Object.entries(o).find(([, v]) => v.name === "Melk")!;
  expect(melk).toEqual({ name: "Melk", cat: "Ost og meieri" });
  expect(o.r).toEqual({ name: "Laks", cat: "Fisk og sjømat", ukjent: 1 });
  expect(Object.keys(o)).toHaveLength(2);
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe(nokkel);
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("finn: normalisert navnetreff gir den bekreftede varen med nodenøkkel, uten ny vare", async ({
  page,
}) => {
  const feil = await start(page, {
    m1: { name: "Kjøttdeig", cat: "Kjøtt", ukjent: 1 },
    x: { name: "Laks", cat: "Fisk og sjømat" },
  });
  await tilFryser(page);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("  kjøttdeig ");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();

  await expect
    .poll(async () =>
      Object.values(
        ((await lesData(`${FAM}/freezer`)) ?? {}) as Record<string, { itemId?: string }>,
      ).map((p) => p.itemId),
    )
    .toEqual(["m1"]);
  expect(await les()).toEqual({
    m1: { name: "Kjøttdeig", cat: "Kjøtt", ukjent: 1 },
    x: { name: "Laks", cat: "Fisk og sjømat" },
  });
  expect(feil).toEqual([]);
});

test("finn: flere varer med samme navn gir synlig konflikt og ingen kobling", async ({ page }) => {
  const feil = await start(page, {
    m1: { name: "Kjøttdeig", cat: "Kjøtt" },
    m2: { name: "kjøttdeig", cat: "Kjøtt" },
  });
  await tilFryser(page);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("Kjøttdeig");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();

  await expect(page.locator("[data-matlager-status]")).toContainText("2 varer");
  await page.waitForTimeout(500);
  expect(await lesData(`${FAM}/freezer`)).toBeNull();
  expect(Object.keys(await les()).sort()).toEqual(["m1", "m2"]);
  expect(feil).toEqual([]);
});

test("avvist av databasen: synlig avvisning, ingen vare opprettet eller koblet", async ({
  page,
}) => {
  const feil = await start(page, { r: { name: "Laks", cat: "Fisk og sjømat" } }, async () =>
    settData(`${FAM}/mealLibrary/p`, { name: "Taco" }),
  );
  await aapneBibliotekpost(page);
  await settData(`${FAM}/members`, null);
  await opprettIVelger(page, "Melk");
  await expect(status(page)).toHaveAttribute("data-vare-status", "avvist");
  expect(await les()).toEqual({ r: { name: "Laks", cat: "Fisk og sjømat" } });
  expect(await lesData(`${FAM}/mealLibrary/p`)).toEqual({ name: "Taco" });
  expect(feil).toEqual([]);
});

test("bootstrap etter tom lesing overskriver ikke en vare som kommer til før skrivingen", async ({
  page,
}) => {
  await settData(FAM, null); // ingen markør, tom varebase
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  await settData(`${FAM}/freezer/f1`, { name: "Laks", batches: [] });
  await page.addInitScript(() => {
    const w = globalThis as unknown as {
      firebase?: { database?: { Query?: { prototype: Record<string, unknown> } } };
      __varerLest?: boolean;
      __slippVarer?: () => void;
    };
    let slipp: () => void = () => {};
    const port = new Promise<void>((r) => (slipp = r));
    w.__slippVarer = () => slipp();
    const patch = setInterval(() => {
      const proto = w.firebase?.database?.Query?.prototype;
      if (!proto) return;
      clearInterval(patch);
      const orig = proto.once as (...a: unknown[]) => Promise<unknown>;
      proto.once = function (this: { toString(): string }, ...a: unknown[]) {
        const p = orig.apply(this, a);
        if (this.toString().endsWith("/items")) {
          w.__varerLest = true;
          return p.then((v) => port.then(() => v));
        }
        return p;
      };
    }, 1);
  });
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as { __varerLest?: boolean }).__varerLest === true))
    .toBe(true);
  await settData(`${VARER}/b`, { name: "Fra annen klient", cat: "Diverse", ukjent: 1 });
  await page.evaluate(() => (globalThis as { __slippVarer?: () => void }).__slippVarer?.());

  await expect.poll(async () => lesData(`${FAM}/meta/itemsBootstrapped`)).toBe(true);
  expect(await les()).toEqual({ b: { name: "Fra annen klient", cat: "Diverse", ukjent: 1 } });
  expect(feil).toEqual([]);
});

test("bootstrap på tom varebase seeder fra kildene og setter markøren etterpå", async ({
  page,
}) => {
  await settData(FAM, null);
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  await settData(`${FAM}/freezer/f1`, { name: "Laks", batches: [] });
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await expect.poll(async () => lesData(`${FAM}/meta/itemsBootstrapped`)).toBe(true);
  expect(Object.values(await les())).toEqual([{ name: "Laks", cat: "Diverse" }]);
  expect(feil).toEqual([]);
});

test("bootstrap med uventet råverdi i items: urørt og uten ferdigmarkør", async ({ page }) => {
  await settData(FAM, null);
  await settData(`${FAM}/meta/mealLibraryBootstrapped`, true);
  await settData(VARER, "rar verdi");
  const feil = await aapneLegacy(page, await nyttMedlem());
  await page.getByText("Mat", { exact: true }).first().click();
  await expect(page.getByText("Fryser", { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await lesData(VARER)).toBe("rar verdi");
  expect(await lesData(`${FAM}/meta/itemsBootstrapped`)).toBeNull();
  expect(feil).toEqual([]);
});

// ── Review 5869325527 ───────────────────────────────────────────────────

type Proto = { prototype: Record<string, unknown> };
/** Patcher transaksjoner på én vare-node (`items/{nøkkel}`), ikke på `items`. */
async function patchVareNode(page: Page, modus: "tapt" | "hold") {
  await page.evaluate((m) => {
    const w = globalThis as unknown as {
      firebase: { database: { Reference: Proto } };
      __slippVare?: () => void;
      __vareKall?: number;
    };
    const proto = w.firebase.database.Reference.prototype;
    const orig = proto.transaction as (...a: unknown[]) => Promise<unknown>;
    let slipp: () => void = () => {};
    const port = new Promise<void>((r) => (slipp = r));
    w.__slippVare = () => slipp();
    w.__vareKall = 0;
    let brutt = false;
    proto.transaction = function (this: { toString(): string }, ...a: unknown[]) {
      if (!/\/items\/[^/]+$/.test(this.toString())) return orig.apply(this, a);
      w.__vareKall = (w.__vareKall ?? 0) + 1;
      if (m === "hold") return port.then(() => orig.apply(this, a));
      const p = orig.apply(this, a);
      if (brutt) return p;
      brutt = true;
      return p.then(() => {
        throw new Error("simulert brudd etter commit");
      });
    };
  }, modus);
}
const slippVare = (page: Page) =>
  page.evaluate(() => (globalThis as { __slippVare?: () => void }).__slippVare?.());
const vareKall = (page: Page) =>
  page.evaluate(() => (globalThis as { __vareKall?: number }).__vareKall ?? 0);
const leggTilFelt = (page: Page) => page.getByPlaceholder("Legg til vare…");
const TACO = async () => settData(`${FAM}/mealLibrary/p`, { name: "Taco" });

test("eksplisitt valg i Middagsbibliotek: valgt vare slettet på serveren gir konflikt, ingen kobling og ingen fallback", async ({
  page,
}) => {
  const feil = await start(
    page,
    { m1: { name: "Kjøttdeig", cat: "Kjøtt" }, x: { name: "Laks", cat: "Fisk og sjømat" } },
    TACO,
  );
  await aapneBibliotekpost(page);
  await legacyNett(page, "goOffline");
  await settData(`${VARER}/m1`, null); // slettet av den andre klienten
  // Fanen er foreldet: den valgte varen står fortsatt i listen.
  await leggTilFelt(page).fill("Kjøtt");
  await page.locator('[data-vare-valg="m1"]').click();
  await legacyNett(page, "goOnline");

  await expect(status(page)).toHaveAttribute("data-vare-status", "konflikt");
  await expect(status(page)).toContainText("finnes ikke lenger");
  await page.waitForTimeout(500);
  expect(await lesData(`${FAM}/mealLibrary/p`)).toEqual({ name: "Taco" }); // ingen kobling
  expect(await les()).toEqual({ x: { name: "Laks", cat: "Fisk og sjømat" } }); // ingen ny vare
  expect(feil).toEqual([]);
});

const TO_LIKE = {
  m1: { name: "Kjøttdeig", cat: "Kjøtt" },
  m2: { name: "kjøttdeig", cat: "Kjøtt", ukjent: 1 },
};
const fryserItemIds = async () =>
  Object.values(
    ((await lesData(`${FAM}/freezer`)) ?? {}) as Record<string, { itemId?: string }>,
  ).map((p) => p.itemId);

test("eksplisitt valg: to varer med samme navn, valgt nøkkel kobles i Middagsbibliotek", async ({
  page,
}) => {
  const feil = await start(page, TO_LIKE, TACO);
  await aapneBibliotekpost(page);
  await leggTilFelt(page).fill("kjøtt");
  await page.locator('[data-vare-valg="m2"]').click();
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe("m2");
  await expect(status(page)).toHaveCount(0);
  expect(Object.keys(await les()).sort()).toEqual(["m1", "m2"]);
  expect(feil).toEqual([]);
});

test("eksplisitt valg: to varer med samme navn, valgt nøkkel kobles i Fryser uten konflikt", async ({
  page,
}) => {
  const feil = await start(page, TO_LIKE);
  await tilFryser(page);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("Kjøtt");
  await page.locator('[data-vare-valg="m1"]').click();
  await expect(page.getByPlaceholder("f.eks. Karbonadedeig")).toHaveValue("Kjøttdeig");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
  await expect.poll(fryserItemIds).toEqual(["m1"]);
  expect(Object.keys(await les()).sort()).toEqual(["m1", "m2"]);
  expect(feil).toEqual([]);
});

const NUMERISK = {
  "0": { name: "Melk", cat: "Ost og meieri" },
  "1": { name: "Laks", cat: "Fisk og sjømat", ukjent: 1 },
};

test("numeriske nodenøkler: varen vises og eksplisitt valg kobles med sin nøkkel", async ({
  page,
}) => {
  const feil = await start(page, NUMERISK, TACO);
  await aapneBibliotekpost(page);
  await leggTilFelt(page).fill("Lak");
  await page.locator('[data-vare-valg="1"]').click();
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe("1");
  expect(await lesData(VARER)).toEqual([NUMERISK["0"], NUMERISK["1"]]); // fortsatt numerisk
  expect(feil).toEqual([]);
});

test("numeriske nodenøkler: fritekst finner varen med sin nøkkel, uten ny vare", async ({
  page,
}) => {
  const feil = await start(page, NUMERISK);
  await tilFryser(page);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill(" melk");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
  await expect.poll(fryserItemIds).toEqual(["0"]);
  expect(await lesData(VARER)).toEqual([NUMERISK["0"], NUMERISK["1"]]);
  expect(feil).toEqual([]);
});

test("fritekst i foreldet fane: varen en annen klient opprettet, finnes på serveren, ingen duplikat", async ({
  page,
}) => {
  const feil = await start(page, { r: { name: "Laks", cat: "Fisk og sjømat" } }, TACO);
  await aapneBibliotekpost(page);
  await legacyNett(page, "goOffline");
  await settData(`${VARER}/andre`, { name: "melk", cat: "Ost og meieri", ukjent: 1 });
  await opprettIVelger(page, "Melk"); // fanen kjenner ikke «melk»
  await legacyNett(page, "goOnline");

  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe("andre");
  expect(Object.keys(await les()).sort()).toEqual(["andre", "r"]);
  expect((await les()).andre).toEqual({ name: "melk", cat: "Ost og meieri", ukjent: 1 });
  expect(feil).toEqual([]);
});

test("oppretting med tapt svar: ukjent utfall sier at varen kan finnes, ingen kobling; nytt forsøk kobler til den", async ({
  page,
}) => {
  const feil = await start(page, { r: { name: "Laks", cat: "Fisk og sjømat" } }, TACO);
  await aapneBibliotekpost(page);
  await patchVareNode(page, "tapt");
  await opprettIVelger(page, "Melk");

  await expect(status(page)).toHaveAttribute("data-vare-status", "ukjent");
  await expect(status(page)).toContainText("kan finnes i varebasen");
  await expect(status(page)).toContainText("Ingenting er koblet");
  await expect(status(page)).not.toContainText("Ingen vare er opprettet");
  expect(await lesData(`${FAM}/mealLibrary/p`)).toEqual({ name: "Taco" }); // ingen kobling
  const etter = await les();
  const [nokkel] = Object.entries(etter).find(([, v]) => v.name === "Melk")!; // serveren committet
  expect(Object.keys(etter)).toHaveLength(2);

  // Nytt forsøk finner den committede varen på serveren og lager ingen ny.
  await page.getByRole("button", { name: "Ost og meieri", exact: true }).click();
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe(nokkel);
  expect(Object.keys(await les())).toHaveLength(2);
  expect(feil).toEqual([]);
});

test("ventende oppretting: dobbeltklikk gir ett forsøk, og et sent svar etter Avbryt og ny inntasting kobler ingenting", async ({
  page,
}) => {
  const feil = await start(page, { r: { name: "Laks", cat: "Fisk og sjømat" } }, TACO);
  await aapneBibliotekpost(page);
  await patchVareNode(page, "hold");
  await leggTilFelt(page).fill("Melk");
  await page.getByText("＋ Opprett «Melk»").click();
  // To klikk i samme hendelsesløkke, før React rekker å sperre knappen.
  await page.evaluate(() => {
    const knapp = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Ost og meieri",
    )!;
    knapp.click();
    knapp.click();
  });
  await expect(page.locator('[data-vare-venter="ja"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Ost og meieri", exact: true })).toBeDisabled();
  await expect.poll(() => vareKall(page)).toBe(1); // oppretting startet etter oppslaget

  await page.getByRole("button", { name: "Avbryt", exact: true }).click();
  await leggTilFelt(page).fill("Ost");
  await slippVare(page); // det sene svaret kommer nå

  await expect
    .poll(async () => Object.values(await les()).filter((v) => v.name === "Melk").length)
    .toBe(1); // ett forsøk, ikke to
  await page.waitForTimeout(500);
  expect(await vareKall(page)).toBe(1);
  await expect(leggTilFelt(page)).toHaveValue("Ost"); // nyere utkast står
  expect(await lesData(`${FAM}/mealLibrary/p`)).toEqual({ name: "Taco" }); // ingen kobling
  await expect(status(page)).toHaveCount(0);
  expect(feil).toEqual([]);
});

test("grense: committet oppretting beviser bare at nøkkelen var ledig; samtidig likt navn gir to varer, ingenting overskrevet", async ({
  page,
}) => {
  const feil = await start(page, { r: { name: "Laks", cat: "Fisk og sjømat" } }, TACO);
  await aapneBibliotekpost(page);
  await patchVareNode(page, "hold");
  await opprettIVelger(page, "Melk"); // oppslaget er gjort og bekreftet: ingen «Melk»
  await expect.poll(() => vareKall(page)).toBe(1);
  // Den andre klienten oppretter samme navn etter vårt gyldige oppslag.
  await settData(`${VARER}/samtidig`, { name: "Melk", cat: "Ost og meieri", ukjent: 1 });
  await slippVare(page);

  await expect.poll(async () => Object.keys(await les()).length).toBe(3);
  const o = await les();
  expect(o.samtidig).toEqual({ name: "Melk", cat: "Ost og meieri", ukjent: 1 });
  expect(o.r).toEqual({ name: "Laks", cat: "Fisk og sjømat" });
  const [egen] = Object.entries(o).find(([k, v]) => k !== "samtidig" && v.name === "Melk")!;
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe(egen);

  // Neste fritekstoppslag på navnet gir konflikt (dekket av «flere varer med
  // samme navn» over).
  expect(feil).toEqual([]);
});

// ── Review 5869609509 ───────────────────────────────────────────────────

/** Varer med `.priority` på en urørt vare og på et barn. */
const MED_PRIORITET = {
  m1: { name: "Kjøttdeig", cat: "Kjøtt", ".priority": 5, notat: { tekst: "x", ".priority": "b" } },
  r: { name: "Laks", cat: "Fisk og sjømat", ".priority": 2 },
  u: { name: "Urørt", cat: "Diverse", ".priority": 9, barn: { a: 1, ".priority": 1 } },
};

test("priority bevares: fritekst-treff, fritekst-oppretting og eksplisitt valg skriver ikke om eksisterende varer", async ({
  page,
}) => {
  const feil = await start(page, MED_PRIORITET as Record<string, Vare>, TACO);
  const foer = (await lesEksport(VARER)) as Record<string, unknown>;
  expect(foer.u).toEqual(MED_PRIORITET.u);

  // Eksplisitt valg i Middagsbibliotek.
  await aapneBibliotekpost(page);
  await leggTilFelt(page).fill("Kjøtt");
  await page.locator('[data-vare-valg="m1"]').click();
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe("m1");
  expect(await lesEksport(VARER)).toEqual(foer);

  // Fritekst-oppretting: bare den nye noden kommer til.
  await opprettIVelger(page, "Melk");
  await expect.poll(async () => Object.keys((await lesData(VARER)) as object).length).toBe(4);
  const etter = (await lesEksport(VARER)) as Record<string, unknown>;
  const nye = Object.keys(etter).filter((k) => !(k in foer));
  expect(nye).toHaveLength(1);
  expect({ ...etter, [nye[0]!]: undefined }).toEqual({ ...foer, [nye[0]!]: undefined });
  expect(feil).toEqual([]);
});

test("priority bevares: fritekst-treff i Fryser skriver ikke om varebasen", async ({ page }) => {
  const feil = await start(page, MED_PRIORITET as Record<string, Vare>);
  const foer = await lesEksport(VARER);
  await tilFryser(page);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("laks");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
  await expect.poll(fryserItemIds).toEqual(["r"]);
  expect(await lesEksport(VARER)).toEqual(foer);
  expect(feil).toEqual([]);
});

/** Lokal cache som ser tom ut: transaksjonscallbacken får null først, og
 * once/get gir et tomt øyeblikksbilde. Serveren har varen. */
async function kaldCache(page: Page) {
  await page.evaluate(() => {
    type Snap = { exists(): boolean; val(): unknown };
    const fb = (
      globalThis as unknown as {
        firebase: { database: { Reference: Proto; Query: Proto } };
      }
    ).firebase;
    const ref = fb.database.Reference.prototype;
    const q = fb.database.Query.prototype;
    const erVare = (t: { toString(): string }) => /\/items(\/[^/]+)?$/.test(t.toString());
    const tom: Snap = { exists: () => false, val: () => null };
    const origT = ref.transaction as (...a: unknown[]) => Promise<unknown>;
    ref.transaction = function (this: { toString(): string }, fn: unknown, ...rest: unknown[]) {
      if (!erVare(this)) return origT.call(this, fn, ...rest);
      let forste = true;
      const f = fn as (c: unknown) => unknown;
      return origT.call(
        this,
        (cur: unknown) => {
          if (forste) {
            forste = false;
            return f(null);
          }
          return f(cur);
        },
        ...rest,
      );
    };
    for (const navn of ["once", "get"]) {
      const orig = q[navn] as (...a: unknown[]) => Promise<unknown>;
      q[navn] = function (this: { toString(): string }, ...a: unknown[]) {
        return erVare(this) ? Promise.resolve(tom) : orig.apply(this, a);
      };
    }
  });
}

test("eksplisitt valg ved kald cache: varen bekreftes mot serveren og kobles", async ({ page }) => {
  const feil = await start(page, { m1: { name: "Kjøttdeig", cat: "Kjøtt" } }, TACO);
  await aapneBibliotekpost(page);
  await kaldCache(page);
  await leggTilFelt(page).fill("Kjøtt");
  await page.locator('[data-vare-valg="m1"]').click();
  await expect
    .poll(async () => (await lesData(`${FAM}/mealLibrary/p/shoppingBase/0/itemId`)) as string)
    .toBe("m1");
  await expect(status(page)).toHaveCount(0);
  expect(await les()).toEqual({ m1: { name: "Kjøttdeig", cat: "Kjøtt" } });
  expect(feil).toEqual([]);
});

test("fritekst ved kald cache: eksisterende vare finnes på serveren, ingen ny vare", async ({
  page,
}) => {
  const feil = await start(page, { m1: { name: "Kjøttdeig", cat: "Kjøtt" } });
  await tilFryser(page);
  await kaldCache(page);
  await page.getByPlaceholder("f.eks. Karbonadedeig").fill("Kjøttdeig");
  await page.getByRole("button", { name: "＋ Legg til i fryseren" }).click();
  await expect.poll(fryserItemIds).toEqual(["m1"]);
  expect(await les()).toEqual({ m1: { name: "Kjøttdeig", cat: "Kjøtt" } });
  expect(feil).toEqual([]);
});

/** Varelytteren får en vare med ugyldig nøkkel (simulert klientdata). */
async function ugyldigNokkelILytter(page: Page, nokkel: string) {
  await page.addInitScript((k) => {
    const w = globalThis as unknown as {
      firebase?: { database?: { DataSnapshot?: Proto } };
    };
    const patch = setInterval(() => {
      const proto = w.firebase?.database?.DataSnapshot?.prototype;
      if (!proto) return;
      clearInterval(patch);
      const orig = proto.val as () => unknown;
      proto.val = function (this: { ref: { toString(): string } }) {
        const v = orig.call(this);
        if (!/\/items$/.test(this.ref.toString()) || !v || typeof v !== "object") return v;
        return { ...(v as object), [k]: { name: "Spøkelse", cat: "Diverse" } };
      };
    }, 1);
  }, nokkel);
}

for (const ugyldig of ["a/b", ""]) {
  test(`eksplisitt valg med ugyldig nøkkel ${JSON.stringify(ugyldig)}: avvises før noen sti lages, ingen fritekstfallback`, async ({
    page,
  }) => {
    await ugyldigNokkelILytter(page, ugyldig);
    const feil = await start(
      page,
      { m1: { name: "Kjøttdeig", cat: "Kjøtt" }, s: { name: "Spøkelse", cat: "Diverse" } },
      TACO,
    );
    await aapneBibliotekpost(page);
    await leggTilFelt(page).fill("Spøk");
    await page.locator(`[data-vare-valg=${JSON.stringify(ugyldig)}]`).click();
    await expect(status(page)).toHaveAttribute("data-vare-status", "konflikt");
    await expect(status(page)).toContainText("ugyldig");
    await page.waitForTimeout(500);
    expect(await lesData(`${FAM}/mealLibrary/p`)).toEqual({ name: "Taco" }); // ikke koblet til «s»
    expect(Object.keys(await les()).sort()).toEqual(["m1", "s"]);
    expect(feil).toEqual([]);
  });
}
