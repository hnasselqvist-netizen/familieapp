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

  // Panelet lukkes på den lokale (optimistiske) skrivingen; nodene skrives
  // etter hverandre (hendelser → transaksjoner → rules), så les til de er der.
  await expect(async () => {
    const [h] = await forventArray("hendelser", 1);
    expect(h).toMatchObject({ status: "ferdig", transaksjonId: "t1" });
    const t = await forventArray("transaksjoner", 2);
    expect(t[0]).toMatchObject({ id: "t1", hendelseId: h!.id });
    expect(t[1]).toMatchObject({ id: "t2" });
    const [r] = await forventArray("rules", 1);
    expect(r).toMatchObject({ targetId: "dagligvarer" });
  }).toPass();
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

  let r: Record<string, unknown> | undefined;
  await expect(async () => {
    [r] = await forventArray("rules", 1);
    expect(r).toMatchObject({ targetId: "dagligvarer", kontoVilkar: "helen" });
    const t = await forventArray("transaksjoner", 3);
    expect(t.find((x) => x.id === "t-helen-2")).toMatchObject({ status: "foresoatt_match" });
    expect(t.find((x) => x.id === "t-felles")).toMatchObject({ status: "ny" });
  }).toPass();

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
  await expect(async () => {
    const [etter] = await forventArray("rules", 1);
    expect(etter).toMatchObject({ id: r!.id, targetId: "dagligvarer" });
    expect(etter).not.toHaveProperty("kontoVilkar");
  }).toPass();
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

  let r: Record<string, unknown> | undefined;
  await expect(async () => {
    [r] = await forventArray("rules", 1);
    expect(r).toMatchObject({ kontoVilkar: "helen", eiere: [{ person: "Helen", prosent: 100 }] });
  }).toPass();

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
  await expect(async () => {
    const [etter] = await forventArray("rules", 1);
    expect(etter).toMatchObject({ id: r!.id, eiere: [{ person: "Eivind", prosent: 100 }] });
  }).toPass();
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
  await expect(async () => {
    const h = await forventArray("hendelser", 2);
    const auto = h.find((x) => x.transaksjonId === "t-helen-2")!;
    expect(auto).toMatchObject({ status: "ferdig", regelId: r!.id });
    expect((auto.fordelinger as Record<string, unknown>[])[0]).toMatchObject({
      plasseringId: "dagligvarer",
      eiere: [{ person: "Eivind", prosent: 100 }],
    });
  }).toPass();
});

/** `YYYY-MM` for måneden `forskyvning` måneder før inneværende (lokal tid). */
function maanedFoer(forskyvning: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - forskyvning);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Kontrollpunktene per konto, uavhengig av hvordan kontonøkkelen er kodet. */
async function kontrollerPerKonto(): Promise<
  Record<string, Record<string, Record<string, unknown>>>
> {
  const node = ((await les("saldokontroller")) ?? {}) as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  const ut: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const maaneder of Object.values(node)) {
    for (const [m, k] of Object.entries(maaneder)) {
      ut[k.konto as string] = { ...(ut[k.konto as string] ?? {}), [m]: k };
    }
  }
  return ut;
}

test("saldoavstemming (#59): startsaldo + måned = avstemt; uavklart ignorert = usikker; etterimport gir avvik; transaksjonene røres ikke", async ({
  page,
}) => {
  // Datouavhengig: kontrollmåneden er alltid siste avsluttede kalendermåned.
  const M = maanedFoer(1);
  const [aar, mnd] = M.split("-");
  const trans = [
    tx("t-lonn", { dato: `${M}-05`, tekst: "LØNN", belop: 42000, retning: "inn" }),
    tx("t-rema", { dato: `${M}-12`, tekst: "REMA 1000", belop: 2000 }),
    // Ignorert uten avklaring (som all eldre data): gjør måneden usikker.
    tx("t-kaffe", { dato: `${M}-12`, tekst: "REMA 1000 OSLO", belop: 2000, status: "ignorert" }),
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

  // 0 i differanse er IKKE bevis så lenge en ignorert linje er uavklart.
  await expect(felles.getByText("Usikker", { exact: true })).toBeVisible();
  await expect(felles.getByRole("status")).toContainText("Er de dubletter: ingen differanse.");
  await expect(felles.getByRole("status")).toContainText(
    "Er de ekte bankbevegelser: 2 000,00 kr mer i banken enn beregnet.",
  );
  // Helen avklarer: dubletten telles ikke → avstemt.
  await felles
    .getByRole("group", { name: "Avklar ignorerte transaksjoner" })
    .getByRole("button", { name: /REMA 1000 OSLO .* er en dublett/ })
    .click();
  await expect(felles.getByText("Avstemt", { exact: true })).toBeVisible();

  // MC: «Skyldig beløp» tastes positivt; −7 000 − 3 000 + 7 000 = −3 000.
  const mc = page.getByRole("region", { name: "MC" });
  await mc.getByLabel(/\(startpunkt\)$/).fill("7000");
  await mc.getByRole("button", { name: "Lagre" }).first().click();
  await mc.getByLabel(/^Skyldig beløp/).fill("3000");
  await mc.getByRole("button", { name: "Lagre" }).last().click();
  await expect(mc.getByText("Avstemt", { exact: true })).toBeVisible();

  // UI-et oppdateres fra den lokale skrivingen før emulatoren har bekreftet
  // den; les databasen til den har tatt igjen (rotårsak til flaky E2E på main).
  let forImport: Record<string, unknown>[] = [];
  await expect(async () => {
    const kontroller = await kontrollerPerKonto();
    expect(Object.keys(kontroller).sort()).toEqual(["MC", "felleskonto"]);
    expect(kontroller.MC![M]).toMatchObject({ konto: "MC", maaned: M, faktiskSaldo: -3000 });
    expect(
      Object.values(kontroller.MC!)
        .map((k) => k.faktiskSaldo as number)
        .sort(),
    ).toEqual([-3000, -7000]);
    expect(kontroller.felleskonto![M]).toMatchObject({
      faktiskSaldo: 41000,
      grunnlag: { antall: 3, nettoOre: 4_000_000 },
    });
    // Lagret under injektive nøkler, aldri under rå kontonavn.
    expect(Object.keys(await les("saldokontroller")).every((n) => n.startsWith("k_"))).toBe(true);

    // Å registrere saldo endrer ingen transaksjon; avklaringen legger BARE til
    // `ignorertSom` — statusen er fortsatt «ignorert».
    forImport = await forventArray("transaksjoner", 5);
    expect(forImport.filter((t) => t.id !== "t-kaffe")).toEqual(
      trans.filter((t) => t.id !== "t-kaffe"),
    );
    expect(forImport.find((t) => t.id === "t-kaffe")).toEqual({
      ...trans.find((t) => t.id === "t-kaffe"),
      ignorertSom: "dublett",
    });
  }).toPass();

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
  expect((await kontrollerPerKonto()).felleskonto![M]).toMatchObject({ faktiskSaldo: 41000 });
  await expect(async () => {
    const etter = await forventArray("transaksjoner", 6);
    expect(etter.slice(0, 5)).toEqual(forImport);
    expect(etter[5]).toMatchObject({ tekst: "REMA 1000 GLEMT", belop: 250, dato: `${M}-28` });
  }).toPass();
});

test("saldokorrigering (#59): +26 000-dublett blant interne overføringer merkes, angres, og feilmerket dublett blir ekte bevegelse", async ({
  page,
}) => {
  const M = maanedFoer(1);
  const intern = (id: string, motpart: string, o: Record<string, unknown>) =>
    tx(id, {
      dato: `${M}-07`,
      belop: 26000,
      retning: "inn",
      konto: "Regningskonto",
      status: "behandlet",
      behandlingstype: "intern_overforing",
      motpartTransaksjonId: motpart,
      ...o,
    });
  const trans = [
    intern("a1", "f1", { tekst: "Avtale" }),
    intern("f1", "a1", { tekst: "Avtale", konto: "Felleskonto", retning: "ut" }),
    intern("a2", "f2", { tekst: "Til betaling regninger og mat" }),
    intern("f2", "a2", {
      tekst: "Til betaling regninger og mat",
      konto: "Felleskonto",
      retning: "ut",
    }),
    // Feilmerket dublett (6097180478): en ekte utbetaling holdt utenfor.
    tx("j1", {
      dato: `${M}-20`,
      tekst: "DNB BANK ASA",
      belop: 25000,
      konto: "Regningskonto",
      status: "ignorert",
      ignorertSom: "dublett",
    }),
  ];
  const hendelser = [
    {
      id: "h-urort",
      status: "ferdig",
      paaVentAarsak: null,
      transaksjonId: null,
      receiptId: null,
      fordelinger: [],
      dato: `${M}-01`,
      regelId: null,
      opprettet: "x",
      oppdatert: "x",
    },
  ];
  const [aar, mnd] = M.split("-").map(Number) as [number, number];
  const forrige = `${mnd === 1 ? aar - 1 : aar}-${String(mnd === 1 ? 12 : mnd - 1).padStart(2, "0")}`;
  // 17 096,55 + 52 000 − 0 (j1 holdt utenfor) = 69 096,55 beregnet; banken: 18 096,55.
  await settNoder({
    transaksjoner: trans,
    hendelser,
    saldokontroller: {
      k_cmVnbmluZ3Nrb250bw: {
        [forrige]: {
          konto: "regningskonto",
          maaned: forrige,
          dato: `${forrige}-28`,
          faktiskSaldo: 17096.55,
          registrert: "x",
          oppdatert: "x",
        },
        [M]: {
          konto: "regningskonto",
          maaned: M,
          dato: `${M}-28`,
          faktiskSaldo: 18096.55,
          registrert: "x",
          oppdatert: "x",
        },
      },
    },
  });
  const budsjettFor = await les("budget");
  const hendelserFor = await les("hendelser");
  await loggInn(page);
  await page.goto("/forvaltning/avstemming");

  const regning = page.getByRole("region", { name: "Regningskonto" });
  await expect(regning.getByText("Avvik", { exact: true })).toBeVisible();
  await expect(regning.getByRole("status")).toContainText(
    "51 000,00 kr mindre i banken enn beregnet",
  );

  // Feilmerket dublett → ekte bevegelse: avviket krymper til −26 000.
  await regning
    .getByRole("group", { name: /Holdt utenfor som dublett/ })
    .getByRole("button", { name: /DNB BANK ASA .* er ikke en dublett/ })
    .click();
  await expect(regning.getByRole("status")).toContainText(
    "26 000,00 kr mindre i banken enn beregnet",
  );

  // +26 000: merk «Til betaling regninger og mat» som dublett, motposten er ekte.
  await regning.getByText(/Mulige forklaringer/).click();
  await regning
    .getByRole("button", { name: /Marker Til betaling regninger og mat .* som dublett/ })
    .click();
  const panel = regning.getByRole("group", {
    name: /Marker Til betaling regninger og mat .* som dublett/,
  });
  await expect(panel).toContainText("Felleskonto");
  await panel.getByLabel(/Motposten er ekte/).check();
  await panel.getByRole("button", { name: "Bekreft: marker som dublett" }).click();
  await expect(regning.getByText("Avstemt", { exact: true })).toBeVisible();

  const id = (l: Record<string, unknown>[], i: string) => l.find((t) => t.id === i)!;
  await expect(async () => {
    const merket = await forventArray("transaksjoner", 5);
    expect(id(merket, "a2")).toMatchObject({
      status: "ignorert",
      ignorertSom: "dublett",
      saldoKorrigering: {
        type: "dublett",
        tidligere: {
          status: "behandlet",
          behandlingstype: "intern_overforing",
          motpartTransaksjonId: "f2",
        },
      },
    });
    expect(id(merket, "a2").motpartTransaksjonId).toBeUndefined();
    expect(id(merket, "f2")).toMatchObject({
      status: "behandlet",
      behandlingstype: "intern_overforing",
      saldoKorrigering: { type: "motpart_frakoblet", arsakId: "a2" },
    });
    expect(id(merket, "f2").motpartTransaksjonId).toBeUndefined();
    for (const i of ["a1", "f1"]) expect(id(merket, i)).toEqual(trans.find((t) => t.id === i));
    expect(id(merket, "j1")).toMatchObject({ status: "ignorert", ignorertSom: "bankbevegelse" });
  }).toPass();

  // Angre: begge sider gjenopprettes nøyaktig, med logg; avviket er tilbake.
  await regning
    .getByRole("group", { name: /Holdt utenfor som dublett/ })
    .getByRole("button", { name: /Til betaling regninger og mat .*: ikke dublett/ })
    .click();
  await regning.getByRole("button", { name: "Bekreft: ikke dublett" }).click();
  await expect(regning.getByRole("status")).toContainText(
    "26 000,00 kr mindre i banken enn beregnet",
  );

  await expect(async () => {
    const angret = await forventArray("transaksjoner", 5);
    for (const i of ["a2", "f2"]) {
      const { korrigeringslogg, updatedAt, ...rest } = id(angret, i);
      expect(rest).toEqual(trans.find((t) => t.id === i));
      expect(typeof updatedAt).toBe("string");
      expect((korrigeringslogg as { handling: string }[]).map((p) => p.handling)).toEqual(
        i === "a2"
          ? ["merket_dublett", "angret_dublett"]
          : ["motpart_frakoblet", "motpart_gjenkoblet"],
      );
    }
    // Budsjett og hendelser er urørt — korrigeringen gjelder bare saldoen.
    expect(await les("hendelser")).toEqual(hendelserFor);
    expect(await les("budget")).toEqual(budsjettFor);
    expect(await les("rules")).toBeNull();
  }).toPass();
});

test("saldokorrigering (review #71): motpost med plassering stopper merkingen med forklaring, og databasen røres ikke", async ({
  page,
}) => {
  const M = maanedFoer(1);
  const intern = (id: string, motpart: string, o: Record<string, unknown>) =>
    tx(id, {
      dato: `${M}-07`,
      tekst: "Til betaling",
      belop: 26000,
      retning: "inn",
      konto: "Regningskonto",
      status: "behandlet",
      behandlingstype: "intern_overforing",
      motpartTransaksjonId: motpart,
      ...o,
    });
  const trans = [
    intern("a1", "f1", {}),
    intern("f1", "a1", { konto: "Felleskonto", retning: "ut" }),
    intern("a2", "f2", {}),
    // Motposten er (feilaktig) plassert i budsjettet: risiko 1.
    intern("f2", "a2", { konto: "Felleskonto", retning: "ut", hendelseId: "h-x" }),
  ];
  const [aar, mnd] = M.split("-").map(Number) as [number, number];
  const forrige = `${mnd === 1 ? aar - 1 : aar}-${String(mnd === 1 ? 12 : mnd - 1).padStart(2, "0")}`;
  const k = (maaned: string, faktiskSaldo: number) => ({
    konto: "regningskonto",
    maaned,
    dato: `${maaned}-28`,
    faktiskSaldo,
    registrert: "x",
    oppdatert: "x",
  });
  // Banken viser én innbetaling; appen har to → avvik og «mulige dubletter».
  await settNoder({
    transaksjoner: trans,
    saldokontroller: { k_cmVnbmluZ3Nrb250bw: { [forrige]: k(forrige, 0), [M]: k(M, 26000) } },
  });
  await loggInn(page);
  await page.goto("/forvaltning/avstemming");
  const regning = page.getByRole("region", { name: "Regningskonto" });
  await expect(regning.getByText("Avvik", { exact: true })).toBeVisible();
  await regning.getByText(/Mulige forklaringer/).click();
  await regning
    .getByRole("button", { name: /Marker Til betaling .* som dublett/ })
    .last()
    .click();
  const panel = regning.getByRole("group", { name: /Marker Til betaling .* som dublett/ });
  await expect(panel).toContainText("Motposten er plassert i budsjettet");
  await expect(panel.getByRole("button", { name: "Bekreft: marker som dublett" })).toHaveCount(0);
  expect(await forventArray("transaksjoner", 4)).toEqual(trans);
});

test("motposten mangler (#59, 6097196546): avledet motpost på MC, angring, og senere import kobles uten dobbelttelling", async ({
  page,
}) => {
  const M = maanedFoer(1);
  const [aar, mnd] = M.split("-").map(Number) as [number, number];
  const forrige = `${mnd === 1 ? aar - 1 : aar}-${String(mnd === 1 ? 12 : mnd - 1).padStart(2, "0")}`;
  // Helens juli-funn: ekte utbetaling til MC feilmerket som dublett, MC-motposten mangler.
  const kilde = tx("j1", {
    dato: `${M}-20`,
    tekst: "DNB BANK ASA",
    belop: 25000,
    konto: "Regningskonto",
    status: "ignorert",
    ignorertSom: "dublett",
  });
  const k = (konto: string, maaned: string, faktiskSaldo: number) => ({
    konto,
    maaned,
    dato: `${maaned}-28`,
    faktiskSaldo,
    registrert: "x",
    oppdatert: "x",
  });
  await settNoder({
    transaksjoner: [kilde],
    saldokontroller: {
      k_cmVnbmluZ3Nrb250bw: {
        [forrige]: k("regningskonto", forrige, 60000),
        [M]: k("regningskonto", M, 35000),
      },
      // MC: skyldig 40 000 → 15 000 (lagret negativt).
      k_TUM: { [forrige]: k("MC", forrige, -40000), [M]: k("MC", M, -15000) },
    },
  });
  const hendelserFor = await les("hendelser");
  const budsjettFor = await les("budget");
  await loggInn(page);
  await page.goto("/forvaltning/avstemming");

  const regning = page.getByRole("region", { name: "Regningskonto" });
  const mc = page.getByRole("region", { name: "MC" });
  await expect(regning.getByText("Avvik", { exact: true })).toBeVisible();
  await expect(mc.getByText("Avvik", { exact: true })).toBeVisible();

  const merkManglende = async () => {
    await regning
      .getByRole("group", { name: /Holdt utenfor som dublett/ })
      .getByRole("button", { name: /DNB BANK ASA .*: intern overføring, motposten mangler/ })
      .click();
    const panel = regning.getByRole("group", {
      name: /DNB BANK ASA .*: intern overføring, motposten mangler/,
    });
    await panel.getByRole("combobox").selectOption("MC");
    await expect(panel).toContainText("Regningskonto → MC");
    await panel
      .getByRole("button", { name: "Bekreft: intern overføring med avledet motpost" })
      .click();
  };
  await merkManglende();

  // Kilden teller på Regningskonto; MC stemmer bare med den avledede — aldri «Avstemt».
  await expect(regning.getByText("Avstemt", { exact: true })).toBeVisible();
  await expect(mc.getByText("Stemmer med avledet motpost", { exact: true })).toBeVisible();
  await expect(mc.getByText("Avstemt", { exact: true })).toHaveCount(0);
  await expect(mc.getByRole("group", { name: /Avledede motposter/ })).toContainText(
    "fra Regningskonto: DNB BANK ASA",
  );

  await expect(async () => {
    const l = await forventArray("transaksjoner", 1);
    expect(l[0]).toMatchObject({
      id: "j1",
      status: "behandlet",
      behandlingstype: "intern_overforing",
      forventetMotpost: { konto: "MC", dato: `${M}-20` },
      saldoKorrigering: {
        type: "forventet_motpost",
        tidligere: { status: "ignorert", ignorertSom: "dublett" },
      },
    });
    expect(l[0]!.ignorertSom).toBeUndefined();
  }).toPass();

  // Angre: nøyaktig tilbake, med logg.
  await regning.getByRole("button", { name: /DNB BANK ASA .*: angre avledet motpost/ }).click();
  await regning.getByRole("button", { name: "Bekreft: angre avledet motpost" }).click();
  await expect(mc.getByText("Avvik", { exact: true })).toBeVisible();
  await expect(async () => {
    const [j1] = await forventArray("transaksjoner", 1);
    const { korrigeringslogg, updatedAt, ...rest } = j1!;
    expect(rest).toEqual(kilde);
    expect(typeof updatedAt).toBe("string");
    expect((korrigeringslogg as { handling: string }[]).map((p) => p.handling)).toEqual([
      "motpost_avledet",
      "motpost_avledet_angret",
    ]);
  }).toPass();

  // På nytt, og så kommer den ekte MC-motposten inn ved en senere import.
  await merkManglende();
  await expect(mc.getByText("Stemmer med avledet motpost", { exact: true })).toBeVisible();
  let naa: Record<string, unknown>[] = [];
  await expect(async () => {
    naa = await forventArray("transaksjoner", 1);
    expect(naa[0]).toMatchObject({ forventetMotpost: { konto: "MC" } });
  }).toPass();
  await settNoder({
    transaksjoner: [
      ...naa,
      tx("mc1", {
        dato: `${M}-21`,
        tekst: "Innbetaling",
        belop: 25000,
        retning: "inn",
        konto: "MC",
      }),
    ],
  });
  await expect(mc.getByText("Usikker", { exact: true })).toBeVisible();
  await expect(mc.getByRole("status")).toContainText("ingenting telles to ganger");
  await mc
    .getByRole("button", { name: /Koble Innbetaling .* som motpost til DNB BANK ASA/ })
    .click();
  await expect(mc.getByText("Avstemt", { exact: true })).toBeVisible();
  await expect(regning.getByText("Avstemt", { exact: true })).toBeVisible();

  const id = (l: Record<string, unknown>[], i: string) => l.find((t) => t.id === i)!;
  await expect(async () => {
    const l = await forventArray("transaksjoner", 2);
    expect(id(l, "j1")).toMatchObject({
      motpartTransaksjonId: "mc1",
      forventetMotpost: { konto: "MC", erstattetAv: "mc1" },
    });
    expect(id(l, "j1").saldoKorrigering).toBeUndefined();
    expect(id(l, "mc1")).toMatchObject({
      status: "behandlet",
      behandlingstype: "intern_overforing",
      motpartTransaksjonId: "j1",
    });
    // Budsjett, hendelser og regler er urørt — bare saldoavstemmingen påvirkes.
    expect(await les("hendelser")).toEqual(hendelserFor);
    expect(await les("budget")).toEqual(budsjettFor);
    expect(await les("rules")).toBeNull();
  }).toPass();
});

test("historiske måneder (#59): januar med startsaldo 31.12 året før, registrert uten transaksjon, og senere måneder er urørt", async ({
  page,
}) => {
  // Året for siste avsluttede måned — robust også når testen kjøres i januar.
  const Y = Number(maanedFoer(1).slice(0, 4));
  const jan = `${Y}-01`;
  const des = `${Y - 1}-12`;
  const trans = [tx("t-jan", { dato: `${jan}-15`, tekst: "LØNN", belop: 500, retning: "inn" })];
  await settNoder({ transaksjoner: trans, saldokontroller: null });
  await loggInn(page);
  await page.goto("/forvaltning/avstemming");

  await page
    .getByRole("navigation", { name: "Velg år" })
    .getByRole("button", { name: String(Y) })
    .click();
  await page.getByRole("button", { name: `januar ${Y}` }).click();
  await expect(page.getByRole("heading", { name: `januar ${Y}` })).toBeVisible();
  const felles = page.getByRole("region", { name: "Felleskonto" });
  await felles.getByLabel("Saldo 31. des (startpunkt)").fill("8000");
  await felles.getByRole("button", { name: "Lagre" }).first().click();
  await felles.getByLabel(/^Faktisk saldo/).fill("8500");
  await felles.getByRole("button", { name: "Lagre" }).last().click();
  await expect(felles.getByText("Avstemt", { exact: true })).toBeVisible();

  await expect(async () => {
    const k = await kontrollerPerKonto();
    expect(k.felleskonto![des]).toMatchObject({ maaned: des, faktiskSaldo: 8000 });
    expect(k.felleskonto![jan]).toMatchObject({ maaned: jan, faktiskSaldo: 8500 });
    // Ingen oppdiktet transaksjon for startsaldoen.
    expect(await forventArray("transaksjoner", 1)).toEqual(trans);
  }).toPass();

  // Desember året før kan også åpnes; siste avsluttede måned er fortsatt tilgjengelig.
  await page
    .getByRole("navigation", { name: "Velg år" })
    .getByRole("button", { name: String(Y - 1) })
    .click();
  await expect(page.getByRole("heading", { name: `desember ${Y - 1}` })).toBeVisible();
  await expect(page.getByRole("region", { name: "Felleskonto" })).toContainText("8 000,00");
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

  await expect(async () => {
    const [k] = await forventArray("receipts", 1);
    expect(k).toMatchObject({
      merchant: "Obs Bygg",
      total: 300,
      matchingStatus: expect.any(String),
    });
  }).toPass();
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

  await expect(async () => {
    const [h] = await forventArray("hendelser", 1);
    expect(h).toMatchObject({ id: "h1", status: "pa_vent", transaksjonId: "t1" });
    expect(h!.fordelinger).toBeUndefined(); // tom liste lagres ikke i RTDB
    await forventArray("transaksjoner", 2);
  }).toPass();
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
  await expect(async () => {
    const t = await forventArray("transaksjoner", 3);
    expect(t[2]).toMatchObject({ tekst: "LØNN HELEN", retning: "inn", konto: "Felleskonto" });
  }).toPass();
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

  await expect(async () => {
    const [h] = await forventArray("hendelser", 1);
    expect(h).toMatchObject({ status: "ferdig", transaksjonId: "t3" });
    const t = await forventArray("transaksjoner", 3);
    // Legacy-formen: statusen står, hendelsen avgjør at den er plassert.
    expect(t[2]).toMatchObject({ id: "t3", status: "foresoatt_match", hendelseId: h!.id });
  }).toPass();
});

test("PC-1 (#59): «Alle transaksjoner» er tabell på PC og kort på mobil fra samme data, og korrigering beholder filteret", async ({
  page,
}) => {
  const fordeling = (
    belop: number,
    eiere: { person: string; prosent: number }[],
    id = "dagligvarer",
  ) => ({
    plasseringId: id,
    plasseringType: "budget",
    plasseringNavn: id === "dagligvarer" ? "Dagligvarer" : "Parkering",
    belop,
    eiere,
  });
  await settNoder({
    transaksjoner: [
      tx("t1", { tekst: "EASYPARK", belop: 123.45, konto: "helen", dato: "2026-09-12" }),
      tx("t2", { tekst: "EasyPark AS", belop: 80, dato: "2026-09-11" }),
      tx("t3", { tekst: "LØNN", belop: 30000, retning: "inn", dato: "2026-08-25" }),
      tx("t4", { tekst: "STORHANDEL", belop: 900, dato: "2026-09-13" }),
      // Mange rader, så tabellrammen faktisk må rulles.
      ...Array.from({ length: 40 }, (_, n) =>
        tx(`f${n}`, { tekst: `FYLL ${n}`, belop: 1, status: "ignorert", dato: "2026-07-01" }),
      ),
    ],
    hendelser: [
      {
        id: "h4",
        status: "ferdig",
        paaVentAarsak: null,
        transaksjonId: "t4",
        receiptId: null,
        // Tre splitter med lange postnavn og ulikt antall eiere: post og eier
        // for samme splitt skal stå på samme høyde (review 6542071615).
        fordelinger: [
          {
            plasseringId: "a",
            plasseringType: "budget",
            plasseringNavn:
              "Svært langt postnavn for dagligvarer, husholdning og rengjøringsartikler",
            belop: 500,
            eiere: [
              { person: "Helen", prosent: 50 },
              { person: "Eivind", prosent: 50 },
            ],
          },
          {
            plasseringId: "b",
            plasseringType: "budget",
            plasseringNavn: "Barneklær",
            belop: 300,
            eiere: [{ person: "Felles", prosent: 100 }],
          },
          {
            plasseringId: "c",
            plasseringType: "budget",
            plasseringNavn: "Gaver og selskap til familie, venner og kollegaer gjennom hele året",
            belop: 100,
            eiere: [
              { person: "Helen", prosent: 70 },
              { person: "Eivind", prosent: 30 },
            ],
          },
        ],
        dato: "2026-09-13",
        regelId: null,
        opprettet: "2026-09-13T00:00:00Z",
        oppdatert: "2026-09-13T00:00:00Z",
      },
      {
        id: "h1",
        status: "ferdig",
        paaVentAarsak: null,
        transaksjonId: "t1",
        receiptId: null,
        fordelinger: [fordeling(123.45, [{ person: "Felles", prosent: 100 }], "parkering")],
        dato: "2026-09-12",
        regelId: null,
        opprettet: "2026-09-12T00:00:00Z",
        oppdatert: "2026-09-12T00:00:00Z",
      },
      {
        id: "h2",
        status: "ferdig",
        paaVentAarsak: null,
        transaksjonId: "t2",
        receiptId: null,
        fordelinger: [
          fordeling(
            80,
            [
              { person: "Helen", prosent: 50 },
              { person: "Eivind", prosent: 50 },
            ],
            "parkering",
          ),
        ],
        dato: "2026-09-11",
        regelId: null,
        opprettet: "2026-09-11T00:00:00Z",
        oppdatert: "2026-09-11T00:00:00Z",
      },
    ],
  });
  const foer = JSON.stringify(await medDb(async (db) => (await db.ref(FAM).get()).val()));
  await loggInn(page);

  const forventet = ["12.09.2026", "-123,45", "Felles", "Helen 50 %, Eivind 50 %", "+30 000,00"];
  // 640 px tilsvarer 200 % zoom i et 1280 px vindu.
  for (const [bredde, tabell] of [
    [390, false],
    [640, false],
    [800, false],
    [1280, true],
  ] as const) {
    await page.setViewportSize({ width: bredde, height: 900 });
    await page.goto("/forvaltning/transaksjoner");
    await page.getByRole("button", { name: "Alle transaksjoner" }).click();
    await expect(page.getByRole("table")).toHaveCount(tabell ? 1 : 0);
    const innhold = (await page.locator("main").innerText()).replace(/\s/g, " ");
    for (const del of forventet) expect(innhold, `${bredde}px: ${del}`).toContain(del);
    // Ingen vannrett rulling av siden.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${bredde}px uten vannrett rulling`,
    ).toBe(true);
    // Forvaltning-fanene ligger fast over bunnmenyen på mobil, øverst i innholdet på PC.
    const posisjon = await page
      .getByRole("navigation", { name: "Forvaltning-navigasjon" })
      .evaluate((n) => getComputedStyle(n).position);
    expect(posisjon, `${bredde}px fanerad`).toBe(tabell ? "static" : "fixed");
  }

  // PC ved 1024 og 1280 px: post og eier per splitt på samme høyde, og
  // overskriften blir stående når tabellrammen rulles.
  for (const bredde of [1024, 1280]) {
    await page.setViewportSize({ width: bredde, height: 800 });
    await page.goto("/forvaltning/transaksjoner");
    await page.getByRole("button", { name: "Alle transaksjoner" }).click();
    const tabell = page.getByRole("table");
    const splitt = tabell.locator("tbody").filter({ hasText: "STORHANDEL" });
    const rader = splitt.getByRole("row");
    await expect(rader).toHaveCount(3);
    for (const [n, [post, eier]] of [
      ["Svært langt postnavn", "Helen 50 %, Eivind 50 %"],
      ["Barneklær", "Felles"],
      ["Gaver og selskap", "Helen 70 %, Eivind 30 %"],
    ].entries()) {
      const rad = rader.nth(n);
      const p = (await rad.getByRole("cell", { name: new RegExp(post) }).boundingBox())!;
      const e = (await rad.getByRole("cell", { name: eier, exact: true }).boundingBox())!;
      expect(Math.abs(p.y - e.y), `${bredde}px splitt ${n}: samme topp`).toBeLessThan(1);
      expect(Math.abs(p.height - e.height), `${bredde}px splitt ${n}: samme høyde`).toBeLessThan(1);
    }
    // Faste overskrifter ved faktisk rulling av tabellrammen.
    const ramme = page.locator("main div:has(> table)");
    const foerRull = (await ramme.boundingBox())!;
    const rullet = await ramme.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(rullet, `${bredde}px: rammen ruller`).toBeGreaterThan(200);
    const th = (await page.getByRole("columnheader", { name: /Dato/ }).boundingBox())!;
    expect(
      Math.abs(th.y - foerRull.y),
      `${bredde}px: overskriften står øverst i rammen`,
    ).toBeLessThan(2);
    const vindu = page.viewportSize()!;
    expect(th.y + th.height, `${bredde}px: overskriften er synlig`).toBeLessThan(vindu.height);
  }

  // PC: tastatur på sorteringen, og korrigering beholder filteret.
  await page.getByRole("searchbox", { name: "Søk i tekst" }).fill("easypark");
  await page.getByRole("button", { name: /^Beløp/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("columnheader", { name: /Beløp/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(page.getByText("2 av 44 transaksjoner")).toBeVisible();
  await page.getByRole("button", { name: "Korriger kobling EasyPark AS" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Avbryt" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Søk i tekst" })).toHaveValue("easypark");
  await expect(page.getByText("2 av 44 transaksjoner")).toBeVisible();

  // Kontrolloversikten skriver ingenting.
  expect(JSON.stringify(await medDb(async (db) => (await db.ref(FAM).get()).val()))).toBe(foer);

  // Ingen ventende transaksjoner igjen: deler en annen suite emulatoren
  // (lokalt), forutsetter f.eks. `gangen-retur` en tom vurderingskø.
  await settNoder({ transaksjoner: null, hendelser: null });
});

test("årsbudsjett (#59, 6541936120): «samme beløp resten av året» vises i alle detaljmåneder uten refresh, lagres og står etter reload", async ({
  page,
}) => {
  const tolv = (v: number) => Array.from({ length: 12 }, () => ({ budget: v, spent: 0 }));
  const tolvD = (v: number) => Array.from({ length: 12 }, () => ({ budget: v }));
  // Årsbudsjettet trenger ingen transaksjoner; ingen ventende rader blir
  // liggende igjen for en annen suite som deler emulatoren lokalt.
  await settNoder({
    transaksjoner: null,
    budget: {
      fritid: {
        hobby: {
          name: "Hobby",
          months: tolv(50),
          budgetDetails: [
            { id: "nycha", name: "NyCha", months: tolvD(0) },
            { id: "annet", name: "Annet", months: tolvD(50) },
          ],
        },
        kino: { name: "Kino", months: tolv(100), meta: { oppforsel: "fast" } },
      },
    },
  });
  const MND = ["Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"];
  const verdier = (navn: string) =>
    Promise.all(
      MND.map((m) => page.getByRole("spinbutton", { name: `${navn} — ${m}` }).inputValue()),
    );
  const aapne = async () => {
    await page.goto("/forvaltning/arsbudsjett");
    await page.getByRole("button", { name: "Kostnader" }).click();
    await page.getByText("Fritid", { exact: true }).click();
    await page.getByRole("row", { name: /Hobby/ }).getByRole("button").first().click();
  };

  await loggInn(page);
  await aapne();
  const jan = page.getByRole("spinbutton", { name: "NyCha — Jan" });
  await jan.click();
  await jan.fill("265");
  await jan.press("Tab");
  await page.getByRole("button", { name: "Ja, resten av året" }).click();

  // Uten refresh: alle tolv detaljmåneder, og foreldreposten summerer.
  await expect.poll(() => verdier("NyCha")).toEqual(Array(12).fill("265"));
  expect(await verdier("Annet")).toEqual(Array(12).fill("50"));
  await expect(page.getByRole("row", { name: /Hobby/ }).getByText("315")).toHaveCount(12);

  // «Nei, kun juni» på en fast post endrer bare juni.
  const jun = page.getByRole("spinbutton", { name: "Kino — Jun" });
  await jun.click();
  await jun.fill("175");
  await jun.press("Tab");
  await page.getByRole("button", { name: "Nei, kun juni" }).click();
  await expect
    .poll(() => verdier("Kino"))
    .toEqual([...Array(5).fill("100"), "175", ...Array(6).fill("100")]);

  // Lagret = vist.
  await expect
    .poll(async () => {
      const b = (await les("budget")) as {
        fritid: {
          hobby: {
            months: { budget: number }[];
            budgetDetails: { months: { budget: number }[] }[];
          };
          kino: { months: { budget: number }[] };
        };
      };
      return {
        nycha: b.fritid.hobby.budgetDetails[0]!.months.map((m) => m.budget),
        hobby: b.fritid.hobby.months.map((m) => m.budget),
        kino: b.fritid.kino.months.map((m) => m.budget),
      };
    })
    .toEqual({
      nycha: Array(12).fill(265),
      hobby: Array(12).fill(315),
      kino: [...Array(5).fill(100), 175, ...Array(6).fill(100)],
    });

  // Reload viser identisk resultat.
  await aapne();
  expect(await verdier("NyCha")).toEqual(Array(12).fill("265"));
  expect(await verdier("Kino")).toEqual([...Array(5).fill("100"), "175", ...Array(6).fill("100")]);
});

test("kvalitetssikret (#59, 6542594363): merk, reload, ufarlig tidsstempel, økonomisk endring, oppheving med spor, og samme status på mobil", async ({
  page,
}) => {
  const hendelse = (belop: number, oppdatert: string) => ({
    id: "h1",
    status: "ferdig",
    paaVentAarsak: null,
    transaksjonId: "t1",
    receiptId: null,
    fordelinger: [
      {
        plasseringId: "parkering",
        plasseringType: "budget",
        plasseringNavn: "Parkering",
        belop,
        eiere: [{ person: "Felles", prosent: 100 }],
      },
    ],
    dato: "2026-09-12",
    regelId: null,
    opprettet: "2026-09-12T00:00:00Z",
    oppdatert,
  });
  await settNoder({
    transaksjoner: [
      tx("t1", { tekst: "EASYPARK", belop: 123.45, konto: "helen", dato: "2026-09-12" }),
      tx("t2", { tekst: "GEBYR", belop: 29, status: "ignorert", dato: "2026-09-02" }),
    ],
    hendelser: [hendelse(123.45, "2026-09-12T00:00:00Z")],
    transaksjonskontroller: null,
  });
  type Lagret = {
    transaksjonId: string;
    gjeldende?: { av: string; versjon: number } | null;
    spor: Record<string, { handling: string }>;
  };
  const kontroller = async () =>
    Object.values(((await les("transaksjonskontroller")) ?? {}) as Record<string, Lagret>);

  await loggInn(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const aapne = async () => {
    await page.goto("/forvaltning/transaksjoner");
    await page.getByRole("button", { name: "Alle transaksjoner" }).click();
  };
  const rad = () => page.locator("tbody").filter({ hasText: "EASYPARK" });
  const boks = (navn: string) => page.getByRole("checkbox", { name: `Kvalitetssikret: ${navn}` });
  await aapne();
  await expect(rad()).toContainText("Ferdig");
  await expect(page.getByRole("columnheader", { name: "Kvalitetssikret" })).toBeVisible();
  await expect(boks("EASYPARK")).not.toBeChecked();

  // Avhuk → lagret og avhuket, står etter reload. Hvem/når lagres, men vises ikke.
  await boks("EASYPARK").click();
  await expect(boks("EASYPARK")).toBeChecked();
  await expect(rad()).not.toContainText("e2e@hverdagsflyt.test");
  const [k1] = await kontroller();
  expect(k1).toMatchObject({
    transaksjonId: "t1",
    gjeldende: { av: expect.any(String), avNavn: "e2e@hverdagsflyt.test", versjon: 1 },
  });
  await aapne();
  await expect(boks("EASYPARK")).toBeChecked();

  // Filter på kontrollstatus gir restlisten.
  await page.getByRole("combobox", { name: "Kontroll" }).selectOption("ikke_kontrollert");
  await expect(page.locator("tbody")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("GEBYR");
  await page.getByRole("combobox", { name: "Kontroll" }).selectOption("alle");

  // Bare tidsstempelet endres: fortsatt kvalitetssikret.
  await settNoder({ hendelser: [hendelse(123.45, "2026-10-31T09:00:00Z")] });
  await expect(boks("EASYPARK")).toBeChecked();

  // Økonomisk relevant endring (fordelingsbeløp): endret etter kontroll.
  await settNoder({ hendelser: [hendelse(100, "2026-10-31T09:05:00Z")] });
  await expect(rad()).toContainText("Endret etter kontroll");
  await expect(boks("EASYPARK")).not.toBeChecked();

  // Endringer utenfor appen (som via data_skriv) i banktekst og kvittering
  // gjør også kontrollen utdatert (review 5722586456).
  await boks("EASYPARK").click();
  await expect(boks("EASYPARK")).toBeChecked();
  await expect(rad()).not.toContainText("Endret etter kontroll");
  await medDb((db) => db.ref(`${FAM}/transaksjoner/0/tekst`).set("APCOA PARKING"));
  const radNy = () => page.locator("tbody").filter({ hasText: "APCOA PARKING" });
  await expect(radNy()).toContainText("Endret etter kontroll");
  await boks("APCOA PARKING").click();
  await expect(boks("APCOA PARKING")).toBeChecked();
  await settNoder({
    receipts: [
      { id: "k1", transactionId: "t1", merchant: "APCOA", purchaseDate: "2026-09-12", total: 100 },
    ],
  });
  await expect(radNy()).toContainText("Endret etter kontroll");
  await medDb((db) => db.ref(`${FAM}/receipts`).remove());
  await expect(boks("APCOA PARKING")).toBeChecked();
  const transaksjonerFoer = JSON.stringify(await les("transaksjoner"));

  // Samme status på mobil (kvittering koblet igjen → endret).
  await settNoder({
    receipts: [
      { id: "k1", transactionId: "t1", merchant: "APCOA", purchaseDate: "2026-09-12", total: 100 },
    ],
  });
  await expect(radNy()).toContainText("Endret etter kontroll");
  // Mobil: samme boks og status på kortet, uten å åpne detaljer.
  await page.setViewportSize({ width: 390, height: 844 });
  // Statusteksten på kortet (ikke valget i filtermenyen).
  const endretPaaKort = page.locator("main span", { hasText: /^Endret etter kontroll$/ });
  await expect(endretPaaKort).toHaveCount(1);
  await expect(boks("APCOA PARKING")).not.toBeChecked();
  await boks("APCOA PARKING").click();
  await expect(boks("APCOA PARKING")).toBeChecked();
  await expect(endretPaaKort).toHaveCount(0);

  // Fjernet hake opphever: ikke kontrollert, men sporet bevares.
  await page.setViewportSize({ width: 1280, height: 900 });
  await boks("APCOA PARKING").click();
  await expect(boks("APCOA PARKING")).not.toBeChecked();
  await expect(radNy()).not.toContainText("Endret etter kontroll");
  const [k2] = await kontroller();
  expect(k2.gjeldende ?? null).toBeNull();
  expect(
    Object.values(k2.spor)
      .map((s) => s.handling)
      .sort(),
  ).toEqual([
    "kvalitetssikret",
    "kvalitetssikret",
    "kvalitetssikret",
    "kvalitetssikret",
    "opphevet",
  ]);

  // Kontrollen skrev ingenting i transaksjonene.
  expect(JSON.stringify(await les("transaksjoner"))).toBe(transaksjonerFoer);
  await settNoder({
    transaksjoner: null,
    hendelser: null,
    receipts: null,
    transaksjonskontroller: null,
  });
});

test("kvalitetssikret (review 6543489123): endret avledet motpost utenfor appen gir «Endret etter kontroll»", async ({
  page,
}) => {
  await settNoder({
    transaksjoner: [
      tx("t1", {
        tekst: "OVERFØRING MC",
        belop: 2000,
        konto: "felleskonto",
        dato: "2026-09-28",
        behandlingstype: "intern_overforing",
        status: "ferdig",
        forventetMotpost: {
          konto: "MC",
          dato: "2026-09-28",
          bekreftet: "2026-09-29T08:00:00Z",
          kilde: { belopOre: -200000, retning: "ut", konto: "felleskonto", dato: "2026-09-28" },
        },
      }),
    ],
    hendelser: null,
    receipts: null,
    transaksjonskontroller: null,
  });
  await loggInn(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/forvaltning/transaksjoner");
  await page.getByRole("button", { name: "Alle transaksjoner" }).click();
  const rad = page.locator("tbody").filter({ hasText: "OVERFØRING MC" });
  await expect(rad).toContainText("Intern overføring");
  const boks = page.getByRole("checkbox", { name: "Kvalitetssikret: OVERFØRING MC" });
  await boks.click();
  await expect(boks).toBeChecked();

  // Bare bekreftelsestiden endres: ufarlig.
  await medDb((db) =>
    db.ref(`${FAM}/transaksjoner/0/forventetMotpost/bekreftet`).set("2026-10-31T12:00:00Z"),
  );
  await expect(boks).toBeChecked();

  // Motposten flyttes fra MC til felleskonto (som via data_skriv): saldoeffekten
  // flyttes, så kontrollen er utdatert.
  await medDb((db) => db.ref(`${FAM}/transaksjoner/0/forventetMotpost/konto`).set("felleskonto"));
  await expect(rad).toContainText("Endret etter kontroll");
  await expect(boks).not.toBeChecked();

  await settNoder({ transaksjoner: null, transaksjonskontroller: null });
});

test("kvalitetssikre alle treff (#59, 6544393790): søk + filtre, frosset sett, endret etter forhåndsvisning, ny import og krympende kontrollfilter", async ({
  page,
}) => {
  await settNoder({
    transaksjoner: [
      tx("t1", { tekst: "EASYPARK", konto: "helen", dato: "2026-09-12" }),
      tx("t2", { tekst: "EASYPARK", konto: "helen", dato: "2026-10-03" }),
      tx("t3", { tekst: "EASYPARK", konto: "felleskonto", dato: "2026-09-13" }),
      tx("t4", { tekst: "EASYPARK", konto: "helen", dato: "2026-09-14" }),
      tx("t5", { tekst: "REMA 1000", konto: "helen", dato: "2026-09-15" }),
    ],
    hendelser: null,
    receipts: null,
    transaksjonskontroller: null,
  });
  const kontrollert = async () =>
    Object.values(
      ((await les("transaksjonskontroller")) ?? {}) as Record<
        string,
        { transaksjonId: string; gjeldende?: unknown }
      >,
    )
      .filter((k) => k.gjeldende)
      .map((k) => k.transaksjonId)
      .sort();

  await loggInn(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/forvaltning/transaksjoner");
  await page.getByRole("button", { name: "Alle transaksjoner" }).click();
  await page.getByRole("combobox", { name: "Konto" }).selectOption("helen");
  await page.getByRole("searchbox", { name: "Søk i tekst" }).fill("easypark");

  // t4 er allerede kvalitetssikret (enkeltavhuking).
  await page.getByRole("checkbox", { name: "Kvalitetssikret: EASYPARK" }).nth(1).click();
  await expect(async () => expect(await kontrollert()).toEqual(["t4"])).toPass();

  // Samme omfang på mobil og PC: t1, t2, t4.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Kvalitetssikre alle treff (3)" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Kvalitetssikre alle treff (3)" }).click();
  const bekreft = page.getByRole("group", { name: "Bekreft kvalitetssikring" });
  await expect(bekreft).toContainText("Kvalitetssikre 3 transaksjoner?");
  await expect(bekreft).toContainText("søk «easypark» · konto Helen");
  await expect(bekreft).toContainText("1 er allerede kvalitetssikret og hoppes over.");

  // Etter forhåndsvisningen: t2 endres (som via data_skriv) og en ny transaksjon importeres.
  await medDb((db) => db.ref(`${FAM}/transaksjoner/1/belop`).set(999));
  await medDb((db) =>
    db
      .ref(`${FAM}/transaksjoner/5`)
      .set(tx("t6", { tekst: "EASYPARK", konto: "helen", dato: "2026-10-20" })),
  );
  await expect(page.getByRole("button", { name: "Kvalitetssikre alle treff (4)" })).toHaveCount(0);
  await bekreft.getByRole("button", { name: "Kvalitetssikre 3" }).click();
  await expect(page.getByText(/kvalitetssikret · \d+ allerede/)).toHaveText(
    "1 kvalitetssikret · 1 allerede kvalitetssikret · 1 endret siden forhåndsvisning",
  );
  await expect(page.getByText(/Ikke kvalitetssikret:/)).toContainText("EASYPARK");
  expect(await kontrollert()).toEqual(["t1", "t4"]);

  // Det som fortsatt trenger kontroll, er synlig via filteret; kontrollfilteret
  // krymper under lagringen, men det frosne settet fullføres.
  await page.getByRole("combobox", { name: "Kontroll" }).selectOption("ikke_kontrollert");
  await page.getByRole("button", { name: "Kvalitetssikre alle treff (2)" }).click();
  await page.getByRole("button", { name: "Kvalitetssikre 2" }).click();
  await expect(page.getByText(/kvalitetssikret · \d+ allerede/)).toHaveText(
    "2 kvalitetssikret · 0 allerede kvalitetssikret",
  );
  await expect(page.getByText("Ingen transaksjoner matcher filtrene.")).toBeVisible();
  expect(await kontrollert()).toEqual(["t1", "t2", "t4", "t6"]);
  // Utenfor søket/kontoen er ingenting rørt.
  expect((await kontrollert()).includes("t3")).toBe(false);

  await settNoder({ transaksjoner: null, transaksjonskontroller: null });
});

test("mellomværende (#95): registrer, bekreft på forsiden, angre og juster — faktisk kostnad uten bankeffekt", async ({
  page,
}) => {
  const M = maanedFoer(0);
  await settNoder({
    budget: {
      gaver: { gaver: { name: "Gaver", months: {} } },
      fritid: { abonnementer: { name: "Abonnementer", months: {} } },
    },
    mellomvaerender: null,
    hendelser: null,
    transaksjoner: [tx("t-bank", { dato: `${M}-02` })],
  });
  const transaksjonerFor = await les("transaksjoner");
  const kontrollerFor = await les("saldokontroller");
  await loggInn(page);

  // Registrering: eierskap må velges eksplisitt.
  await page.goto("/forvaltning/mellomvaerende");
  const skjema = page.getByRole("region", { name: "Registrer mellomværende" });
  await skjema.getByLabel("Navn").fill("Gave fra mamma");
  await skjema.getByLabel("Med hvem").fill("Mamma");
  await skjema.getByLabel("Utlegg (kr)").fill("3299");
  await expect(skjema.getByLabel("Startmåned")).toHaveValue(M);
  await skjema.getByLabel("Utlegget er en kostnad på").selectOption("gaver");
  await skjema.getByLabel("Oppgjørene reduserer").selectOption("abonnementer");
  await skjema.getByLabel("Månedlig oppgjør (kr)").fill("467");
  await skjema.getByRole("button", { name: "Registrer" }).click();
  await expect(skjema.getByRole("alert")).toContainText("Velg hvem som eier kostnaden");
  await skjema
    .getByRole("group", { name: "Hvem eier kostnaden" })
    .getByRole("button", { name: "Felles" })
    .click();
  await skjema
    .getByRole("group", { name: "Hvem eier reduksjonen" })
    .getByRole("button", { name: "Felles" })
    .click();
  await skjema.getByRole("button", { name: "Registrer" }).click();
  const avtale = page.getByRole("region", { name: "Gave fra mamma", exact: true });
  await expect(avtale).toContainText(/Gjenstår\s*3\s299 kr/);

  // Forsiden: handlingskortet med forslag og rest; kostnaden er faktisk uten bank.
  await page.goto("/forvaltning");
  const kort = page.getByRole("region", { name: "Mellomværende: Gave fra mamma" });
  const kostnader = page.getByRole("button", { name: /^Kostnader/ });
  await expect(kostnader).toContainText(/3\s299/);
  await expect(kort).toContainText(/Gjenstår\s*3\s299 kr/);
  await expect(kort.getByLabel("Beløp")).toHaveValue("467");
  await kort.getByRole("button", { name: "Bekreft oppgjør" }).click();
  await expect(kort).not.toBeVisible();
  await expect(kostnader).toContainText(/2\s832/);

  await expect(async () => {
    const h = await forventArray("hendelser", 2);
    expect(h.map((x) => x.id).sort()).toEqual(
      [`mv-${(h[0]!.mellomvaerende as { id: string }).id}-${M}`, h[0]!.id].sort(),
    );
    expect(h.find((x) => String(x.id).endsWith("-kostnad"))).toMatchObject({
      kilde: "manuell",
      fordelinger: [{ plasseringId: "gaver", belop: 3299 }],
    });
    expect(h.find((x) => String(x.id).endsWith(`-${M}`))).toMatchObject({
      fordelinger: [{ plasseringId: "abonnementer", belop: -467 }],
    });
  }).toPass();

  // Ny innlasting: kortet kommer ikke tilbake.
  await page.reload();
  await expect(kostnader).toContainText(/2\s832/);
  await expect(kort).not.toBeVisible();

  // Oversikten: angre (effekten reverseres, kortet kommer tilbake), så juster til 499.
  await page.getByRole("link", { name: "Mellomværende" }).click();
  await avtale.getByRole("button", { name: /^Angre oppgjør/ }).click();
  await expect(avtale).toContainText(/Gjenstår\s*3\s299 kr/);
  await expect(avtale).toContainText("Angret");
  await page.goto("/forvaltning");
  await expect(kostnader).toContainText(/3\s299/);
  await kort.getByLabel("Beløp").fill("499");
  await kort.getByRole("button", { name: "Bekreft oppgjør" }).click();
  await expect(kort).not.toBeVisible();
  await expect(kostnader).toContainText(/2\s800/);

  await page.goto("/forvaltning/mellomvaerende");
  await expect(avtale).toContainText(/Gjenstår\s*2\s800 kr/);
  const spor = avtale.getByRole("list", { name: /^Spor for/ });
  await expect(spor.getByRole("listitem")).toHaveText([
    /^Bekreftet 467 kr/,
    /^Angret/,
    /^Bekreftet 499 kr/,
  ]);

  // Ingen bankeffekt: transaksjoner og saldokontroller er urørt.
  expect(await les("transaksjoner")).toEqual(transaksjonerFor);
  expect(await les("saldokontroller")).toEqual(kontrollerFor);

  await settNoder({
    mellomvaerender: null,
    hendelser: null,
    transaksjoner: null,
    budget: { mat: { dagligvarer: { name: "Dagligvarer", months: {} } } },
  });
});
