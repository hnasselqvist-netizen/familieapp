/**
 * Saldoavstemming per konto og kalendermåned (#59, Helens produktbeslutning
 * 2026-10-08, Kontrolltårnet 6059631349). Rene funksjoner.
 *
 * Helens etablerte logikk:
 *   faktisk saldo siste dag forrige måned
 *   + netto effekt av importerte transaksjoner i måneden
 *   = beregnet saldo siste dag denne måneden,
 * sammenlignet med faktisk saldo fra banken samme dag.
 *
 * Regler som ligger fast her:
 *  - **Status lagres aldri.** Alt utledes av kontrollpunktene og dagens
 *    transaksjoner, så etterimporterte eller endrede transaksjoner
 *    revurderer statusen automatisk.
 *  - **Å registrere en saldo markerer aldri noe som avstemt.** Første
 *    punkt for en konto (eller et punkt uten forrige måned) er et
 *    startpunkt; bare null i differanse mot forrige måneds FAKTISKE saldo
 *    er «avstemt».
 *  - **Neste måned bygger på forrige måneds faktiske saldo** (bankens tall),
 *    ikke den beregnede — et avvik forplanter seg ikke.
 *  - **Alle importerte bankbevegelser teller**, også interne overføringer
 *    (reelle bevegelser på begge kontoer) og ignorerte transaksjoner
 *    (`inngaarISaldo`). En ignorert ekte dublett gir da et synlig avvik,
 *    aldri en falsk «avstemt». MCs «Skyldig beløp»-linje er aldri en
 *    transaksjon (filtreres ved import, #66); «Innbetaling» er en inn-bevegelse.
 *  - **Fortegn:** `belop` er absoluttverdi, `retning` bærer fortegnet;
 *    netto = inn − ut, summert i hele øre. Saldo har fortegn sett fra
 *    kontoeieren, så MC-gjeld er negativ: kjøp (ut) øker gjelden,
 *    innbetaling (inn) reduserer den — samme regnestykke for alle kontoer.
 *  - **Måned = transaksjonsdatoens kalendermåned** (`dato`). Datoer flyttes
 *    aldri; bevegelser nær månedsskiftet vises som mulig forklaring.
 */
import type { SaldoKontroll } from "@app-types/avstemming";
import type { TransaksjonRecord } from "@app-types/forsoning";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";

/** `normaliserKonto` sin verdi for en transaksjon uten kjent konto. */
export const UKJENT_KONTO = "?";

/** Kontoen med gjeld som saldo — Helen taster «Skyldig beløp», vi lagrer negativt. */
export const erGjeldskonto = (konto: string): boolean => konto === "MC";

/** Antall dager i hver ende av måneden som vises som mulig datoforklaring. */
export const GRENSEDAGER = 3;

/** `YYYY-MM` for en `YYYY-MM-DD`-dato, eller `null` for en ugyldig dato. */
export function maanedFor(dato: string | null | undefined): string | null {
  return dato && /^\d{4}-\d{2}-\d{2}/.test(dato) ? dato.slice(0, 7) : null;
}

/** Måneden før (`2026-01` → `2025-12`). */
export function forrigeMaaned(maaned: string): string {
  const [aar, mnd] = maaned.split("-").map(Number) as [number, number];
  return mnd === 1 ? `${aar - 1}-12` : `${aar}-${String(mnd - 1).padStart(2, "0")}`;
}

/** Siste dag i måneden (`2026-02` → `2026-02-28`). */
export function sisteDagIMaaned(maaned: string): string {
  const [aar, mnd] = maaned.split("-").map(Number) as [number, number];
  const dag = new Date(Date.UTC(aar, mnd, 0)).getUTCDate();
  return `${maaned}-${String(dag).padStart(2, "0")}`;
}

/** Kalendermåneden for en lokal dato (`YYYY-MM`). */
export function maanedForDato(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Siste avsluttede kalendermåned — den som skal avstemmes nå. */
export const sisteAvsluttedeMaaned = (idag: Date): string => forrigeMaaned(maanedForDato(idag));

const tilOre = (kr: number | null | undefined): number => Math.round((Number(kr) || 0) * 100);
export const oreTilKr = (ore: number): number => ore / 100;

/**
 * Om en transaksjon er en bankbevegelse som teller i saldoen. Alle
 * importerte linjer teller — også ignorerte og interne overføringer (se
 * filens toppkommentar). Bare linjer uten gyldig dato utelates.
 */
export function inngaarISaldo(t: Pick<TransaksjonRecord, "dato">): boolean {
  return maanedFor(t.dato) !== null;
}

/** Fortegnet beløp i øre: inn positivt, ut negativt. */
export const nettoOre = (t: Pick<TransaksjonRecord, "belop" | "retning">): number =>
  t.retning === "inn" ? tilOre(t.belop) : -tilOre(t.belop);

export interface Maanedsgrunnlag {
  antall: number;
  innOre: number;
  utOre: number;
  nettoOre: number;
  transaksjoner: TransaksjonRecord[];
  /** Ignorerte bevegelser i måneden — teller, men vises som mulig forklaring. */
  ignorert: { antall: number; nettoOre: number };
  /** Mulige dubletter: samme dato, beløp og retning på samme konto. */
  muligeDubletter: TransaksjonRecord[][];
  /** Bevegelser de første/siste `GRENSEDAGER` dagene — bokføringsdato kan avvike. */
  vedMaanedsskiftet: TransaksjonRecord[];
}

/** Månedens bankbevegelser på én konto. */
export function maanedsgrunnlag(
  transaksjoner: readonly TransaksjonRecord[],
  konto: string,
  maaned: string,
): Maanedsgrunnlag {
  const liste = transaksjoner.filter(
    (t) => inngaarISaldo(t) && maanedFor(t.dato) === maaned && normaliserKonto(t) === konto,
  );
  let innOre = 0;
  let utOre = 0;
  for (const t of liste) {
    if (t.retning === "inn") innOre += tilOre(t.belop);
    else utOre += tilOre(t.belop);
  }
  const ignorerte = liste.filter((t) => t.status === "ignorert");
  const grupper = new Map<string, TransaksjonRecord[]>();
  for (const t of liste) {
    const nokkel = `${t.dato}|${tilOre(t.belop)}|${t.retning}`;
    grupper.set(nokkel, [...(grupper.get(nokkel) ?? []), t]);
  }
  const sisteDag = Number(sisteDagIMaaned(maaned).slice(8));
  const dag = (t: TransaksjonRecord) => Number(t.dato.slice(8, 10));
  return {
    antall: liste.length,
    innOre,
    utOre,
    nettoOre: innOre - utOre,
    transaksjoner: liste,
    ignorert: {
      antall: ignorerte.length,
      nettoOre: ignorerte.reduce((s, t) => s + nettoOre(t), 0),
    },
    muligeDubletter: [...grupper.values()].filter((g) => g.length > 1),
    vedMaanedsskiftet: liste.filter(
      (t) => dag(t) <= GRENSEDAGER || dag(t) > sisteDag - GRENSEDAGER,
    ),
  };
}

export type KontrollStatus = "ingen_saldo" | "startpunkt" | "avstemt" | "avvik";

export interface KontoMaanedVurdering {
  konto: string;
  maaned: string;
  status: KontrollStatus;
  kontroll: SaldoKontroll | null;
  /** Forrige måneds faktiske saldo i øre, eller `null` når den mangler. */
  forrigeSaldoOre: number | null;
  grunnlag: Maanedsgrunnlag;
  /** Forrige faktiske + netto, eller `null` uten forrige måned. */
  beregnetOre: number | null;
  /** Faktisk − beregnet: positiv = mer i banken enn beregnet. */
  differanseOre: number | null;
  /** Antall/netto har endret seg siden saldoen ble registrert. */
  grunnlagEndret: boolean;
  /** Endring i antall transaksjoner siden registrering (ved `grunnlagEndret`). */
  endringAntall: number;
}

/** Kontrollpunkt for konto/måned, eller `null`. */
export function finnKontroll(
  kontroller: readonly SaldoKontroll[],
  konto: string,
  maaned: string,
): SaldoKontroll | null {
  return kontroller.find((k) => k.konto === konto && k.maaned === maaned) ?? null;
}

/** Status og regnestykke for én konto i én kalendermåned. */
export function vurderKontoMaaned(
  transaksjoner: readonly TransaksjonRecord[],
  kontroller: readonly SaldoKontroll[],
  konto: string,
  maaned: string,
): KontoMaanedVurdering {
  const grunnlag = maanedsgrunnlag(transaksjoner, konto, maaned);
  const kontroll = finnKontroll(kontroller, konto, maaned);
  const forrige = finnKontroll(kontroller, konto, forrigeMaaned(maaned));
  const forrigeSaldoOre = forrige ? tilOre(forrige.faktiskSaldo) : null;
  const beregnetOre = forrigeSaldoOre === null ? null : forrigeSaldoOre + grunnlag.nettoOre;
  const differanseOre =
    kontroll && beregnetOre !== null ? tilOre(kontroll.faktiskSaldo) - beregnetOre : null;
  const status: KontrollStatus = !kontroll
    ? "ingen_saldo"
    : differanseOre === null
      ? "startpunkt"
      : differanseOre === 0
        ? "avstemt"
        : "avvik";
  const grunnlagEndret =
    !!kontroll?.grunnlag &&
    (kontroll.grunnlag.antall !== grunnlag.antall ||
      kontroll.grunnlag.nettoOre !== grunnlag.nettoOre);
  return {
    konto,
    maaned,
    status,
    kontroll,
    forrigeSaldoOre,
    grunnlag,
    beregnetOre,
    differanseOre,
    grunnlagEndret,
    endringAntall: grunnlagEndret ? grunnlag.antall - (kontroll?.grunnlag?.antall ?? 0) : 0,
  };
}

/**
 * Kontoene som vises: alle kjente kontoer med bevegelser eller
 * kontrollpunkter. MC først, så alfabetisk — stabil rekkefølge.
 */
export function kontoerIAvstemming(
  transaksjoner: readonly TransaksjonRecord[],
  kontroller: readonly SaldoKontroll[],
): string[] {
  const kontoer = new Set<string>();
  for (const t of transaksjoner) {
    if (!inngaarISaldo(t)) continue;
    const k = normaliserKonto(t);
    if (k !== UKJENT_KONTO) kontoer.add(k);
  }
  for (const k of kontroller) kontoer.add(k.konto);
  return [...kontoer].sort((a, b) => (a === "MC" ? -1 : b === "MC" ? 1 : a.localeCompare(b, "nb")));
}

/** De `antall` siste avsluttede kalendermånedene, nyeste først. */
export function avstemmingsmaaneder(idag: Date, antall = 6): string[] {
  const maaneder: string[] = [];
  let m = sisteAvsluttedeMaaned(idag);
  for (let i = 0; i < antall; i++) {
    maaneder.push(m);
    m = forrigeMaaned(m);
  }
  return maaneder;
}

export interface Avstemmingsoversikt {
  kontoer: string[];
  /** Nyeste først. */
  maaneder: string[];
  celler: Record<string, Record<string, KontoMaanedVurdering>>;
  /** Bevegelser uten kjent konto per måned — kan ikke henføres. */
  ukjentKonto: Record<string, number>;
}

export function avstemmingsoversikt(
  transaksjoner: readonly TransaksjonRecord[],
  kontroller: readonly SaldoKontroll[],
  idag: Date,
  antallMaaneder = 6,
): Avstemmingsoversikt {
  const kontoer = kontoerIAvstemming(transaksjoner, kontroller);
  const maaneder = avstemmingsmaaneder(idag, antallMaaneder);
  const celler: Avstemmingsoversikt["celler"] = {};
  for (const k of kontoer) {
    celler[k] = {};
    for (const m of maaneder) celler[k]![m] = vurderKontoMaaned(transaksjoner, kontroller, k, m);
  }
  const ukjentKonto: Record<string, number> = {};
  for (const m of maaneder) {
    ukjentKonto[m] = transaksjoner.filter(
      (t) => inngaarISaldo(t) && maanedFor(t.dato) === m && normaliserKonto(t) === UKJENT_KONTO,
    ).length;
  }
  return { kontoer, maaneder, celler, ukjentKonto };
}

export interface Maanedskontroll {
  maaned: string;
  avstemte: number;
  /** Kontoer med bevegelser i måneden eller et kontrollpunkt. */
  totalt: number;
  avvik: number;
}

/**
 * Status for én kalendermåned på tvers av kontoer — Lønnsdagsrundens
 * statuslinje. Kontoer uten bevegelser og uten kontrollpunkt i måneden
 * teller ikke med.
 */
export function maanedskontroll(o: Avstemmingsoversikt, maaned: string): Maanedskontroll {
  const vurderinger = o.kontoer
    .map((k) => o.celler[k]?.[maaned])
    .filter((v): v is KontoMaanedVurdering => !!v && (v.grunnlag.antall > 0 || !!v.kontroll));
  return {
    maaned,
    avstemte: vurderinger.filter((v) => v.status === "avstemt").length,
    totalt: vurderinger.length,
    avvik: vurderinger.filter((v) => v.status === "avvik").length,
  };
}

/** Saldoen slik Helen taster/leser den: MC som positivt «Skyldig beløp». */
export const tilVisningsSaldo = (konto: string, faktiskSaldo: number): number =>
  erGjeldskonto(konto) ? -faktiskSaldo : faktiskSaldo;

/** Fra tastet verdi til lagret saldo med fortegn (MC-gjeld blir negativ). */
export const fraVisningsSaldo = (konto: string, tastet: number): number =>
  erGjeldskonto(konto) ? -tastet : tastet;

/** Kontrollpunktet som skal lagres for konto/måned, med øyeblikksbilde av grunnlaget. */
export function byggSaldoKontroll(
  transaksjoner: readonly TransaksjonRecord[],
  eksisterende: SaldoKontroll | null,
  konto: string,
  maaned: string,
  faktiskSaldo: number,
  naa: string,
): SaldoKontroll {
  const g = maanedsgrunnlag(transaksjoner, konto, maaned);
  return {
    konto,
    maaned,
    dato: sisteDagIMaaned(maaned),
    faktiskSaldo: oreTilKr(tilOre(faktiskSaldo)),
    registrert: eksisterende?.registrert ?? naa,
    oppdatert: naa,
    grunnlag: { antall: g.antall, nettoOre: g.nettoOre },
  };
}
