/**
 * Mellomværende (#95) — rene funksjoner. Se `@app-types/mellomvaerende`
 * for lagringsmodellen.
 *
 * Den økonomiske effekten ligger bare i `hendelser[]` som manuelle
 * hendelser (`kilde: "manuell"`, uten bank), så eksisterende faktisk-
 * beregning, drilldown og historikkeksport teller dem uten endring:
 *  - kostnaden: +utlegget på kostnadsposten i startmåneden;
 *  - hvert oppgjør: −beløpet på oppgjørsposten (redusert faktisk kostnad).
 * Ingen bankkonto får saldoeffekt.
 *
 * Skriveoperasjonene er rene updatere over HELE hendelseslisten (samme
 * form som forsoningens helnode-transaksjoner). De beregner restsaldoen fra
 * listen de får, så en transaksjon som kjøres på nytt mot fersk serververdi
 * alltid validerer mot det som faktisk er lagret. Deterministiske id-er
 * (`mv-{id}-{YYYY-MM}`) gjør dobbeltklikk, retry og ny innlasting ufarlig:
 * samme måned kan aldri få to oppgjør.
 */
import type { Fordeling, HendelseRecord } from "@app-types/forsoning";
import type {
  Mellomvaerende,
  MellomvaerendeHandling,
  MellomvaerendeKobling,
  MellomvaerendePost,
} from "@app-types/mellomvaerende";

export const kostnadHendelseId = (id: string): string => `mv-${id}-kostnad`;
export const oppgjorHendelseId = (id: string, maaned: string): string => `mv-${id}-${maaned}`;

const MAANEDER = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
];

export const erMaaned = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** «oktober 2026». */
export function maanedTekst(maaned: string): string {
  if (!erMaaned(maaned)) return maaned;
  return `${MAANEDER[Number(maaned.slice(5, 7)) - 1]} ${maaned.slice(0, 4)}`;
}

/** `YYYY-MM` for en dato (lokal tid). */
export const maanedFor = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function nesteMaaned(maaned: string): string {
  const aar = Number(maaned.slice(0, 4));
  const mnd = Number(maaned.slice(5, 7));
  return mnd === 12 ? `${aar + 1}-01` : `${aar}-${String(mnd + 1).padStart(2, "0")}`;
}

/** Alle måneder fra og med `fra` til og med `til` (tom hvis `fra` er etter `til`). */
export function maanederFraTil(fra: string, til: string): string[] {
  const ut: string[] = [];
  if (!erMaaned(fra) || !erMaaned(til)) return ut;
  for (let m = fra; m <= til; m = nesteMaaned(m)) ut.push(m);
  return ut;
}

/** «3 299 kr» / «30,50 kr». */
export function kronerTekst(ore: number): string {
  return `${new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: ore % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(ore / 100)} kr`;
}

/** «467» / «467,5» / «467.50» → øre; `null` når det ikke er et positivt beløp. */
export function tolkKroner(tekst: string): number | null {
  const renset = tekst.replace(/\s|kr/gi, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(renset)) return null;
  const ore = Math.round(Number(renset) * 100);
  return ore > 0 ? ore : null;
}

export interface OppgjorLinje {
  maaned: string;
  hendelseId: string;
  /** Aktivt beløp (0 = angret). */
  belopOre: number;
  aktiv: boolean;
  spor: MellomvaerendeKobling["spor"];
}

export interface MellomvaerendeStatus {
  avtale: Mellomvaerende;
  /** Kostnadshendelsen finnes (registreringen er fullført). */
  kostnadFort: boolean;
  /** Alle oppgjørshendelser, også angrede, sortert på måned. */
  oppgjor: OppgjorLinje[];
  oppgjortOre: number;
  restOre: number;
  /** Rest = 0: ingen flere oppgjør. */
  avsluttet: boolean;
  /** Måneder fra start til og med `naaMaaned` uten aktivt oppgjør (tom når avsluttet). */
  forfalte: string[];
  /** Siste bekreftede beløp (ellers standard), begrenset til restsaldoen. */
  forslagOre: number;
}

const koblingFor = (h: HendelseRecord | undefined, id: string, rolle: "kostnad" | "oppgjor") =>
  h?.mellomvaerende && h.mellomvaerende.id === id && h.mellomvaerende.rolle === rolle
    ? h.mellomvaerende
    : null;

/** Avleder hele tilstanden til ett mellomværende fra hendelsene. */
export function mellomvaerendeStatus(
  avtale: Mellomvaerende,
  hendelser: readonly HendelseRecord[],
  naaMaaned: string,
): MellomvaerendeStatus {
  const liste = hendelser || [];
  const kostnadFort = liste.some(
    (h) => h && h.id === kostnadHendelseId(avtale.id) && !!koblingFor(h, avtale.id, "kostnad"),
  );
  const oppgjor: OppgjorLinje[] = liste
    .map((h) => ({ h, k: koblingFor(h, avtale.id, "oppgjor") }))
    .filter((x): x is { h: HendelseRecord; k: MellomvaerendeKobling } => !!x.k)
    .map(({ h, k }) => ({
      maaned: k.maaned,
      hendelseId: h.id,
      belopOre: Math.max(0, Math.round(k.belopOre || 0)),
      aktiv: (k.belopOre || 0) > 0,
      spor: k.spor || [],
    }))
    .sort((a, b) => (a.maaned < b.maaned ? -1 : a.maaned > b.maaned ? 1 : 0));
  const oppgjortOre = oppgjor.reduce((s, o) => s + (o.aktiv ? o.belopOre : 0), 0);
  const restOre = Math.max(0, avtale.opprinneligOre - oppgjortOre);
  const avsluttet = restOre === 0;
  const aktiveMaaneder = new Set(oppgjor.filter((o) => o.aktiv).map((o) => o.maaned));
  const forfalte = avsluttet
    ? []
    : maanederFraTil(avtale.startMaaned, naaMaaned).filter((m) => !aktiveMaaneder.has(m));
  const sisteAktive = [...oppgjor].reverse().find((o) => o.aktiv);
  const forslagOre = Math.min(sisteAktive?.belopOre ?? avtale.standardBelopOre, restOre);
  return {
    avtale,
    kostnadFort,
    oppgjor,
    oppgjortOre,
    restOre,
    avsluttet,
    forfalte,
    forslagOre,
  };
}

const fordeling = (post: MellomvaerendePost, belopKroner: number): Fordeling => ({
  plasseringId: post.postId,
  plasseringType: post.plasseringType,
  plasseringNavn: post.postNavn,
  belop: belopKroner,
  eiere: post.eiere.map((e) => ({ ...e })),
});

/** Kostnadshendelsen: hele utlegget som faktisk kostnad i startmåneden, uten bank. */
export function byggKostnadHendelse(
  avtale: Mellomvaerende,
  av: string,
  naa: string,
): HendelseRecord {
  return {
    id: kostnadHendelseId(avtale.id),
    status: "ferdig",
    paaVentAarsak: null,
    transaksjonId: null,
    receiptId: null,
    fordelinger: [fordeling(avtale.kostnad, avtale.opprinneligOre / 100)],
    dato: `${avtale.startMaaned}-01`,
    regelId: null,
    kilde: "manuell",
    kommentar: `${avtale.navn}: utlegg av ${avtale.motpart}`,
    mellomvaerende: {
      id: avtale.id,
      rolle: "kostnad",
      maaned: avtale.startMaaned,
      belopOre: avtale.opprinneligOre,
      spor: [{ handling: "bekreftet", belopOre: avtale.opprinneligOre, tid: naa, av }],
    },
    opprettet: naa,
    oppdatert: naa,
  };
}

/** Legger til kostnadshendelsen hvis den mangler (idempotent). */
export function medKostnadHendelse(
  prev: readonly HendelseRecord[],
  avtale: Mellomvaerende,
  av: string,
  naa: string,
): HendelseRecord[] {
  if (prev.some((h) => h && h.id === kostnadHendelseId(avtale.id))) return [...prev];
  return [...prev, byggKostnadHendelse(avtale, av, naa)];
}

export type OppgjorUtfall =
  | "lagret"
  /** Måneden har allerede et aktivt oppgjør (dobbeltklikk/annen enhet). */
  | "allerede_oppgjort"
  /** Måneden har ikke noe aktivt oppgjør å rette/angre. */
  | "ikke_oppgjort"
  /** Beløpet er større enn restsaldoen. */
  | "over_rest"
  /** Ugyldig måned eller beløp. */
  | "ugyldig";

export interface OppgjorResultat {
  neste: HendelseRecord[];
  utfall: OppgjorUtfall;
}

const OPPGJOR_FORKLARING: Record<Exclude<OppgjorUtfall, "lagret">, string> = {
  allerede_oppgjort: "Måneden er allerede oppgjort, kanskje fra en annen enhet. Se oversikten.",
  ikke_oppgjort: "Måneden har ikke noe oppgjør å endre. Se oversikten.",
  over_rest: "Beløpet er større enn det som gjenstår.",
  ugyldig: "Ugyldig måned eller beløp.",
};

export const oppgjorForklaring = (u: Exclude<OppgjorUtfall, "lagret">): string =>
  OPPGJOR_FORKLARING[u];

function settOppgjor(
  prev: readonly HendelseRecord[],
  avtale: Mellomvaerende,
  maaned: string,
  belopOre: number,
  handling: MellomvaerendeHandling,
  av: string,
  naa: string,
): HendelseRecord[] {
  const id = oppgjorHendelseId(avtale.id, maaned);
  const eksisterende = prev.find((h) => h && h.id === id);
  const spor = [
    ...(eksisterende?.mellomvaerende?.spor ?? []),
    { handling, belopOre, tid: naa, av },
  ];
  const hendelse: HendelseRecord = {
    id,
    status: "ferdig",
    paaVentAarsak: null,
    transaksjonId: null,
    receiptId: null,
    // Angret = ingen fordeling: ingen økonomisk effekt, men sporet består.
    fordelinger: belopOre > 0 ? [fordeling(avtale.oppgjor, -belopOre / 100)] : [],
    dato: `${maaned}-01`,
    regelId: null,
    kilde: "manuell",
    kommentar: `${avtale.navn}: oppgjør ${maanedTekst(maaned)}`,
    mellomvaerende: { id: avtale.id, rolle: "oppgjor", maaned, belopOre, spor },
    opprettet: eksisterende?.opprettet ?? naa,
    oppdatert: naa,
  };
  return eksisterende ? prev.map((h) => (h && h.id === id ? hendelse : h)) : [...prev, hendelse];
}

const gyldigBelop = (ore: number) => Number.isInteger(ore) && ore > 0;

/**
 * Bekrefter oppgjøret for én måned. Idempotent: en måned med aktivt
 * oppgjør endres ikke (`allerede_oppgjort`); en angret måned kan
 * bekreftes på nytt. Beløpet kan ikke overstige restsaldoen.
 */
export function bekreftOppgjor(
  prev: readonly HendelseRecord[],
  avtale: Mellomvaerende,
  maaned: string,
  belopOre: number,
  av: string,
  naa: string,
): OppgjorResultat {
  const uendret = [...prev];
  if (!erMaaned(maaned) || maaned < avtale.startMaaned || !gyldigBelop(belopOre)) {
    return { neste: uendret, utfall: "ugyldig" };
  }
  const status = mellomvaerendeStatus(avtale, prev, maaned);
  if (status.oppgjor.some((o) => o.maaned === maaned && o.aktiv)) {
    return { neste: uendret, utfall: "allerede_oppgjort" };
  }
  if (belopOre > status.restOre) return { neste: uendret, utfall: "over_rest" };
  return {
    neste: settOppgjor(prev, avtale, maaned, belopOre, "bekreftet", av, naa),
    utfall: "lagret",
  };
}

/** Retter beløpet på et bekreftet oppgjør. Andre måneder røres ikke. */
export function rettOppgjor(
  prev: readonly HendelseRecord[],
  avtale: Mellomvaerende,
  maaned: string,
  belopOre: number,
  av: string,
  naa: string,
): OppgjorResultat {
  const uendret = [...prev];
  if (!erMaaned(maaned) || !gyldigBelop(belopOre)) return { neste: uendret, utfall: "ugyldig" };
  const status = mellomvaerendeStatus(avtale, prev, maaned);
  const linje = status.oppgjor.find((o) => o.maaned === maaned && o.aktiv);
  if (!linje) return { neste: uendret, utfall: "ikke_oppgjort" };
  if (belopOre > status.restOre + linje.belopOre) return { neste: uendret, utfall: "over_rest" };
  return {
    neste: settOppgjor(prev, avtale, maaned, belopOre, "rettet", av, naa),
    utfall: "lagret",
  };
}

/** Angrer et oppgjør: den økonomiske effekten fjernes, sporet bevares. */
export function angreOppgjor(
  prev: readonly HendelseRecord[],
  avtale: Mellomvaerende,
  maaned: string,
  av: string,
  naa: string,
): OppgjorResultat {
  const uendret = [...prev];
  const status = mellomvaerendeStatus(avtale, prev, erMaaned(maaned) ? maaned : "0000-01");
  if (!status.oppgjor.some((o) => o.maaned === maaned && o.aktiv)) {
    return { neste: uendret, utfall: "ikke_oppgjort" };
  }
  return { neste: settOppgjor(prev, avtale, maaned, 0, "angret", av, naa), utfall: "lagret" };
}

/** Feltene registreringsskjemaet samler inn. */
export interface NyttMellomvaerende {
  navn: string;
  motpart: string;
  opprinneligOre: number;
  startMaaned: string;
  kostnad: MellomvaerendePost;
  oppgjor: MellomvaerendePost;
  standardBelopOre: number;
}

/** Validering av registreringen; tom liste = gyldig. */
export function valider(n: NyttMellomvaerende): string[] {
  const feil: string[] = [];
  if (!n.navn.trim()) feil.push("Gi mellomværendet et navn.");
  if (!n.motpart.trim()) feil.push("Oppgi hvem mellomværendet er med.");
  if (!gyldigBelop(n.opprinneligOre)) feil.push("Oppgi utlegget som et beløp over 0.");
  if (!erMaaned(n.startMaaned)) feil.push("Velg startmåned.");
  if (!n.kostnad.postId) feil.push("Velg posten utlegget er en kostnad på.");
  if (!n.oppgjor.postId) feil.push("Velg posten oppgjørene reduserer.");
  for (const [hva, post] of [
    ["kostnaden", n.kostnad],
    ["oppgjørene", n.oppgjor],
  ] as const) {
    const sum = post.eiere.reduce((s, e) => s + (Number(e.prosent) || 0), 0);
    if (post.postId && (post.eiere.length === 0 || Math.round(sum) !== 100)) {
      feil.push(`Velg hvem som eier ${hva} (til sammen 100 %).`);
    }
  }
  if (!gyldigBelop(n.standardBelopOre)) feil.push("Oppgi månedlig oppgjør som et beløp over 0.");
  else if (gyldigBelop(n.opprinneligOre) && n.standardBelopOre > n.opprinneligOre) {
    feil.push("Månedlig oppgjør kan ikke være større enn utlegget.");
  }
  return feil;
}

export function byggMellomvaerende(
  n: NyttMellomvaerende,
  id: string,
  av: string,
  naa: string,
): Mellomvaerende {
  return {
    id,
    navn: n.navn.trim(),
    motpart: n.motpart.trim(),
    opprinneligOre: n.opprinneligOre,
    startMaaned: n.startMaaned,
    kostnad: { ...n.kostnad, eiere: n.kostnad.eiere.map((e) => ({ ...e })) },
    oppgjor: { ...n.oppgjor, eiere: n.oppgjor.eiere.map((e) => ({ ...e })) },
    standardBelopOre: n.standardBelopOre,
    opprettet: naa,
    av,
  };
}

/** Hvor mange oppgjør som gjenstår med uendret forslag (for oversikten). */
export function gjenstaendeOppgjor(status: MellomvaerendeStatus): {
  fulle: number;
  sisteOre: number;
} {
  if (status.avsluttet || status.forslagOre <= 0) return { fulle: 0, sisteOre: 0 };
  const fulle = Math.floor(status.restOre / status.forslagOre);
  return { fulle, sisteOre: status.restOre - fulle * status.forslagOre };
}
