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
  const etter = await forventArray("transaksjoner", 6);
  expect(etter.slice(0, 5)).toEqual(forImport);
  expect(etter[5]).toMatchObject({ tekst: "REMA 1000 GLEMT", belop: 250, dato: `${M}-28` });
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
