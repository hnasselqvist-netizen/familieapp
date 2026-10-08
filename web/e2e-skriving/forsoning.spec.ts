import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { DATABASE_URL, E2E_USER, FAMILY_ID, PROJECT_ID } from "../e2e/seed-config.mjs";

/**
 * Skrivende Forvaltning-flyter med forsoningsporten PÅ (§Issue #34,
 * pre-cutover 3) — KUN mot Firebase-emulatoren, via
 * `npm run test:e2e:skriving` (bygget i modus «e2e-skriving»).
 *
 * Hver test seeder nodene i legacy sin form, skriver gjennom React-UI-et
 * og leser resultatet rett fra emulatoren med firebase-admin: nodene skal
 * forbli arrays (legacy leser dem med `Object.values`/array-indekser) og
 * aldri få `node/{id}`-nøkler.
 */
const FAM = `families/${FAMILY_ID}`;

async function medDb<T>(fn: (db: ReturnType<typeof getDatabase>) => Promise<T>): Promise<T> {
  const app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `e2e-${Date.now()}`,
  );
  try {
    return await fn(getDatabase(app));
  } finally {
    await deleteApp(app);
  }
}
const les = (node: string) => medDb(async (db) => (await db.ref(`${FAM}/${node}`).get()).val());
const settNoder = (noder: Record<string, unknown>) =>
  medDb(async (db) => {
    for (const [node, verdi] of Object.entries(noder)) await db.ref(`${FAM}/${node}`).set(verdi);
  });

/** Nodene skal være legacy-arrays: sammenhengende indekser, ingen id-nøkler. */
async function forventArray(node: string, lengde: number) {
  const v = await les(node);
  expect(Array.isArray(v), `${node} er array`).toBe(true);
  expect(v, node).toHaveLength(lengde);
  return v as Record<string, unknown>[];
}

const tx = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  dato: "2026-09-20",
  tekst: "REMA 1000 GRUNERLOKKA",
  belop: 412.5,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...o,
});

async function loggInn(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("din@epost.no").fill(E2E_USER.email);
  await page.getByPlaceholder("••••••••").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  await expect(page.getByPlaceholder("din@epost.no")).not.toBeVisible();
}

test.beforeEach(async () => {
  await settNoder({
    transaksjoner: [tx("t1"), tx("t2", { tekst: "KIWI 505", belop: 99 })],
    hendelser: null,
    receipts: null,
    rules: null,
    saldokontroller: null,
    budget: { mat: { dagligvarer: { name: "Dagligvarer", months: {} } } },
  });
});

test("Forvaltning-forsiden er handlingsflaten når porten er på, med inngang til riktig kø", async ({
  page,
}) => {
  await loggInn(page);
  await page.goto("/forvaltning");
  await expect(page.getByText(/ikke migrert/)).not.toBeVisible();
  const oppmerksomhet = page.getByRole("region", { name: "Trenger oppmerksomhet" });
  await oppmerksomhet.getByRole("link", { name: "2 transaksjoner å vurdere" }).click();
  await expect(page).toHaveURL(/\/forvaltning\/transaksjoner\?ko=vurdering$/);
  await expect(page.getByRole("tab", { name: /Krever vurdering\s*2/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("Bankimport-beslutning med læring skriver hendelser, transaksjoner og rules som arrays", async ({
  page,
}) => {
  await loggInn(page);
  await page.goto("/forvaltning/transaksjoner");
  await page.getByRole("button", { name: /REMA 1000 GRUNERLOKKA/ }).click();
  const panel = page.getByRole("group", { name: "Behandle REMA 1000 GRUNERLOKKA" });
  await panel.getByRole("searchbox", { name: "Søk blant poster" }).fill("dagl");
  await panel
    .getByRole("button", { name: /Dagligvarer/ })
    .first()
    .click();
  await panel.getByRole("checkbox", { name: /Lær denne koblingen/ }).check();
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(panel).not.toBeVisible();

  const [h] = await forventArray("hendelser", 1);
  expect(h).toMatchObject({ status: "ferdig", transaksjonId: "t1" });
  const t = await forventArray("transaksjoner", 2);
  expect(t[0]).toMatchObject({ id: "t1", hendelseId: h!.id });
  expect(t[1]).toMatchObject({ id: "t2" });
  const [r] = await forventArray("rules", 1);
  expect(r).toMatchObject({ targetId: "dagligvarer" });
});

test("sammensatt regel (#59): «Bare fra Helen» lærer tekst + konto, vises og redigeres i Regelsenteret", async ({
  page,
}) => {
  await settNoder({
    transaksjoner: [
      tx("t-helen", { konto: "Helen" }),
      tx("t-helen-2", { konto: "Helen", dato: "2026-09-21" }),
      tx("t-felles", { dato: "2026-09-22" }),
    ],
  });
  await loggInn(page);
  await page.goto("/forvaltning/transaksjoner");
  await page
    .getByRole("button", { name: /REMA 1000 GRUNERLOKKA/ })
    .first()
    .click();
  const panel = page.getByRole("group", { name: "Behandle REMA 1000 GRUNERLOKKA" });
  await panel.getByRole("searchbox", { name: "Søk blant poster" }).fill("dagl");
  await panel
    .getByRole("button", { name: /Dagligvarer/ })
    .first()
    .click();
  await panel.getByRole("checkbox", { name: /Lær denne koblingen/ }).check();
  await panel.getByText("Bare fra Helen").click();
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(panel).not.toBeVisible();

  const [r] = await forventArray("rules", 1);
  expect(r).toMatchObject({ targetId: "dagligvarer", kontoVilkar: "helen" });
  const t = await forventArray("transaksjoner", 3);
  expect(t.find((x) => x.id === "t-helen-2")).toMatchObject({ status: "foresoatt_match" });
  expect(t.find((x) => x.id === "t-felles")).toMatchObject({ status: "ny" });

  await page.goto("/forvaltning/regelsenter");
  await expect(page.getByText("+ bare fra Helen")).toBeVisible();
  await page.getByText("REMA 1000 GRUNERLOKKA").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("og betalt fra Helen")).toBeVisible();
  await dialog
    .getByRole("group", { name: "Betalt fra konto" })
    .getByRole("button", { name: "Alle kontoer" })
    .click();
  await expect(dialog.getByText("og betalt fra Helen")).not.toBeVisible();
  const [etter] = await forventArray("rules", 1);
  expect(etter).toMatchObject({ id: r!.id, targetId: "dagligvarer" });
  expect(etter).not.toHaveProperty("kontoVilkar");
});

test("regelstyrt ansvar (#59): læring lagrer ansvaret, Regelsenteret redigerer det, «Kjør regler» bruker det", async ({
  page,
}) => {
  await settNoder({
    transaksjoner: [
      tx("t-helen", { konto: "Helen" }),
      tx("t-helen-2", { konto: "Helen", dato: "2026-09-25", status: "ny" }),
    ],
  });
  await loggInn(page);
  await page.goto("/forvaltning/transaksjoner");
  await page
    .getByRole("button", { name: /REMA 1000 GRUNERLOKKA/ })
    .first()
    .click();
  const panel = page.getByRole("group", { name: "Behandle REMA 1000 GRUNERLOKKA" });
  await panel.getByRole("searchbox", { name: "Søk blant poster" }).fill("dagl");
  await panel
    .getByRole("button", { name: /Dagligvarer/ })
    .first()
    .click();
  const ansvar = panel.getByRole("group", { name: "Ansvar for Dagligvarer" });
  await ansvar.getByRole("button", { name: "Helen" }).click();
  await ansvar.getByRole("button", { name: /Felles/ }).click();
  await panel.getByRole("checkbox", { name: /Lær denne koblingen/ }).check();
  await panel.getByText("Bare fra Helen").click();
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(panel).not.toBeVisible();

  const [r] = await forventArray("rules", 1);
  expect(r).toMatchObject({ kontoVilkar: "helen", eiere: [{ person: "Helen", prosent: 100 }] });

  // Regelsenteret: endre ansvaret til Eivind (regelens resultat, ikke kontoen).
  await page.goto("/forvaltning/regelsenter");
  await page.getByText("REMA 1000 GRUNERLOKKA").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Ansvar ved treff").locator("xpath=..")).toContainText("Helen");
  const valg = dialog.getByRole("group", { name: "Ansvar", exact: true });
  await valg.getByRole("button", { name: "Eivind" }).click();
  await valg.getByRole("button", { name: "Helen" }).click();
  await expect(valg.getByRole("button", { name: "Eivind" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const [etter] = await forventArray("rules", 1);
  expect(etter).toMatchObject({ id: r!.id, eiere: [{ person: "Eivind", prosent: 100 }] });
  await dialog.getByRole("button", { name: "Lukk" }).last().click();

  // «Kjør regler»: den like Helen-transaksjonen plasseres automatisk med regelens ansvar.
  await settNoder({
    transaksjoner: (await les("transaksjoner")).map((t: Record<string, unknown>) =>
      t.id === "t-helen-2" ? { ...t, status: "ny", laertKobling: null, matchetMot: null } : t,
    ),
  });
  await page.getByRole("button", { name: "Kjør regler" }).click();
  const forhand = page.getByRole("region", { name: "Forhåndsvisning av Kjør regler" });
  await expect(forhand).toContainText("ansvar Eivind");
  await forhand.getByRole("button", { name: "Bruk resultatet" }).click();
  await expect(forhand).not.toBeVisible();
  const h = await forventArray("hendelser", 2);
  const auto = h.find((x) => x.transaksjonId === "t-helen-2")!;
  expect(auto).toMatchObject({ status: "ferdig", regelId: r!.id });
  expect((auto.fordelinger as Record<string, unknown>[])[0]).toMatchObject({
    plasseringId: "dagligvarer",
    eiere: [{ person: "Eivind", prosent: 100 }],
  });
});

/** `YYYY-MM` for måneden `forskyvning` måneder før inneværende (lokal tid). */
function maanedFoer(forskyvning: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - forskyvning);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

test("saldoavstemming (#59): startsaldo + måned = avstemt; etterimport gir avvik; transaksjonene røres ikke", async ({
  page,
}) => {
  // Datouavhengig: kontrollmåneden er alltid siste avsluttede kalendermåned.
  const M = maanedFoer(1);
  const [aar, mnd] = M.split("-");
  const trans = [
    tx("t-lonn", { dato: `${M}-05`, tekst: "LØNN", belop: 42000, retning: "inn" }),
    tx("t-rema", { dato: `${M}-12`, tekst: "REMA 1000", belop: 2000 }),
    tx("t-mc-kjop", { dato: `${M}-14`, tekst: "KIWI", belop: 3000, konto: "MC" }),
    tx("t-mc-inn", {
      dato: `${M}-20`,
      tekst: "Innbetaling",
      belop: 7000,
      retning: "inn",
      konto: "MC",
    }),
  ];
  await settNoder({ transaksjoner: trans, saldokontroller: null });
  await loggInn(page);

  // Inngang fra Oversikt: forrige kalendermåned, ingenting avstemt ennå.
  await page.goto("/forvaltning");
  await page.getByRole("link", { name: /Månedskontroll .*: 0 av 2 kontoer avstemt/ }).click();
  await expect(page).toHaveURL(/\/forvaltning\/avstemming$/);

  // Felleskonto: startsaldo forrige måned, så faktisk saldo for M.
  const felles = page.getByRole("region", { name: "Felleskonto" });
  await expect(felles).toContainText("Mangler saldo");
  await felles.getByLabel(/\(startpunkt\)$/).fill("1000");
  await felles.getByRole("button", { name: "Lagre" }).first().click();
  await felles.getByLabel(/^Faktisk saldo/).fill("41000");
  await felles.getByRole("button", { name: "Lagre" }).last().click();
  await expect(felles.getByText("Avstemt", { exact: true })).toBeVisible();

  // MC: «Skyldig beløp» tastes positivt; −7 000 − 3 000 + 7 000 = −3 000.
  const mc = page.getByRole("region", { name: "MC" });
  await mc.getByLabel(/\(startpunkt\)$/).fill("7000");
  await mc.getByRole("button", { name: "Lagre" }).first().click();
  await mc.getByLabel(/^Skyldig beløp/).fill("3000");
  await mc.getByRole("button", { name: "Lagre" }).last().click();
  await expect(mc.getByText("Avstemt", { exact: true })).toBeVisible();

  const node = await les("saldokontroller");
  expect(Object.keys(node).sort()).toEqual(["MC", "felleskonto"]);
  expect(node.MC[M]).toMatchObject({ konto: "MC", maaned: M, faktiskSaldo: -3000 });
  expect(
    Object.values(node.MC)
      .map((k) => (k as { faktiskSaldo: number }).faktiskSaldo)
      .sort(),
  ).toEqual([-3000, -7000]);
  expect(node.felleskonto[M]).toMatchObject({
    faktiskSaldo: 41000,
    grunnlag: { antall: 2, nettoOre: 4_000_000 },
  });
  // Å registrere saldo endrer ingen transaksjon.
  expect(await forventArray("transaksjoner", 4)).toEqual(trans);

  // Etterimport: en glemt REMA-linje for M importeres via bankfilen.
  await page.getByRole("link", { name: "Transaksjoner" }).click();
  await page.getByRole("button", { name: /Importer fil/ }).click();
  const panel = page.getByRole("group", { name: "Importer bankfil" });
  await panel.getByLabel("Bankfil").setInputFiles({
    name: "sparebank1.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `Dato;Beskrivelse;Inn;Ut;Konto\n28.${mnd}.${aar};REMA 1000 GLEMT;;250;Felleskonto\n`,
    ),
  });
  await panel.getByRole("button", { name: "Importer 1 transaksjoner" }).click();
  await expect(panel).not.toBeVisible();

  // Statusen revurderes: avvik på 250 kr, og grunnlaget er endret.
  await page.goto("/forvaltning/avstemming");
  await expect(felles.getByText("Avvik", { exact: true })).toBeVisible();
  await expect(felles.getByRole("status")).toContainText("250,00 kr mer i banken enn beregnet");
  await expect(felles.getByRole("status")).toContainText("(+1 transaksjon)");
  await expect(mc.getByText("Avstemt", { exact: true })).toBeVisible();

  // Kontrollpunktet er uendret; bare importen la til en transaksjon.
  expect((await les("saldokontroller")).felleskonto[M]).toMatchObject({ faktiskSaldo: 41000 });
  const etter = await forventArray("transaksjoner", 5);
  expect(etter.slice(0, 4)).toEqual(trans);
  expect(etter[4]).toMatchObject({ tekst: "REMA 1000 GLEMT", belop: 250, dato: `${M}-28` });
});

test("ny kvittering skriver receipts som array", async ({ page }) => {
  await loggInn(page);
  await page.goto("/forvaltning/kvitteringer");
  await page.getByRole("button", { name: "＋ Ny kvittering" }).click();
  const panel = page.getByRole("group", { name: "Ny kvittering" });
  await panel.getByLabel("Leverandør").fill("Obs Bygg");
  await panel.getByLabel("Totalbeløp").fill("300");
  await panel.getByRole("button", { name: "Registrer kvittering" }).click();
  await expect(panel).not.toBeVisible();

  const [k] = await forventArray("receipts", 1);
  expect(k).toMatchObject({ merchant: "Obs Bygg", total: 300, matchingStatus: expect.any(String) });
});

test("korrigering til «på vent» erstatter hendelsen i arrayet", async ({ page }) => {
  await settNoder({
    transaksjoner: [tx("t1", { hendelseId: "h1" }), tx("t2", { tekst: "KIWI 505", belop: 99 })],
    hendelser: [
      {
        id: "h1",
        status: "ferdig",
        paaVentAarsak: null,
        transaksjonId: "t1",
        receiptId: null,
        dato: "2026-09-20",
        regelId: null,
        opprettet: "2026-09-20T10:00:00.000Z",
        oppdatert: "2026-09-20T10:00:00.000Z",
        fordelinger: [
          {
            plasseringId: "dagligvarer",
            plasseringType: "budget",
            plasseringNavn: "Dagligvarer",
            belop: 412.5,
            eiere: [{ person: "Felles", prosent: 100 }],
          },
        ],
      },
    ],
  });
  await loggInn(page);
  await page.goto("/forvaltning/transaksjoner");
  await page.getByRole("button", { name: "Alle transaksjoner" }).click();
  await page.getByRole("button", { name: "Korriger kobling REMA 1000 GRUNERLOKKA" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Sett på vent" }).click();
  await dialog.getByRole("group", { name: "Årsak" }).getByRole("button").first().click();
  await dialog.getByRole("button", { name: "Lagre korrigering" }).click();
  await expect(dialog).not.toBeVisible();

  const [h] = await forventArray("hendelser", 1);
  expect(h).toMatchObject({ id: "h1", status: "pa_vent", transaksjonId: "t1" });
  expect(h!.fordelinger).toBeUndefined(); // tom liste lagres ikke i RTDB
  await forventArray("transaksjoner", 2);
});

test("Lønnsdagsrunden: import via runden, tilbake til runden, og neste steg blir vurdering", async ({
  page,
}) => {
  await loggInn(page);
  await page.goto("/forvaltning");

  // Inngangen på forsiden: de to seedede transaksjonene har ingen importdato.
  const kort = page.getByRole("region", { name: "Lønnsdagsrunden" });
  await expect(kort).toContainText("Neste: importer bankfilen");
  await kort.getByRole("link").click();
  await expect(page).toHaveURL(/\/forvaltning\/runde$/);

  const steg = page.getByRole("list", { name: "Steg i runden" });
  const aktivt = steg.locator('[aria-current="step"]');
  await expect(aktivt).toContainText("Importer bankfilen");
  await aktivt.click();

  // Steget åpner importpanelet direkte.
  const panel = page.getByRole("group", { name: "Importer bankfil" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Bankfil").setInputFiles({
    name: "sparebank1.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Dato;Beskrivelse;Inn;Ut;Konto\n06.10.2026;LØNN HELEN;45000;;Felleskonto\n",
    ),
  });
  await panel.getByRole("button", { name: "Importer 1 transaksjoner" }).click();
  await expect(panel).not.toBeVisible();

  // Veien tilbake til runden: import er gjort, vurdering er neste.
  await page.getByRole("link", { name: "Lønnsdagsrunden" }).click();
  await expect(page).toHaveURL(/\/forvaltning\/runde$/);
  await expect(steg.getByRole("link").first()).toContainText("Importer bankfilen (gjort)");
  await expect(aktivt).toContainText("Vurder transaksjonene");
  await expect(aktivt).toContainText("3 transaksjoner venter.");

  // Runden skriver ingenting selv: transaksjonene er fortsatt et legacy-array.
  const t = await forventArray("transaksjoner", 3);
  expect(t[2]).toMatchObject({ tekst: "LØNN HELEN", retning: "inn", konto: "Felleskonto" });
});

test("godkjent forslag forsvinner fra «Forslag til match» (#66) og dataformen er uendret", async ({
  page,
}) => {
  await settNoder({
    transaksjoner: [
      tx("t1"),
      tx("t2", { tekst: "KIWI 505", belop: 99 }),
      tx("t3", {
        tekst: "KIWI 505 STORO",
        belop: 150,
        status: "foresoatt_match",
        matchetMot: "dagligvarer",
        matchetNavn: "Dagligvarer",
      }),
    ],
  });
  await loggInn(page);
  await page.goto("/forvaltning/transaksjoner?ko=forslag");
  await expect(page.getByRole("tab", { name: /Forslag til match\s*1/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: /KIWI 505 STORO/ }).click();
  const panel = page.getByRole("group", { name: "Behandle KIWI 505 STORO" });
  // Forslaget er forhåndsvalgt: å godkjenne er å lagre det.
  await panel.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole("button", { name: /KIWI 505 STORO/ })).not.toBeVisible();
  await expect(page.getByText("Ingen hendelser i denne kategorien.")).toBeVisible();

  const [h] = await forventArray("hendelser", 1);
  expect(h).toMatchObject({ status: "ferdig", transaksjonId: "t3" });
  const t = await forventArray("transaksjoner", 3);
  // Legacy-formen: statusen står, hendelsen avgjør at den er plassert.
  expect(t[2]).toMatchObject({ id: "t3", status: "foresoatt_match", hendelseId: h!.id });
});
