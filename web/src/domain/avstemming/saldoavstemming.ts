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
 *  - **Importerte bankbevegelser teller**, også interne overføringer
 *    (reelle bevegelser på begge kontoer). MCs «Skyldig beløp»-linje er
 *    aldri en transaksjon (filtreres ved import, #66); «Innbetaling» er en
 *    inn-bevegelse.
 *  - **Ignorerte transaksjoner** (Kontrolltårnet 6062856860): «Ignorer» er én
 *    generisk handling uten årsak, så en ignorert linje kan være en ekte
 *    bankbevegelse (ignorert for budsjettet) eller en dublett. Eksakte
 *    dubletter stoppes allerede ved import (`dupKey`), men dubletter med
 *    ulik tekst kan slippe gjennom og bli ignorert. Derfor (`saldoRolle`):
 *    `ignorertSom: "bankbevegelse"` teller, `"dublett"` teller ikke, og en
 *    ignorert linje UTEN avklaring gjør måneden **usikker** — den blir aldri
 *    «avstemt», og differansen vises for begge tolkninger. Gammel data
 *    endres aldri automatisk; bare Helen avklarer.
 *  - **Fortegn:** `belop` er absoluttverdi, `retning` bærer fortegnet;
 *    netto = inn − ut, summert i hele øre. Saldo har fortegn sett fra
 *    kontoeieren, så MC-gjeld er negativ: kjøp (ut) øker gjelden,
 *    innbetaling (inn) reduserer den — samme regnestykke for alle kontoer.
 *  - **Måned = transaksjonsdatoens kalendermåned** (`dato`). Datoer flyttes
 *    aldri; bevegelser nær månedsskiftet vises som mulig forklaring.
 *  - **Avledede motposter** (6097196546): en intern overføring der den ekte
 *    motposten mangler, kan ha en `forventetMotpost` på en annen konto. Den
 *    regnes inn i mottakerkontoens beregnede saldo, men holdes atskilt fra
 *    de bankimporterte bevegelsene: stemmer saldoen bare med den, er
 *    statusen `avstemt_avledet`, aldri `avstemt`. Finnes en importert
 *    transaksjon som kan være den ekte motposten, telles den avledede ikke
 *    og måneden er usikker til Helen kobler — aldri dobbelttelling.
 *    Kildekontoen teller kildetransaksjonen som før, uavhengig av paret.
 */
import type { SaldoKontroll } from "@app-types/avstemming";
import type { Retning, TransaksjonRecord } from "@app-types/forsoning";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import {
  gjeldendeForventetMotpost,
  kildeEndretGrunn,
  erInternOverforing,
  importerteMotposter,
  vurderForventetMotpost,
} from "./saldokorrigering";

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

/** Måneden etter (`2025-12` → `2026-01`). */
export function nesteMaaned(maaned: string): string {
  const [aar, mnd] = maaned.split("-").map(Number) as [number, number];
  return mnd === 12 ? `${aar + 1}-01` : `${aar}-${String(mnd + 1).padStart(2, "0")}`;
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

/** Om en transaksjon har en gyldig dato og dermed hører til en måned. */
export function inngaarISaldo(t: Pick<TransaksjonRecord, "dato">): boolean {
  return maanedFor(t.dato) !== null;
}

/** Hvordan en transaksjon påvirker saldoen (se filens toppkommentar). */
export type SaldoRolle = "teller" | "dublett" | "uavklart";

export function saldoRolle(t: Pick<TransaksjonRecord, "status" | "ignorertSom">): SaldoRolle {
  if (t.status !== "ignorert") return "teller";
  if (t.ignorertSom === "dublett") return "dublett";
  if (t.ignorertSom === "bankbevegelse") return "teller";
  return "uavklart";
}

/** Fortegnet beløp i øre: inn positivt, ut negativt. */
export const nettoOre = (t: Pick<TransaksjonRecord, "belop" | "retning">): number =>
  t.retning === "inn" ? tilOre(t.belop) : -tilOre(t.belop);

/** En avledet motpost slik den regnes på mottakerkontoen. */
export interface AvledetPost {
  /** Kildetransaksjonen på den andre kontoen — der den avledede posten er lagret. */
  kilde: TransaksjonRecord;
  dato: string;
  retning: Retning;
  nettoOre: number;
  /** Importerte transaksjoner på kontoen som kan være den ekte motposten. */
  kandidater: TransaksjonRecord[];
  /** Satt når kilden er endret etter bekreftelsen: posten teller ikke før ny bekreftelse. */
  kildeEndret?: string;
}

export interface Maanedsgrunnlag {
  /** Alle transaksjoner i måneden på kontoen, uansett rolle. */
  antall: number;
  /** Inn/ut/netto for transaksjonene som TELLER i saldo. */
  innOre: number;
  utOre: number;
  nettoOre: number;
  transaksjoner: TransaksjonRecord[];
  /** Ignorerte uten avklaring — gjør måneden usikker. */
  uavklarte: { antall: number; nettoOre: number; transaksjoner: TransaksjonRecord[] };
  /** Ignorerte avklart som dubletter — holdt utenfor saldoen. */
  dubletter: { antall: number; nettoOre: number };
  /** Mulige dubletter: samme dato, beløp og retning på samme konto. */
  muligeDubletter: TransaksjonRecord[][];
  /** Bevegelser de første/siste `GRENSEDAGER` dagene — bokføringsdato kan avvike. */
  vedMaanedsskiftet: TransaksjonRecord[];
  /** Avledede motposter (ikke bankimportert) som teller i beregnet saldo. */
  avledede: { antall: number; nettoOre: number; poster: AvledetPost[] };
  /** Avledede motposter med en mulig importert motpost — teller ikke, gjør måneden usikker. */
  avledetMedKandidat: AvledetPost[];
  /**
   * Avledede motposter der kilden er endret etter bekreftelsen (beløp,
   * retning, konto eller dato) — teller ikke, gjør måneden usikker til
   * Helen bekrefter på nytt.
   */
  avledetKildeEndret: AvledetPost[];
}

/**
 * Gjeldende avledede motposter på `konto` i `maaned`, med mulige importerte
 * motposter, og med `kildeEndret` når kilden ikke lenger er slik den ble
 * bekreftet.
 */
export function avlededePoster(
  transaksjoner: readonly TransaksjonRecord[],
  konto: string,
  maaned: string,
): AvledetPost[] {
  const poster: AvledetPost[] = [];
  for (const t of transaksjoner) {
    const f = gjeldendeForventetMotpost(t);
    if (!f || f.konto !== konto || maanedFor(f.dato) !== maaned) continue;
    const retning: Retning = t.retning === "inn" ? "ut" : "inn";
    const endret = kildeEndretGrunn(t);
    poster.push({
      kilde: t,
      dato: f.dato,
      retning,
      nettoOre: nettoOre({ belop: t.belop, retning }),
      kandidater: endret ? [] : importerteMotposter(t, transaksjoner),
      ...(endret ? { kildeEndret: endret } : {}),
    });
  }
  return poster.sort(
    (a, b) => a.dato.localeCompare(b.dato) || a.kilde.id.localeCompare(b.kilde.id),
  );
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
    if (saldoRolle(t) !== "teller") continue;
    if (t.retning === "inn") innOre += tilOre(t.belop);
    else utOre += tilOre(t.belop);
  }
  const uavklarte = liste.filter((t) => saldoRolle(t) === "uavklart");
  const dubletter = liste.filter((t) => saldoRolle(t) === "dublett");
  const grupper = new Map<string, TransaksjonRecord[]>();
  for (const t of liste) {
    const nokkel = `${t.dato}|${tilOre(t.belop)}|${t.retning}`;
    grupper.set(nokkel, [...(grupper.get(nokkel) ?? []), t]);
  }
  const sisteDag = Number(sisteDagIMaaned(maaned).slice(8));
  const dag = (t: TransaksjonRecord) => Number(t.dato.slice(8, 10));
  const avledet = avlededePoster(transaksjoner, konto, maaned);
  const gyldige = avledet.filter((p) => !p.kildeEndret);
  const teller = gyldige.filter((p) => p.kandidater.length === 0);
  return {
    antall: liste.length,
    innOre,
    utOre,
    nettoOre: innOre - utOre,
    transaksjoner: liste,
    uavklarte: {
      antall: uavklarte.length,
      nettoOre: uavklarte.reduce((s, t) => s + nettoOre(t), 0),
      transaksjoner: uavklarte,
    },
    dubletter: {
      antall: dubletter.length,
      nettoOre: dubletter.reduce((s, t) => s + nettoOre(t), 0),
    },
    muligeDubletter: [...grupper.values()].filter((g) => g.length > 1),
    vedMaanedsskiftet: liste.filter(
      (t) => dag(t) <= GRENSEDAGER || dag(t) > sisteDag - GRENSEDAGER,
    ),
    avledede: {
      antall: teller.length,
      nettoOre: teller.reduce((s, p) => s + p.nettoOre, 0),
      poster: teller,
    },
    avledetMedKandidat: gyldige.filter((p) => p.kandidater.length > 0),
    avledetKildeEndret: avledet.filter((p) => !!p.kildeEndret),
  };
}

/**
 * Bevegelser på ANDRE kontoer i måneden som kan mangle en motpost her:
 * interne overføringer uten motpost og ignorerte linjer, som Helen kan gi
 * en avledet motpost. Forslag, ikke konklusjon — ingenting kobles selv.
 */
export function muligeKilderForMotpost(
  transaksjoner: readonly TransaksjonRecord[],
  konto: string,
  maaned: string,
): TransaksjonRecord[] {
  return transaksjoner
    .filter(
      (t) =>
        maanedFor(t.dato) === maaned &&
        normaliserKonto(t) !== konto &&
        (erInternOverforing(t) || t.status === "ignorert") &&
        vurderForventetMotpost(t).kan,
    )
    .sort((a, b) => a.dato.localeCompare(b.dato) || a.id.localeCompare(b.id));
}

export type KontrollStatus =
  | "ingen_saldo"
  | "startpunkt"
  | "avstemt"
  /** Stemmer bare takket være avledede motposter — ikke bankverifisert. */
  | "avstemt_avledet"
  | "avvik"
  | "usikker";

export interface KontoMaanedVurdering {
  konto: string;
  maaned: string;
  status: KontrollStatus;
  kontroll: SaldoKontroll | null;
  /** Forrige måneds faktiske saldo i øre, eller `null` når den mangler. */
  forrigeSaldoOre: number | null;
  grunnlag: Maanedsgrunnlag;
  /** Forrige faktiske + bankimportert netto + avledet netto, eller `null` uten forrige måned. */
  beregnetOre: number | null;
  /**
   * Faktisk − beregnet (uten uavklarte ignorerte): positiv = mer i banken
   * enn beregnet. Er måneden usikker, er dette differansen HVIS de
   * uavklarte er dubletter.
   */
  differanseOre: number | null;
  /** Differansen HVIS de uavklarte er ekte bankbevegelser (bare ved uavklarte). */
  differanseMedUavklarteOre: number | null;
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
  const beregnetOre =
    forrigeSaldoOre === null
      ? null
      : forrigeSaldoOre + grunnlag.nettoOre + grunnlag.avledede.nettoOre;
  const differanseOre =
    kontroll && beregnetOre !== null ? tilOre(kontroll.faktiskSaldo) - beregnetOre : null;
  const differanseMedUavklarteOre =
    differanseOre !== null && grunnlag.uavklarte.antall > 0
      ? differanseOre - grunnlag.uavklarte.nettoOre
      : null;
  // Uavklarte ignorerte, og avledede motposter med en mulig importert
  // motpost, gjør en kontrollerbar måned usikker — aldri et sikkert
  // «avstemt», og heller ikke et sikkert avvik.
  const status: KontrollStatus = !kontroll
    ? "ingen_saldo"
    : differanseOre === null
      ? "startpunkt"
      : grunnlag.uavklarte.antall > 0 ||
          grunnlag.avledetMedKandidat.length > 0 ||
          grunnlag.avledetKildeEndret.length > 0
        ? "usikker"
        : differanseOre !== 0
          ? "avvik"
          : grunnlag.avledede.antall > 0
            ? "avstemt_avledet"
            : "avstemt";
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
    differanseMedUavklarteOre,
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
  for (const t of transaksjoner) {
    const f = gjeldendeForventetMotpost(t);
    if (f && maanedFor(f.dato) !== null) kontoer.add(f.konto);
  }
  return [...kontoer].sort((a, b) => (a === "MC" ? -1 : b === "MC" ? 1 : a.localeCompare(b, "nb")));
}

/** Øvre grense for hvor langt bakover avstemmingen viser (vern mot feildaterte rader). */
export const MAKS_MAANEDER = 120;

/**
 * Første måned avstemmingen viser (#59, 6097132388): januar i året for siste
 * avsluttede måned, eller tidligere når det finnes transaksjoner eller
 * kontrollpunkter før det. Et kontrollpunkt for desember 2025 er startsaldo
 * for januar 2026, så måneden ETTER kontrollpunktet tas med.
 */
export function foersteAvstemmingsmaaned(
  transaksjoner: readonly TransaksjonRecord[],
  kontroller: readonly SaldoKontroll[],
  idag: Date,
): string {
  const siste = sisteAvsluttedeMaaned(idag);
  let fra = `${siste.slice(0, 4)}-01`;
  for (const t of transaksjoner) {
    const m = maanedFor(t.dato);
    if (m && m < fra) fra = m;
  }
  for (const k of kontroller) {
    const m = nesteMaaned(k.maaned);
    if (m < fra) fra = m;
  }
  return fra > siste ? siste : fra;
}

/** Alle avsluttede måneder fra og med `fra`, nyeste først (høyst `MAKS_MAANEDER`). */
export function maanederFra(fra: string, idag: Date): string[] {
  const maaneder: string[] = [];
  let m = sisteAvsluttedeMaaned(idag);
  while (m >= fra && maaneder.length < MAKS_MAANEDER) {
    maaneder.push(m);
    m = forrigeMaaned(m);
  }
  return maaneder;
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
  /** Antall siste måneder, eller første måned som tas med. Standard: hele historikken. */
  omfang: number | { fra: string } = {
    fra: foersteAvstemmingsmaaned(transaksjoner, kontroller, idag),
  },
): Avstemmingsoversikt {
  const kontoer = kontoerIAvstemming(transaksjoner, kontroller);
  const maaneder =
    typeof omfang === "number" ? avstemmingsmaaneder(idag, omfang) : maanederFra(omfang.fra, idag);
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
  /** Kontoer der uavklarte ignorerte transaksjoner gjør kontrollen usikker. */
  usikre: number;
  /** Kontoer som stemmer bare med avledede motposter — ikke regnet som avstemt. */
  avledet: number;
}

/**
 * Status for én kalendermåned på tvers av kontoer — Lønnsdagsrundens
 * statuslinje. Kontoer uten bevegelser og uten kontrollpunkt i måneden
 * teller ikke med.
 */
export function maanedskontroll(o: Avstemmingsoversikt, maaned: string): Maanedskontroll {
  const vurderinger = o.kontoer
    .map((k) => o.celler[k]?.[maaned])
    .filter(
      (v): v is KontoMaanedVurdering =>
        !!v &&
        (v.grunnlag.antall > 0 ||
          !!v.kontroll ||
          v.grunnlag.avledede.antall > 0 ||
          v.grunnlag.avledetMedKandidat.length > 0 ||
          v.grunnlag.avledetKildeEndret.length > 0),
    );
  return {
    maaned,
    avstemte: vurderinger.filter((v) => v.status === "avstemt").length,
    totalt: vurderinger.length,
    avvik: vurderinger.filter((v) => v.status === "avvik").length,
    usikre: vurderinger.filter((v) => v.status === "usikker").length,
    avledet: vurderinger.filter((v) => v.status === "avstemt_avledet").length,
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
