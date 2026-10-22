/**
 * Reversible korrigeringer fra saldoavstemmingens avvikshjelp (#59,
 * Kontrolltårnet 6097079190 og 6097180478). Rene funksjoner.
 *
 * - «Marker som dublett» virker også på en transaksjon som allerede er
 *   behandlet som intern overføring. Er den koblet til en motpost, må Helen
 *   velge hva motposten er: ekte (beholdes som intern overføring, men
 *   koblingen fjernes, så det aldri står en kobling mot en dublett) eller
 *   også en dublett (begge merkes).
 * - Tilstanden før korrigeringen lagres i `saldoKorrigering`, og hver
 *   handling legges i `korrigeringslogg`. Ingenting slettes fysisk, og en
 *   reversering gjenoppretter nøyaktig det som var.
 * - Transaksjoner med plassering eller kvitteringsmatch kan ikke merkes her:
 *   det ville endret budsjettet. Interne overføringer og ignorerte har ingen
 *   budsjetteffekt, så korrigeringen endrer bare saldoberegningen.
 *   Det samme kravet gjelder MOTPOSTEN, uansett hvilket valg Helen tar.
 * - Korrigeringer stables aldri: en transaksjon med en aktiv korrigering
 *   (også som frakoblet motpost) kan ikke korrigeres på nytt før den første
 *   er angret, så informasjonen som trengs for å angre aldri overskrives.
 * - En reversering krever at BÅDE transaksjonen og motposten fortsatt er
 *   nøyaktig slik korrigeringen etterlot dem (`etter`-avtrykket). Er en av
 *   dem endret i mellomtiden, nekter appen i stedet for å gjenopprette en
 *   kobling som ikke lenger stemmer.
 *
 * - «Motposten mangler» (6097196546): en ekte bankbevegelse kan gjøres til
 *   intern overføring mot en valgt egen konto selv om motposten aldri ble
 *   importert. Motposten lagres bare som `forventetMotpost` på kilden — ingen
 *   syntetisk transaksjon — og avstemmingen regner den inn på mottakerkontoen
 *   som avledet, aldri som bankverifisert. Den slutter å telle så snart en
 *   ekte motpost er koblet, og en importert kandidat gjør måneden usikker
 *   i stedet for å dobbeltelle.
 *
 * Hver endring valideres mot de FERSKESTE dataene inne i transaksjonen;
 * er den ikke lenger gyldig, returneres dataene uendret.
 */
import type {
  ForventetMotpost,
  IgnorertSom,
  Kildeavtrykk,
  KorrigeringsHandling,
  SaldoKorrigering,
  TidligereTilstand,
  Tilstandsavtrykk,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import { retningMotsatt } from "@domain/forsoning/internOverforing";
import { erKjentKonto } from "@domain/forsoning/regelsenter";
import { belopMatcherIOre, dagerMellom } from "@domain/forsoning/tekst";

export type MotpartValg = "frakoble" | "ogsaDublett";

export type DublettVurdering =
  { kan: true; motpart: TransaksjonRecord | null } | { kan: false; grunn: string };

export type AngreVurdering =
  | { kan: true; motpart: TransaksjonRecord | null; gjenkobles: boolean }
  | { kan: false; grunn: string };

export function erDublett(t: Pick<TransaksjonRecord, "status" | "ignorertSom">): boolean {
  return t.status === "ignorert" && t.ignorertSom === "dublett";
}

export function erInternOverforing(t: Pick<TransaksjonRecord, "behandlingstype">): boolean {
  return t.behandlingstype === "intern_overforing";
}

/** Motposten i en gyldig, gjensidig intern-overføringskobling, ellers `null`. */
export function koblingsMotpart(
  t: TransaksjonRecord,
  alle: readonly TransaksjonRecord[],
): TransaksjonRecord | null {
  if (!t.motpartTransaksjonId) return null;
  const m = alle.find((o) => o.id === t.motpartTransaksjonId);
  return m && m.motpartTransaksjonId === t.id ? m : null;
}

/** Hvorfor `t` ikke kan røres av en saldokorrigering, eller `null`. `hvem` = «Transaksjonen»/«Motposten». */
function hinder(t: TransaksjonRecord, hvem: string): string | null {
  // En aktiv korrigering låser alltid, også når den er endret utenfra:
  // den må angres eller avsluttes eksplisitt, så forrige tilstand aldri
  // overskrives av en ny korrigering (#75, Kontrolltårn-review).
  const k = t.saldoKorrigering;
  if (k) {
    if (k.type === "motpart_frakoblet")
      return `${hvem} mistet koblingen da motposten ble merket som dublett. Angre den merkingen først.`;
    if (k.type === "forventet_motpost") {
      return uendretSidenKorrigering(t)
        ? `${hvem} har en avledet motpost. Angre den først.`
        : `${hvem} har en avledet motpost som er endret siden. Avslutt den først.`;
    }
    return `${hvem} har allerede en aktiv dublett-merking. Angre den først.`;
  }
  if (t.hendelseId) {
    return `${hvem} er plassert i budsjettet. Korriger plasseringen i Transaksjoner først.`;
  }
  if (t.matchetMot || t.status === "matchet") {
    return `${hvem} er matchet mot en kvittering. Korriger matchen i Transaksjoner først.`;
  }
  return null;
}

export function vurderDublettMerking(
  t: TransaksjonRecord,
  alle: readonly TransaksjonRecord[],
): DublettVurdering {
  if (erDublett(t)) return { kan: false, grunn: "Transaksjonen er allerede merket som dublett." };
  const egen = hinder(t, "Transaksjonen");
  if (egen) return { kan: false, grunn: egen };
  if (!t.motpartTransaksjonId) return { kan: true, motpart: null };
  const m = koblingsMotpart(t, alle);
  if (!m || !erInternOverforing(m)) {
    return {
      kan: false,
      grunn:
        "Koblingen til motposten er ufullstendig. Korriger den interne overføringen i Transaksjoner først.",
    };
  }
  const motpartens = hinder(m, "Motposten");
  if (motpartens) return { kan: false, grunn: motpartens };
  return { kan: true, motpart: m };
}

function tilstand(t: TransaksjonRecord): TidligereTilstand {
  return {
    status: t.status ?? null,
    behandlingstype: t.behandlingstype ?? null,
    motpartTransaksjonId: t.motpartTransaksjonId ?? null,
    ignorertSom: t.ignorertSom ?? null,
  };
}

function avtrykk(t: TransaksjonRecord): Tilstandsavtrykk {
  return { ...tilstand(t), hendelseId: t.hendelseId ?? null, matchetMot: t.matchetMot ?? null };
}

/** Om `t` fortsatt er nøyaktig slik den aktive korrigeringen etterlot den. */
export function uendretSidenKorrigering(t: TransaksjonRecord): boolean {
  const etter = t.saldoKorrigering?.etter;
  if (!etter) return false;
  const naa = avtrykk(t);
  return (Object.keys(etter) as (keyof Tilstandsavtrykk)[]).every((k) => etter[k] === naa[k]);
}

/** Setter korrigeringen og avtrykket av tilstanden den etterlater. */
function medKorrigering(
  t: TransaksjonRecord,
  k: Omit<SaldoKorrigering, "etter">,
): TransaksjonRecord {
  return { ...t, saldoKorrigering: { ...k, etter: avtrykk(t) } };
}

/** Lesbar tilstand for loggen og for skjermen. */
export function tilstandTekst(
  t: Pick<TransaksjonRecord, "status" | "behandlingstype" | "ignorertSom" | "hendelseId"> &
    Partial<Pick<TransaksjonRecord, "forventetMotpost" | "motpartTransaksjonId">>,
): string {
  if (t.status === "ignorert") {
    if (t.ignorertSom === "dublett") return "dublett";
    if (t.ignorertSom === "bankbevegelse") return "ignorert, ekte bevegelse";
    return "ignorert, ikke avklart";
  }
  if (t.behandlingstype === "intern_overforing") {
    return t.forventetMotpost &&
      !t.forventetMotpost.erstattetAv &&
      !t.forventetMotpost.avsluttet &&
      !t.motpartTransaksjonId
      ? "intern overføring, motpost mangler"
      : "intern overføring";
  }
  if (t.hendelseId) return "plassert";
  return t.status ? `status «${t.status}»` : "ubehandlet";
}

function tidligereTekst(s: TidligereTilstand): string {
  return tilstandTekst({
    status: s.status,
    behandlingstype: s.behandlingstype ?? undefined,
    ignorertSom: s.ignorertSom ?? undefined,
  });
}

function medLogg(
  t: TransaksjonRecord,
  handling: KorrigeringsHandling,
  detalj: string,
  naa: string,
  avsluttetKorrigering?: SaldoKorrigering,
): TransaksjonRecord {
  const post = { handling, tidspunkt: naa, detalj };
  return {
    ...t,
    korrigeringslogg: [
      ...(t.korrigeringslogg ?? []),
      avsluttetKorrigering ? { ...post, avsluttetKorrigering } : post,
    ],
    updatedAt: naa,
  };
}

/** Fjerner felt i stedet for å sette `undefined` (Realtime Database godtar ikke `undefined`). */
function uten<K extends keyof TransaksjonRecord>(
  t: TransaksjonRecord,
  ...felt: K[]
): TransaksjonRecord {
  const kopi = { ...t };
  for (const f of felt) delete kopi[f];
  return kopi;
}

function somDublett(t: TransaksjonRecord, arsakId: string | null, naa: string): TransaksjonRecord {
  const ny = medKorrigering(
    {
      ...uten(t, "behandlingstype", "motpartTransaksjonId"),
      status: "ignorert",
      ignorertSom: "dublett",
    },
    { type: "dublett", tidligere: tilstand(t), arsakId, tidspunkt: naa },
  );
  return medLogg(ny, "merket_dublett", `${tilstandTekst(t)} → dublett`, naa);
}

function frakoblet(t: TransaksjonRecord, arsakId: string, naa: string): TransaksjonRecord {
  const ny = medKorrigering(uten(t, "motpartTransaksjonId"), {
    type: "motpart_frakoblet",
    tidligere: tilstand(t),
    arsakId,
    tidspunkt: naa,
  });
  return medLogg(
    ny,
    "motpart_frakoblet",
    "motposten ble merket som dublett; koblingen er fjernet",
    naa,
  );
}

/** Gjenoppretter feltene fra `tidligere` og fjerner den aktive korrigeringen. */
function gjenopprett(
  t: TransaksjonRecord,
  handling: KorrigeringsHandling,
  naa: string,
): TransaksjonRecord {
  const s = t.saldoKorrigering?.tidligere;
  if (!s) return t;
  let ny: TransaksjonRecord = uten(
    t,
    "saldoKorrigering",
    "behandlingstype",
    "motpartTransaksjonId",
    "ignorertSom",
  );
  ny = { ...ny, status: s.status };
  if (s.behandlingstype) ny.behandlingstype = s.behandlingstype;
  if (s.motpartTransaksjonId) ny.motpartTransaksjonId = s.motpartTransaksjonId;
  if (s.ignorertSom) ny.ignorertSom = s.ignorertSom;
  const detalj =
    handling === "motpart_gjenkoblet"
      ? "koblingen til motposten er gjenopprettet"
      : handling === "motpost_avledet_angret"
        ? `intern overføring, motpost mangler → ${tidligereTekst(s)}`
        : `dublett → ${tidligereTekst(s)}`;
  return medLogg(ny, handling, detalj, naa);
}

/**
 * Merker `id` som dublett. `motpartValg` kreves når transaksjonen er en
 * koblet intern overføring; uten gyldig valg (eller hvis merkingen ikke
 * lenger er tillatt) returneres dataene uendret.
 */
export function merkSomDublett(
  id: string,
  motpartValg: MotpartValg | null,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) => {
    const t = prev.find((x) => x.id === id);
    if (!t) return prev;
    const v = vurderDublettMerking(t, prev);
    if (!v.kan) return prev;
    const m = v.motpart;
    if (m && !motpartValg) return prev;
    return prev.map((x) => {
      if (x.id === id) return somDublett(x, null, naa);
      if (m && x.id === m.id) {
        return motpartValg === "ogsaDublett" ? somDublett(x, id, naa) : frakoblet(x, id, naa);
      }
      return x;
    });
  };
}

export function vurderAngring(
  t: TransaksjonRecord,
  alle: readonly TransaksjonRecord[],
): AngreVurdering {
  const k = t.saldoKorrigering;
  if (!k || k.type !== "dublett") {
    return { kan: false, grunn: "Transaksjonen har ingen dublett-merking å angre." };
  }
  if (!uendretSidenKorrigering(t)) {
    return {
      kan: false,
      grunn:
        "Transaksjonen er endret siden den ble merket som dublett, så den gamle tilstanden kan ikke gjenopprettes trygt. Korriger den i Transaksjoner.",
    };
  }
  const mId = k.tidligere.motpartTransaksjonId;
  if (!mId) return { kan: true, motpart: null, gjenkobles: false };
  const m = alle.find((o) => o.id === mId);
  if (!m) {
    return {
      kan: false,
      grunn:
        "Motposten den var koblet til finnes ikke lenger, så koblingen kan ikke gjenopprettes.",
    };
  }
  const mk = m.saldoKorrigering;
  const tilhorer =
    (mk?.type === "motpart_frakoblet" && mk.arsakId === t.id) ||
    (mk?.type === "dublett" && mk.tidligere.motpartTransaksjonId === t.id);
  if (!tilhorer || !uendretSidenKorrigering(m)) {
    return {
      kan: false,
      grunn:
        "Motposten er endret siden merkingen (koblet, plassert eller korrigert på nytt). Koblingen gjenopprettes ikke, så den aldri blir feil.",
    };
  }
  return { kan: true, motpart: m, gjenkobles: true };
}

/** Angrer en dublett-merking, inkludert motpostens frakobling eller par-merking. */
export function angreDublett(
  id: string,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) => {
    const t = prev.find((x) => x.id === id);
    if (!t) return prev;
    const v = vurderAngring(t, prev);
    if (!v.kan) return prev;
    const mId = v.gjenkobles && v.motpart ? v.motpart.id : null;
    return prev.map((x) => {
      if (x.id === id) return gjenopprett(x, "angret_dublett", naa);
      if (x.id === mId) {
        return gjenopprett(
          x,
          x.saldoKorrigering?.type === "dublett" ? "angret_dublett" : "motpart_gjenkoblet",
          naa,
        );
      }
      return x;
    });
  };
}

/**
 * Endrer avklaringen av en ignorert transaksjon uten aktiv dublett-merking,
 * f.eks. en feilmerket dublett som er en ekte bevegelse. Statusen forblir
 * «ignorert». En aktiv dublett-merking reverseres med `angreDublett`.
 */
export function omklassifiserIgnorert(
  id: string,
  som: IgnorertSom,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) =>
    prev.map((t) => {
      if (t.id !== id || t.status !== "ignorert" || t.ignorertSom === som) return t;
      // Aktiv korrigering: reverseres med `angreDublett`, aldri overskrives.
      if (t.saldoKorrigering) return t;
      const fra = tilstandTekst(t);
      const ny: TransaksjonRecord = { ...t, ignorertSom: som };
      return medLogg(ny, "omklassifisert", `${fra} → ${tilstandTekst(ny)}`, naa);
    });
}

/** Hvor mange dager etter kilden den avledede motposten kan dateres (månedsskiftet). */
export const MAKS_DATOFLYTT = 5;

/** `YYYY-MM-DD` + `dager`. */
export function plussDager(dato: string, dager: number): string {
  const d = new Date(`${dato.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dager);
  return d.toISOString().slice(0, 10);
}

/** Kildefeltene en avledet motpost bekreftes mot (se `Kildeavtrykk`). */
/**
 * Kildens beløp i hele øre MED fortegn — nøyaktig samme avrunding som
 * saldoberegningen (`Math.round(kr * 100)`), så enhver beløpsendring som
 * påvirker regnestykket også endrer avtrykket. `null` når beløpet ikke er
 * et endelig tall (mangler, tom/ugyldig tekst, NaN); ingen stille `|| 0`.
 */
export function kildeBelopOre(belop: unknown): number | null {
  if (typeof belop !== "number" && typeof belop !== "string") return null;
  if (typeof belop === "string" && belop.trim() === "") return null;
  const kr = Number(belop);
  return Number.isFinite(kr) ? Math.round(kr * 100) : null;
}

/** Bare et endelig, positivt beløp kan få (eller beholde) en avledet motpost. */
function gyldigKildebelop(t: Pick<TransaksjonRecord, "belop">): boolean {
  const ore = kildeBelopOre(t.belop);
  return ore !== null && ore > 0;
}

const UGYLDIG_BELOP =
  "Kildens beløp er ugyldig, null eller negativt, så motposten kan ikke avledes. Rett beløpet i Transaksjoner.";

export function kildeavtrykk(
  t: Pick<TransaksjonRecord, "belop" | "retning" | "konto" | "importkilde" | "dato">,
): Kildeavtrykk {
  return {
    belopOre: kildeBelopOre(t.belop),
    retning: t.retning,
    konto: normaliserKonto(t),
    dato: (t.dato ?? "").slice(0, 10),
  };
}

export function sammeKildeavtrykk(a: Kildeavtrykk, b: Kildeavtrykk): boolean {
  return (
    a.belopOre === b.belopOre && a.retning === b.retning && a.konto === b.konto && a.dato === b.dato
  );
}

/**
 * Den avledede motposten så lenge den gjelder: kilden er fortsatt en intern
 * overføring uten ekte motpost, og motposten er verken erstattet eller
 * avsluttet. Om den faktisk TELLER, avgjør `aktivForventetMotpost`.
 */
export function gjeldendeForventetMotpost(t: TransaksjonRecord): ForventetMotpost | null {
  const f = t.forventetMotpost;
  return f && !f.erstattetAv && !f.avsluttet && !t.motpartTransaksjonId && erInternOverforing(t)
    ? f
    : null;
}

/**
 * Hvorfor en gjeldende avledet motpost ikke kan telle slik den ble
 * bekreftet, eller `null` når den stemmer. Konservativt: et manglende
 * avtrykk (eldre data), en kildekonto som er ukjent eller lik motkontoen,
 * eller ethvert avvik i beløp, retning, konto eller dato krever ny
 * eksplisitt bekreftelse.
 */
export function kildeEndretGrunn(t: TransaksjonRecord): string | null {
  const f = gjeldendeForventetMotpost(t);
  if (!f) return null;
  const naa = kildeavtrykk(t);
  if (!erKjentKonto(naa.konto) || naa.konto === f.konto) {
    return "Kildens konto er ukjent eller den samme som motkontoen.";
  }
  if (!gyldigKildebelop(t)) return UGYLDIG_BELOP;
  if (!f.kilde) return "Bekreftelsen mangler avtrykk av kilden.";
  const endret = [
    f.kilde.belopOre !== naa.belopOre && "beløp",
    f.kilde.retning !== naa.retning && "retning",
    f.kilde.konto !== naa.konto && "konto",
    f.kilde.dato !== naa.dato && "dato",
  ].filter((x): x is string => !!x);
  return endret.length > 0 ? `Kilden er endret etter bekreftelsen (${endret.join(", ")}).` : null;
}

/**
 * Den avledede motposten, når den TELLER: gjeldende, og kilden er nøyaktig
 * slik Helen bekreftet den. Ellers ingen saldoeffekt.
 */
export function aktivForventetMotpost(t: TransaksjonRecord): ForventetMotpost | null {
  const f = gjeldendeForventetMotpost(t);
  return f && !kildeEndretGrunn(t) ? f : null;
}

export type ForventetMotpostVurdering =
  { kan: true; kildekonto: string } | { kan: false; grunn: string };

/** Om `t` kan få en avledet motpost («Motposten mangler…»). */
export function vurderForventetMotpost(t: TransaksjonRecord): ForventetMotpostVurdering {
  const egen = hinder(t, "Transaksjonen");
  if (egen) return { kan: false, grunn: egen };
  if (t.motpartTransaksjonId) {
    return { kan: false, grunn: "Transaksjonen er allerede koblet til en motpost." };
  }
  if (gjeldendeForventetMotpost(t)) {
    return { kan: false, grunn: "Transaksjonen har allerede en avledet motpost." };
  }
  const kildekonto = normaliserKonto(t);
  if (!erKjentKonto(kildekonto)) {
    return {
      kan: false,
      grunn: "Transaksjonen har ingen kjent konto, så motposten kan ikke plasseres.",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(t.dato)) {
    return { kan: false, grunn: "Transaksjonen har ingen gyldig dato." };
  }
  if (!gyldigKildebelop(t)) return { kan: false, grunn: UGYLDIG_BELOP };
  return { kan: true, kildekonto };
}

/** Datoene den avledede motposten kan ha: kildens dato til `MAKS_DATOFLYTT` dager etter. */
export function forventetDatoGyldig(t: Pick<TransaksjonRecord, "dato">, dato: string): boolean {
  const fra = t.dato.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dato) && dato >= fra && dato <= plussDager(fra, MAKS_DATOFLYTT);
}

/**
 * Gjør `id` til intern overføring med avledet motpost på `konto` den
 * `dato`. `sett` er kilden slik Helen så den da hun bekreftet; den lagres
 * som avtrykk, og avviker de ferske dataene fra den, skrives ingenting.
 * Forrige tilstand lagres for angring. Ugyldig konto/dato eller en
 * transaksjon som ikke lenger kan korrigeres gir uendrede data.
 */
export function leggTilForventetMotpost(
  id: string,
  konto: string,
  dato: string,
  naa: string,
  sett: Kildeavtrykk,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) => {
    const t = prev.find((x) => x.id === id);
    if (!t) return prev;
    const v = vurderForventetMotpost(t);
    if (!v.kan || !erKjentKonto(konto) || konto === v.kildekonto) return prev;
    if (!forventetDatoGyldig(t, dato) || !sammeKildeavtrykk(kildeavtrykk(t), sett)) return prev;
    return prev.map((x) => {
      if (x.id !== id) return x;
      const ny = medKorrigering(
        {
          ...uten(x, "ignorertSom", "motpartTransaksjonId"),
          status: "behandlet",
          behandlingstype: "intern_overforing",
          forventetMotpost: { konto, dato, bekreftet: naa, kilde: { ...sett } },
        },
        { type: "forventet_motpost", tidligere: tilstand(x), arsakId: null, tidspunkt: naa },
      );
      return medLogg(
        ny,
        "motpost_avledet",
        `${tilstandTekst(x)} → intern overføring, motpost mangler (avledet på ${konto} ${dato})`,
        naa,
      );
    });
  };
}

export type EnkelVurdering = { kan: true } | { kan: false; grunn: string };

export function vurderAngringForventet(t: TransaksjonRecord): EnkelVurdering {
  if (t.saldoKorrigering?.type !== "forventet_motpost") {
    return { kan: false, grunn: "Transaksjonen har ingen avledet motpost å angre." };
  }
  if (!uendretSidenKorrigering(t) || !gjeldendeForventetMotpost(t)) {
    return {
      kan: false,
      grunn:
        "Transaksjonen er endret siden motposten ble avledet (koblet, plassert eller korrigert). Korriger den i Transaksjoner.",
    };
  }
  return { kan: true };
}

/** Om en avledet motpost med endret kilde kan bekreftes på nytt. */
export function vurderNyBekreftelse(t: TransaksjonRecord): EnkelVurdering {
  if (t.saldoKorrigering?.type !== "forventet_motpost" || !gjeldendeForventetMotpost(t)) {
    return { kan: false, grunn: "Transaksjonen har ingen avledet motpost å bekrefte." };
  }
  if (!uendretSidenKorrigering(t)) {
    return { kan: false, grunn: "Transaksjonen er endret siden. Avslutt den avledede motposten." };
  }
  if (!kildeEndretGrunn(t)) {
    return { kan: false, grunn: "Kilden er uendret siden bekreftelsen." };
  }
  if (!erKjentKonto(normaliserKonto(t))) {
    return { kan: false, grunn: "Kildens konto er ukjent, så motposten kan ikke plasseres." };
  }
  if (!gyldigKildebelop(t)) return { kan: false, grunn: UGYLDIG_BELOP };
  return { kan: true };
}

/**
 * Bekrefter en avledet motpost på nytt mot kilden slik den er NÅ (`sett`,
 * validert mot de ferske dataene), med motkonto og dato på nytt. Forrige
 * bekreftelse lagres i korrigeringsloggen; korrigeringens «forrige
 * tilstand» er uendret, så angring gjenoppretter fortsatt tilstanden før
 * motposten ble avledet.
 */
export function bekreftForventetMotpostPaaNytt(
  id: string,
  konto: string,
  dato: string,
  naa: string,
  sett: Kildeavtrykk,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) => {
    const t = prev.find((x) => x.id === id);
    if (!t || !vurderNyBekreftelse(t).kan) return prev;
    const naaKilde = kildeavtrykk(t);
    if (!sammeKildeavtrykk(naaKilde, sett)) return prev;
    if (!erKjentKonto(konto) || konto === naaKilde.konto || !forventetDatoGyldig(t, dato)) {
      return prev;
    }
    const f = t.forventetMotpost!;
    const post = {
      handling: "motpost_avledet_bekreftet_paa_nytt" as const,
      tidspunkt: naa,
      detalj: `${kildeEndretGrunn(t)} Avledet på ${f.konto} ${f.dato} → ${konto} ${dato}, bekreftet mot ${sett.retning} ${((sett.belopOre ?? 0) / 100).toFixed(2)} kr ${sett.konto} ${sett.dato}.`,
      tidligereForventetMotpost: f,
    };
    return prev.map((x) =>
      x.id === id
        ? {
            ...x,
            forventetMotpost: { konto, dato, bekreftet: naa, kilde: { ...sett } },
            korrigeringslogg: [...(x.korrigeringslogg ?? []), post],
            updatedAt: naa,
          }
        : x,
    );
  };
}

/** Fjerner den avledede motposten og gjenoppretter tilstanden før. */
export function angreForventetMotpost(
  id: string,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) =>
    prev.map((t) =>
      t.id === id && vurderAngringForventet(t).kan
        ? gjenopprett(uten(t, "forventetMotpost"), "motpost_avledet_angret", naa)
        : t,
    );
}

/**
 * Om en avledet motpost som er endret siden (i Transaksjoner) kan
 * avsluttes. En uendret avledet motpost angres i stedet.
 */
export function vurderAvslutningForventet(t: TransaksjonRecord): EnkelVurdering {
  if (t.saldoKorrigering?.type !== "forventet_motpost") {
    return { kan: false, grunn: "Transaksjonen har ingen avledet motpost å avslutte." };
  }
  if (uendretSidenKorrigering(t)) {
    return { kan: false, grunn: "Den avledede motposten er uendret. Angre den i stedet." };
  }
  return { kan: true };
}

/**
 * Avslutter en avledet motpost som er endret siden den ble lagt til, så
 * transaksjonen ikke blir stående låst. Transaksjonens nåværende tilstand
 * (slik den ble endret i Transaksjoner) røres ikke. Den avledede motposten
 * slutter å telle, men blir liggende med `avsluttet`, og den avsluttede
 * korrigeringen lagres i sin helhet i korrigeringsloggen. Ingenting
 * overskrives og ingen tidligere tilstand går tapt.
 */
export function avsluttForventetMotpost(
  id: string,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) =>
    prev.map((t) => {
      if (t.id !== id || !vurderAvslutningForventet(t).kan) return t;
      const k = t.saldoKorrigering!;
      const f = t.forventetMotpost;
      const ny: TransaksjonRecord = {
        ...uten(t, "saldoKorrigering"),
        ...(f && !f.erstattetAv && !f.avsluttet
          ? { forventetMotpost: { ...f, avsluttet: naa } }
          : {}),
      };
      const hvor = f ? ` på ${f.konto} ${f.dato}` : "";
      return medLogg(
        ny,
        "motpost_avledet_avsluttet",
        `avledet motpost${hvor} avsluttet etter endring i Transaksjoner (før avledning: ${tidligereTekst(k.tidligere)}; nå: ${tilstandTekst(ny)})`,
        naa,
        k,
      );
    });
}

/**
 * Importerte transaksjoner som kan være den ekte motposten til en aktiv
 * avledet motpost: ukoblet, på mottakerkontoen, motsatt retning, likt
 * beløp, og høyst 2 dager fra kildens eller den avledede datoen.
 */
export function importerteMotposter(
  kilde: TransaksjonRecord,
  alle: readonly TransaksjonRecord[],
): TransaksjonRecord[] {
  const f = aktivForventetMotpost(kilde);
  if (!f) return [];
  const avstand = (o: TransaksjonRecord) =>
    Math.min(dagerMellom(kilde.dato, o.dato), dagerMellom(f.dato, o.dato));
  return alle
    .filter(
      (o) =>
        o.id !== kilde.id &&
        !o.motpartTransaksjonId &&
        !erDublett(o) &&
        !gjeldendeForventetMotpost(o) &&
        normaliserKonto(o) === f.konto &&
        retningMotsatt(kilde, o) &&
        belopMatcherIOre(kilde.belop, o.belop) &&
        avstand(o) <= 2,
    )
    .sort(
      (a, b) => avstand(a) - avstand(b) || a.dato.localeCompare(b.dato) || a.id.localeCompare(b.id),
    );
}

/** Om den importerte `motpost` kan kobles til kilden, med grunn når den ikke kan. */
export function vurderKoblingTilImportert(
  kilde: TransaksjonRecord,
  motpost: TransaksjonRecord,
  alle: readonly TransaksjonRecord[],
): EnkelVurdering {
  if (kilde.hendelseId || kilde.matchetMot) {
    return { kan: false, grunn: "Kilden er endret siden motposten ble avledet." };
  }
  if (!importerteMotposter(kilde, alle).some((o) => o.id === motpost.id)) {
    return { kan: false, grunn: "Transaksjonen passer ikke lenger som motpost." };
  }
  const h = hinder(motpost, "Motposten");
  return h ? { kan: false, grunn: h } : { kan: true };
}

/**
 * Erstatter den avledede motposten med den ekte, importerte: vanlig,
 * gjensidig intern-overføringskobling. `forventetMotpost` blir liggende
 * med `erstattetAv` som historikk, og den avledede effekten forsvinner.
 */
export function kobleTilImportertMotpost(
  kildeId: string,
  motpostId: string,
  naa: string,
): (prev: TransaksjonRecord[]) => TransaksjonRecord[] {
  return (prev) => {
    const k = prev.find((x) => x.id === kildeId);
    const m = prev.find((x) => x.id === motpostId);
    if (!k || !m || !vurderKoblingTilImportert(k, m, prev).kan) return prev;
    const f = k.forventetMotpost!;
    return prev.map((x) => {
      if (x.id === kildeId) {
        const ny: TransaksjonRecord = {
          ...uten(x, "saldoKorrigering"),
          motpartTransaksjonId: motpostId,
          forventetMotpost: { ...f, erstattetAv: motpostId },
        };
        // Korrigeringen som erstattes bevares i loggen, som ved avslutning.
        return medLogg(
          ny,
          "motpost_erstattet",
          `avledet motpost på ${f.konto} erstattet av importert transaksjon`,
          naa,
          x.saldoKorrigering,
        );
      }
      if (x.id === motpostId) {
        const ny: TransaksjonRecord = {
          ...uten(x, "ignorertSom"),
          status: "behandlet",
          behandlingstype: "intern_overforing",
          motpartTransaksjonId: kildeId,
        };
        return medLogg(
          ny,
          "motpost_erstattet",
          `${tilstandTekst(x)} → intern overføring (erstatter avledet motpost)`,
          naa,
        );
      }
      return x;
    });
  };
}
