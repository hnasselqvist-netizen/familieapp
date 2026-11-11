/**
 * Felles avledet modell for avstemmingen (#59, AV-1; Kontrolltårnet
 * 6542147711 / 6542342933 / 6572970205). Rene funksjoner.
 *
 * Bygger UTELUKKENDE på de eksisterende vurderingene i `saldoavstemming`
 * (`avstemmingsoversikt` → `vurderKontoMaaned`). Saldo-, motpost-, dublett-
 * og fortegnsberegningen endres ikke her; modellen bare leser dem og gjør
 * dem om til rader og konkrete problemer for PC (AV-1) og mobil (AV-2).
 *
 * Regler som ligger fast:
 *  - **Ingenting lagres.** Rader, problemer og status utledes på nytt fra
 *    abonnementet hver gang transaksjoner eller kontrollpunkter endres. Et
 *    problem forsvinner derfor bare når lagringen er bekreftet OG den nye
 *    vurderingen ikke lenger har det — aldri ved et klikk.
 *  - **Delvis løst er ikke OK.** En rad er OK bare når statusen er
 *    «avstemt» og ingen problemer gjenstår.
 *  - **Ingen konto er ferdig fordi den mangler bevegelser.** Fra kontoens
 *    start (første registrerte saldo, eller første bevegelse når den aldri
 *    har hatt saldo) krever hver avsluttede måned en saldo, også uten
 *    bevegelser.
 *  - **Begrenset periode.** Månedene er de avstemmingen allerede viser
 *    (`foersteAvstemmingsmaaned` → siste avsluttede måned); inneværende og
 *    fremtidige måneder er aldri med. Før en kontos første registrerte
 *    saldo («før start») og i selve startsaldomåneden («start») kreves
 *    ingen saldo — de lager aldri `mangler_saldo` eller `startpunkt`. Men
 *    faktisk åpent grunnlag i disse månedene (uavklart ignorert,
 *    avledet/usikkert, endret grunnlag etter etterimport) er fortsatt et
 *    problem og skjules ikke av periodebegrensningen (review 5764883177).
 *  - **Ukjent konto** er et problem i måneden selv, uten kontorad.
 *  - **Konfigurerte kontoer** (`KONTOER` fra bankimporten) uten noen data
 *    vises som rader («ingen data») så de ikke forsvinner, men lager ikke
 *    problemer før de har bevegelser eller saldo.
 */
import type { TransaksjonRecord } from "@app-types/forsoning";
import {
  type Avstemmingsoversikt,
  type KontoMaanedVurdering,
  type KontrollStatus,
  UKJENT_KONTO,
  forrigeMaaned,
  maanedFor,
  muligeKilderForMotpost,
} from "./saldoavstemming";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import { vurderAvslutningForventet } from "./saldokorrigering";

export type ProblemType =
  /** Aktiv måned uten registrert saldo fra banken. */
  | "mangler_saldo"
  /** Saldo er registrert, men forrige måned mangler: kan ikke kontrolleres. */
  | "startpunkt"
  /** Ignorerte transaksjoner uten avklaring: dublett eller ekte bevegelse? */
  | "uavklart_ignorert"
  /** En avledet motpost kan allerede være importert: koble eller avklar. */
  | "avledet_mulig_importert"
  /** Kilden til en avledet motpost er endret etter bekreftelsen. */
  | "avledet_kilde_endret"
  /** En avledet motpost på kontoens transaksjon er endret i Transaksjoner. */
  | "avledet_endret"
  | "avvik"
  /** Ved avvik: interne overføringer på andre kontoer mangler motpost her. */
  | "manglende_motpost"
  /** Transaksjonsgrunnlaget er endret siden saldoen ble registrert. */
  | "grunnlag_endret"
  /** Stemmer bare med avledede motposter — ikke bankverifisert. */
  | "avledet"
  /** Bevegelser uten kjent konto — kan ikke avstemmes mot noen konto. */
  | "ukjent_konto";

/** Rekkefølgen problemene løses i: neste handling er det første. */
export const PROBLEM_REKKEFOLGE: readonly ProblemType[] = [
  "ukjent_konto",
  "mangler_saldo",
  "startpunkt",
  "uavklart_ignorert",
  "avledet_mulig_importert",
  "avledet_kilde_endret",
  "avledet_endret",
  "avvik",
  "manglende_motpost",
  "grunnlag_endret",
  "avledet",
];

export interface Problem {
  type: ProblemType;
  /** Kontoen, eller `UKJENT_KONTO` («?») for bevegelser uten konto. */
  konto: string;
  maaned: string;
  /** Antall transaksjoner/poster problemet gjelder, når det gir mening. */
  antall?: number;
  /** Beløp i øre med fortegn (differanse, netto av uavklarte e.l.). */
  belopOre?: number;
}

/**
 * Hvor kontoen står i måneden:
 *  - `aktiv`: del av avstemmingen — krever saldo og kan ha problemer.
 *  - `start`: måneden med kontoens første registrerte saldo (startsaldo).
 *    Den er grunnlaget for neste måned, ikke en avstemt måned. Saldoen
 *    mangler ikke her, men åpent grunnlag i måneden er et problem.
 *  - `foer_start`: før kontoens første registrerte saldo (eller første
 *    bevegelse når den aldri har hatt saldo). Ingen saldokrav, men åpent
 *    grunnlag i måneden er et problem.
 *  - `ingen_data`: konfigurert konto uten bevegelser eller saldo.
 */
export type RadFase = "aktiv" | "start" | "foer_start" | "ingen_data";

export interface AvstemmingsRad {
  konto: string;
  maaned: string;
  fase: RadFase;
  /** `ingen_saldo` for rader uten vurdering. */
  status: KontrollStatus;
  vurdering: KontoMaanedVurdering | null;
  /** Inngående saldo = forrige måneds faktiske, eller `null` (mangler). */
  inngaaendeOre: number | null;
  /** Bankimporterte bevegelser inn/ut (uten avledede). */
  innOre: number;
  utOre: number;
  /** Netto av avledede motposter som regnes med (0 når ingen). */
  avledetOre: number;
  beregnetOre: number | null;
  faktiskOre: number | null;
  differanseOre: number | null;
  /** I `PROBLEM_REKKEFOLGE`. */
  problemer: Problem[];
  /** Avstemt og ingen problemer igjen. */
  ok: boolean;
  /**
   * En skriving som berører raden, er ikke bekreftet ennå. Raden er da den
   * sist bekreftede (se `medBekreftet`), aldri den lokale, ubekreftede.
   */
  lagrer?: boolean;
}

export interface Avstemmingsmodell {
  /** Nyeste først, som `Avstemmingsoversikt.maaneder`. */
  maaneder: string[];
  /** Kontoene i oversikten pluss konfigurerte uten data; MC først. */
  kontoer: string[];
  rader: Record<string, AvstemmingsRad[]>;
  /** Problemet med ukjent konto per måned (bare måneder som har det). */
  ukjent: Record<string, Problem>;
  /** Alle åpne problemer: nyeste måned først, så kontoens rekkefølge og prioritet. */
  problemer: Problem[];
}

const harGrunnlag = (v: KontoMaanedVurdering): boolean =>
  v.grunnlag.antall > 0 ||
  v.grunnlag.avledede.antall > 0 ||
  v.grunnlag.avledetMedKandidat.length > 0 ||
  v.grunnlag.avledetKildeEndret.length > 0;

const tilOre = (kr: number): number => Math.round(kr * 100);

const sorterKontoer = (kontoer: Iterable<string>): string[] =>
  [...new Set(kontoer)].sort((a, b) =>
    a === "MC" ? -1 : b === "MC" ? 1 : a.localeCompare(b, "nb"),
  );

const prioritet = (p: Problem): number => PROBLEM_REKKEFOLGE.indexOf(p.type);

/**
 * Hvor kontoen begynner i perioden: `startsaldo` er måneden med første
 * registrerte saldo når den ligger i perioden (fasen «start»), `aktivFra`
 * første måned som kreves avstemt. Uten saldo noensinne er kontoen aktiv
 * fra første bevegelse. `null` når kontoen ikke har noe i perioden.
 */
function kontoStart(
  o: Avstemmingsoversikt,
  konto: string,
): { startsaldo: string | null; aktivFra: string } | null {
  const stigende = [...o.maaneder].reverse();
  const celle = (m: string) => o.celler[konto]?.[m];
  const medSaldo = stigende.find((m) => {
    const v = celle(m);
    return !!v && (!!v.kontroll || v.forrigeSaldoOre !== null);
  });
  if (medSaldo) {
    // Saldo før perioden (f.eks. startsaldo 31.12): aktiv fra første måned.
    if (celle(medSaldo)!.forrigeSaldoOre !== null) return { startsaldo: null, aktivFra: medSaldo };
    const i = stigende.indexOf(medSaldo);
    return { startsaldo: medSaldo, aktivFra: stigende[i + 1] ?? "9999-99" };
  }
  const forste = stigende.find((m) => {
    const v = celle(m);
    return !!v && harGrunnlag(v);
  });
  return forste ? { startsaldo: null, aktivFra: forste } : null;
}

function fase(m: string, s: { startsaldo: string | null; aktivFra: string }): RadFase {
  if (m === s.startsaldo) return "start";
  return m >= s.aktivFra ? "aktiv" : "foer_start";
}

/** Konkrete problemer for én aktiv konto/måned, i prioritert rekkefølge. */
export function problemerFor(
  v: KontoMaanedVurdering,
  transaksjoner: readonly TransaksjonRecord[],
): Problem[] {
  const { konto, maaned, grunnlag: g } = v;
  const p: Problem[] = [];
  const legg = (type: ProblemType, ekstra: Omit<Problem, "type" | "konto" | "maaned"> = {}) =>
    p.push({ type, konto, maaned, ...ekstra });
  if (v.status === "ingen_saldo") legg("mangler_saldo");
  if (v.status === "startpunkt") legg("startpunkt");
  if (g.uavklarte.antall > 0)
    legg("uavklart_ignorert", { antall: g.uavklarte.antall, belopOre: g.uavklarte.nettoOre });
  if (g.avledetMedKandidat.length > 0)
    legg("avledet_mulig_importert", { antall: g.avledetMedKandidat.length });
  if (g.avledetKildeEndret.length > 0)
    legg("avledet_kilde_endret", { antall: g.avledetKildeEndret.length });
  const endret = g.transaksjoner.filter((t) => vurderAvslutningForventet(t).kan).length;
  if (endret > 0) legg("avledet_endret", { antall: endret });
  if (v.status === "avvik" && v.differanseOre !== null) {
    legg("avvik", { belopOre: v.differanseOre });
    const kilder = muligeKilderForMotpost(transaksjoner, konto, maaned).length;
    if (kilder > 0) legg("manglende_motpost", { antall: kilder });
  }
  if (v.grunnlagEndret) legg("grunnlag_endret", { antall: v.endringAntall });
  if (v.status === "avstemt_avledet")
    legg("avledet", { antall: g.avledede.antall, belopOre: g.avledede.nettoOre });
  return p.sort((a, b) => prioritet(a) - prioritet(b));
}

/** Problemene som bare gjelder når måneden kreves avstemt med saldo. */
const SALDOKRAV: ReadonlySet<ProblemType> = new Set(["mangler_saldo", "startpunkt"]);

function tomRad(konto: string, maaned: string, fase: RadFase): AvstemmingsRad {
  return {
    konto,
    maaned,
    fase,
    status: "ingen_saldo",
    vurdering: null,
    inngaaendeOre: null,
    innOre: 0,
    utOre: 0,
    avledetOre: 0,
    beregnetOre: null,
    faktiskOre: null,
    differanseOre: null,
    problemer: [],
    ok: false,
  };
}

/** Raden for én konto/måned ut fra den eksisterende vurderingen. */
export function radFor(
  v: KontoMaanedVurdering,
  fase: RadFase,
  transaksjoner: readonly TransaksjonRecord[],
): AvstemmingsRad {
  const problemer =
    fase === "aktiv"
      ? problemerFor(v, transaksjoner)
      : problemerFor(v, transaksjoner).filter((p) => !SALDOKRAV.has(p.type));
  return {
    konto: v.konto,
    maaned: v.maaned,
    fase,
    status: v.status,
    vurdering: v,
    inngaaendeOre: v.forrigeSaldoOre,
    innOre: v.grunnlag.innOre,
    utOre: v.grunnlag.utOre,
    avledetOre: v.grunnlag.avledede.nettoOre,
    beregnetOre: v.beregnetOre,
    faktiskOre: v.kontroll ? tilOre(v.kontroll.faktiskSaldo) : null,
    differanseOre: v.differanseOre,
    problemer,
    ok: fase === "aktiv" && v.status === "avstemt" && problemer.length === 0,
  };
}

/**
 * Hele modellen for perioden i `o`. `konfigurerte` er kontoene bankimporten
 * kjenner (`KONTOER` uten «alle»); de vises selv uten data.
 */
export function avstemmingsmodell(
  o: Avstemmingsoversikt,
  transaksjoner: readonly TransaksjonRecord[],
  konfigurerte: readonly string[] = [],
): Avstemmingsmodell {
  const kontoer = sorterKontoer([...o.kontoer, ...konfigurerte]);
  const start = new Map(o.kontoer.map((k) => [k, kontoStart(o, k)]));
  const rader: Avstemmingsmodell["rader"] = {};
  const ukjent: Avstemmingsmodell["ukjent"] = {};
  const problemer: Problem[] = [];
  for (const m of o.maaneder) {
    const liste: AvstemmingsRad[] = [];
    for (const k of kontoer) {
      const v = o.celler[k]?.[m];
      const s = start.get(k) ?? null;
      if (!v || s === null) {
        liste.push(tomRad(k, m, "ingen_data"));
        continue;
      }
      liste.push(radFor(v, fase(m, s), transaksjoner));
    }
    rader[m] = liste;
    const antall = o.ukjentKonto[m] ?? 0;
    if (antall > 0) {
      ukjent[m] = { type: "ukjent_konto", konto: UKJENT_KONTO, maaned: m, antall };
      problemer.push(ukjent[m]!);
    }
    for (const r of liste) problemer.push(...r.problemer);
  }
  return { maaneder: o.maaneder, kontoer, rader, ukjent, problemer };
}

export const radNokkel = (konto: string, maaned: string): string => `${konto}|${maaned}`;

/**
 * Modellen slik den skal vises mens skrivinger venter (review 5764883177).
 * Databasen viser en lokal skriving før serveren har bekreftet den; for en
 * konto/måned med en ventende skriving brukes derfor den sist bekreftede
 * raden (merket `lagrer`), så ingen flate — tabell, panel, samlet status,
 * andre måneders åpne forhold eller matrise — viser noe som løst før
 * lagringen er bekreftet og vurdert på nytt. Ved avvisning ruller databasen
 * tilbake, og raden er uendret.
 *
 * `sistBekreftet` er forrige kalls `bekreftet`; første gang en rad venter,
 * er det raden fra før skrivingen startet.
 */
export function medBekreftet(
  modell: Avstemmingsmodell,
  sistBekreftet: Readonly<Record<string, AvstemmingsRad>>,
  venter: (konto: string, maaned: string) => boolean,
): { modell: Avstemmingsmodell; bekreftet: Record<string, AvstemmingsRad> } {
  const bekreftet: Record<string, AvstemmingsRad> = {};
  const rader: Avstemmingsmodell["rader"] = {};
  const problemer: Problem[] = [];
  for (const m of modell.maaneder) {
    rader[m] = (modell.rader[m] ?? []).map((r) => {
      const n = radNokkel(r.konto, m);
      if (venter(r.konto, m)) {
        const forrige = sistBekreftet[n] ?? r;
        bekreftet[n] = forrige;
        return { ...forrige, lagrer: true };
      }
      bekreftet[n] = r;
      return r;
    });
    const ukjent = modell.ukjent[m];
    if (ukjent) problemer.push(ukjent);
    for (const r of rader[m]!) problemer.push(...r.problemer);
  }
  return { modell: { ...modell, rader, problemer }, bekreftet };
}

/**
 * Alle konto/måned-rader en skriving på transaksjonen `id` kan endre,
 * utledet fra grunnlaget FØR skrivingen (review 5765532045). En
 * korrigering endrer ikke bare kildens egen rad: en avledet motpost ligger
 * på en annen konto og kanskje en annen måned, og en kobling eller en
 * frakoblet motpart ligger på en tredje. Med:
 *  - transaksjonens egen konto/måned;
 *  - dens avledede motpost (`forventetMotpost.konto`/`dato`), også en
 *    erstattet eller avsluttet — angring og avslutning flytter effekten;
 *  - koblet motpart nå og før korrigeringen (`tidligere.motpartTransaksjonId`),
 *    og transaksjonen som forårsaket korrigeringen (`arsakId`);
 *  - transaksjoner som peker hit (`motpartTransaksjonId`, `arsakId`,
 *    `forventetMotpost.erstattetAv`).
 * `ekstra` er nye plasseringer handlingen innfører (konto og dato for en ny
 * eller flyttet avledet motpost).
 */
export function berorteNokler(
  transaksjoner: readonly TransaksjonRecord[],
  id: string,
  ekstra: readonly { konto: string; dato: string }[] = [],
): string[] {
  const finn = (x: string | null | undefined) =>
    x ? transaksjoner.find((t) => t.id === x) : undefined;
  const t = finn(id);
  const nokler = new Set<string>();
  const leggTil = (konto: string, dato: string | null | undefined) => {
    const m = maanedFor(dato);
    if (m) nokler.add(radNokkel(konto, m));
  };
  const leggTilTransaksjon = (x: TransaksjonRecord | undefined) => {
    if (x) leggTil(normaliserKonto(x), x.dato);
  };
  if (t) {
    leggTilTransaksjon(t);
    if (t.forventetMotpost) leggTil(t.forventetMotpost.konto, t.forventetMotpost.dato);
    leggTilTransaksjon(finn(t.motpartTransaksjonId));
    leggTilTransaksjon(finn(t.saldoKorrigering?.tidligere.motpartTransaksjonId));
    leggTilTransaksjon(finn(t.saldoKorrigering?.arsakId));
    leggTilTransaksjon(finn(t.forventetMotpost?.erstattetAv));
    for (const o of transaksjoner) {
      if (
        o.id !== id &&
        (o.motpartTransaksjonId === id ||
          o.saldoKorrigering?.arsakId === id ||
          o.saldoKorrigering?.tidligere.motpartTransaksjonId === id ||
          o.forventetMotpost?.erstattetAv === id)
      ) {
        leggTilTransaksjon(o);
        if (o.forventetMotpost) leggTil(o.forventetMotpost.konto, o.forventetMotpost.dato);
      }
    }
  }
  for (const e of ekstra) leggTil(e.konto, e.dato);
  return [...nokler];
}

export interface Maanedsstatus {
  maaned: string;
  /** Aktive kontoer i måneden. */
  aktive: number;
  /** Avstemt mot banken og ingen problemer igjen. */
  bankavstemt: number;
  avvikEllerUsikker: number;
  /** Mangler saldo eller er bare et startpunkt. */
  manglerGrunnlag: number;
  /** Stemmer bare med avledede motposter. */
  avledet: number;
  /** Avstemt, men med andre åpne problemer (f.eks. endret grunnlag). */
  andreApne: number;
  /** Kontoer med startsaldo i måneden (grunnlag for neste, ikke avstemt). */
  startsaldo: number;
  /** Bevegelser uten konto i måneden. */
  ukjentKonto: number;
  /** Åpne problemer i måneden, inkl. ukjent konto. */
  apneProblemer: number;
  /** Rader med en skriving som ikke er bekreftet ennå. */
  lagrer: number;
  /** Andre måneder med åpne problemer — nyeste først. */
  andreMaaneder: { maaned: string; antall: number }[];
}

/**
 * Samlet status for valgt måned, med de andre månedenes åpne problemer
 * ved siden av: en OK-måned skjuler aldri eldre avvik.
 */
export function maanedsstatus(modell: Avstemmingsmodell, maaned: string): Maanedsstatus {
  const aktive = (modell.rader[maaned] ?? []).filter((r) => r.fase === "aktiv");
  const perMaaned = new Map<string, number>();
  for (const p of modell.problemer) perMaaned.set(p.maaned, (perMaaned.get(p.maaned) ?? 0) + 1);
  return {
    maaned,
    aktive: aktive.length,
    bankavstemt: aktive.filter((r) => r.ok && !r.lagrer).length,
    avvikEllerUsikker: aktive.filter((r) => r.status === "avvik" || r.status === "usikker").length,
    manglerGrunnlag: aktive.filter((r) => r.status === "ingen_saldo" || r.status === "startpunkt")
      .length,
    avledet: aktive.filter((r) => r.status === "avstemt_avledet").length,
    andreApne: aktive.filter((r) => r.status === "avstemt" && !r.ok).length,
    startsaldo: (modell.rader[maaned] ?? []).filter((r) => r.fase === "start").length,
    ukjentKonto: modell.ukjent[maaned]?.antall ?? 0,
    apneProblemer: perMaaned.get(maaned) ?? 0,
    lagrer: (modell.rader[maaned] ?? []).filter((r) => r.lagrer).length,
    andreMaaneder: modell.maaneder
      .filter((m) => m !== maaned && (perMaaned.get(m) ?? 0) > 0)
      .map((m) => ({ maaned: m, antall: perMaaned.get(m)! })),
  };
}

/**
 * Neste konto å registrere saldo for etter `konto` i `maaned`: neste rad
 * (i tabellens rekkefølge, rundt) som fortsatt mangler saldo; ellers neste
 * aktive rad. `null` når det ikke finnes noen annen.
 */
export function nesteKonto(
  modell: Avstemmingsmodell,
  maaned: string,
  konto: string,
): string | null {
  const rader = (modell.rader[maaned] ?? []).filter((r) => r.fase !== "foer_start");
  const i = rader.findIndex((r) => r.konto === konto);
  const rundt = [...rader.slice(i + 1), ...rader.slice(0, Math.max(i, 0))];
  const mangler = rundt.find((r) =>
    r.problemer.some((p) => p.type === "mangler_saldo" || p.type === "startpunkt"),
  );
  return (mangler ?? rundt.find((r) => r.fase === "aktiv"))?.konto ?? null;
}

/** Saldoen som mangler for å kunne kontrollere raden: måneden selv eller måneden før. */
export function saldoSomMangler(r: AvstemmingsRad): string | null {
  if (!r.vurdering) return r.maaned;
  if (r.status === "startpunkt") return forrigeMaaned(r.maaned);
  if (r.status === "ingen_saldo") return r.maaned;
  return null;
}
