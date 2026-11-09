/**
 * Gave- og relasjonsmodulen, S1 julegaver (docs/arkitektur/gave-relasjon-
 * kartlegging.md). Rene funksjoner: arv fra gruppe til person, opprettelse
 * av en anledning med mottakere som øyeblikksbilde, og juleoversikten.
 *
 * Alle beløp er plan i øre. Ingen faktisk kostnad beregnes her; den kommer
 * fra hendelsene i en senere skive.
 */
import {
  type AnledningsType,
  type Anledning,
  type FastBudsjett,
  type Gave,
  type Gruppe,
  type GruppeId,
  type Mottaker,
  type Person,
  GRUPPER,
} from "@app-types/gaver";

export type Kilde = "person" | "gruppe" | "standard";

export interface EffektivStandard {
  aktiv: boolean;
  budsjett: FastBudsjett;
  aktivFra: Kilde;
  budsjettFra: Kilde;
}

export type Grupper = Partial<Record<GruppeId, Gruppe>>;

export const IKKE_SATT: FastBudsjett = { type: "ikke_satt" };

export function gruppeNavn(id: GruppeId): string {
  return GRUPPER.find((g) => g.id === id)?.navn ?? id;
}

const gruppeRekkefolge = (id: GruppeId) => GRUPPER.findIndex((g) => g.id === id);

/**
 * Feltvis arv: personens unntak → gruppens standard → standarden («Jul og
 * bursdag er standard», budsjett ikke satt). Bare et MANGLENDE felt (eller
 * `{type: "arv"}`) arver; `false` og beløp 0 er ekte valg.
 */
export function effektivStandard(
  person: Pick<Person, "gruppe" | "unntak">,
  grupper: Grupper,
  type: AnledningsType,
): EffektivStandard {
  const unntak = person.unntak[type];
  const gruppe = grupper[person.gruppe]?.standard[type];

  let aktiv = true;
  let aktivFra: Kilde = "standard";
  if (typeof unntak?.aktiv === "boolean") {
    aktiv = unntak.aktiv;
    aktivFra = "person";
  } else if (typeof gruppe?.aktiv === "boolean") {
    aktiv = gruppe.aktiv;
    aktivFra = "gruppe";
  }

  let budsjett: FastBudsjett = IKKE_SATT;
  let budsjettFra: Kilde = "standard";
  if (unntak?.budsjett && unntak.budsjett.type !== "arv") {
    budsjett = unntak.budsjett;
    budsjettFra = "person";
  } else if (gruppe?.budsjett) {
    budsjett = gruppe.budsjett;
    budsjettFra = "gruppe";
  }
  return { aktiv, budsjett, aktivFra, budsjettFra };
}

export const julAnledningId = (aar: number): string => `jul-${aar}`;

export function anledningNavn(a: Pick<Anledning, "type" | "aar" | "navn">): string {
  if (a.type === "jul") return `Jul ${a.aar}`;
  if (a.type === "bursdag") return `Bursdag ${a.aar}`;
  return a.navn ? `${a.navn} ${a.aar}` : `Anledning ${a.aar}`;
}

/**
 * Ny julanledning med mottakere og budsjett fra arven, som øyeblikksbilde.
 * Lagres med create-if-absent; finnes `jul-<år>` fra før, brukes den lagrede
 * (ingen reset ved retry eller fra en annen enhet).
 */
export function nyJulAnledning(
  aar: number,
  personer: Person[],
  grupper: Grupper,
  tid: string,
): Anledning {
  const mottakere: Record<string, Mottaker> = {};
  for (const p of personer) {
    if (p.arkivert) continue;
    const e = effektivStandard(p, grupper, "jul");
    if (e.aktiv) mottakere[p.id] = { budsjett: e.budsjett };
  }
  return {
    id: julAnledningId(aar),
    type: "jul",
    aar,
    mottakere,
    versjon: 1,
    opprettet: tid,
    oppdatert: tid,
  };
}

/** Mottakeren slik den skal lagres når personen legges (tilbake) til. */
export function leggTilMottaker(anledning: Anledning, person: Person, grupper: Grupper): Mottaker {
  const finnes = anledning.mottakere[person.id];
  // Tilbake etter fjerning: samme øyeblikksbilde, bare `fjernet` tas bort.
  if (finnes) return { budsjett: finnes.budsjett };
  const type = anledning.type === "annen" ? "jul" : anledning.type;
  return { budsjett: effektivStandard(person, grupper, type).budsjett };
}

/** En idé teller ikke som kjøpt; valgt idé, kjøpt og gitt er planen. */
export const iPlanen = (g: Pick<Gave, "status" | "valgt">): boolean =>
  g.status !== "ide" || g.valgt === true;

export const erKjopt = (g: Pick<Gave, "status">): boolean =>
  g.status === "kjopt" || g.status === "gitt";

export interface MottakerOversikt {
  personId: string;
  /** `null` hvis personen ikke finnes i registeret (skal ikke skje; vises likevel). */
  person: Person | null;
  navn: string;
  budsjett: FastBudsjett;
  gaver: Gave[];
  ferdig: boolean;
  /** Sum planlagt for gaver i planen (valgt idé, kjøpt, gitt). */
  planlagtOre: number;
  /** Gaver i planen uten beløp — summen er da ufullstendig. */
  iPlanenUtenBelop: number;
  /** Ideer som ikke er valgt (alternativer, teller ikke i summen). */
  alternativer: number;
}

export interface Juleoversikt {
  mottakere: MottakerOversikt[];
  /** Fjernet fra årets liste; vises for seg, uten å telle i summene. */
  fjernede: MottakerOversikt[];
  /** Gaver på anledningen for personer som aldri var mottakere (f.eks. lagt inn utenfra). */
  utenforListen: MottakerOversikt[];
  antallFerdig: number;
  antallMangler: number;
  /** Sum av mottakernes budsjett med beløp. */
  budsjettOre: number;
  antallUtenBudsjett: number;
  planlagtOre: number;
  iPlanenUtenBelop: number;
  alternativer: number;
}

function mottakerOversikt(
  personId: string,
  person: Person | null,
  budsjett: FastBudsjett,
  gaver: Gave[],
): MottakerOversikt {
  const egne = gaver
    .filter((g) => g.personId === personId)
    .sort((a, b) => a.opprettet.localeCompare(b.opprettet) || a.id.localeCompare(b.id));
  const plan = egne.filter(iPlanen);
  return {
    personId,
    person,
    navn: person?.navn ?? "Ukjent person",
    budsjett,
    gaver: egne,
    ferdig: egne.some(erKjopt),
    planlagtOre: plan.reduce((s, g) => s + (g.planlagtOre ?? 0), 0),
    iPlanenUtenBelop: plan.filter((g) => g.planlagtOre === undefined).length,
    alternativer: egne.length - plan.length,
  };
}

const sorterMottakere = (a: MottakerOversikt, b: MottakerOversikt) =>
  (a.person ? gruppeRekkefolge(a.person.gruppe) : 99) -
    (b.person ? gruppeRekkefolge(b.person.gruppe) : 99) ||
  a.navn.localeCompare(b.navn, "nb") ||
  a.personId.localeCompare(b.personId);

export function juleoversikt(
  anledning: Anledning,
  personer: Person[],
  gaver: Gave[],
): Juleoversikt {
  const perId = new Map(personer.map((p) => [p.id, p]));
  const paaAnledning = gaver.filter((g) => g.anledningId === anledning.id);
  const mottakere: MottakerOversikt[] = [];
  const fjernede: MottakerOversikt[] = [];
  for (const [personId, m] of Object.entries(anledning.mottakere)) {
    const o = mottakerOversikt(personId, perId.get(personId) ?? null, m.budsjett, paaAnledning);
    (m.fjernet ? fjernede : mottakere).push(o);
  }
  const utenfor = new Set(
    paaAnledning.map((g) => g.personId).filter((id) => !anledning.mottakere[id]),
  );
  const utenforListen = [...utenfor].map((id) =>
    mottakerOversikt(id, perId.get(id) ?? null, IKKE_SATT, paaAnledning),
  );
  mottakere.sort(sorterMottakere);
  fjernede.sort(sorterMottakere);
  utenforListen.sort(sorterMottakere);
  const sum = (f: (m: MottakerOversikt) => number) => mottakere.reduce((s, m) => s + f(m), 0);
  return {
    mottakere,
    fjernede,
    utenforListen,
    antallFerdig: mottakere.filter((m) => m.ferdig).length,
    antallMangler: mottakere.filter((m) => !m.ferdig).length,
    budsjettOre: sum((m) => (m.budsjett.type === "belop" ? m.budsjett.belopOre : 0)),
    antallUtenBudsjett: mottakere.filter((m) => m.budsjett.type !== "belop").length,
    planlagtOre: sum((m) => m.planlagtOre),
    iPlanenUtenBelop: sum((m) => m.iPlanenUtenBelop),
    alternativer: sum((m) => m.alternativer),
  };
}

/** Restgruppen for mottakere som ikke (lenger) finnes i personregisteret. */
export const UTEN_REGISTER = "uten-register";
export const UTEN_REGISTER_NAVN = "Ikke i personregisteret";

export interface MottakerGruppe<T extends { person: Person | null } = MottakerOversikt> {
  /** Gruppe-id fra registeret, eller `UTEN_REGISTER`. */
  id: string;
  navn: string;
  mottakere: T[];
}

/**
 * Grupperer mottakerne etter personens NÅVÆRENDE gruppe i registeret (roadmap
 * Gaver punkt 4, #20). Rekkefølgen er `GRUPPER`, deretter eventuelle ukjente
 * gruppe-id-er, og til slutt restgruppen for mottakere uten registerkobling.
 * Tomme grupper utelates. Hver mottaker havner i nøyaktig én gruppe, i
 * innkommende rekkefølge. Ren visning: anledningens lagrede mottakerliste og
 * budsjett endres ikke. Brukes også av helårsoversikten (samme gruppering).
 */
export function grupperMottakere<T extends { person: Person | null }>(
  mottakere: readonly T[],
): MottakerGruppe<T>[] {
  const perGruppe = new Map<string, T[]>();
  for (const m of mottakere) {
    const id = m.person ? m.person.gruppe : UTEN_REGISTER;
    const liste = perGruppe.get(id);
    if (liste) liste.push(m);
    else perGruppe.set(id, [m]);
  }
  const rang = (id: string) => {
    if (id === UTEN_REGISTER) return Number.MAX_SAFE_INTEGER;
    const i = gruppeRekkefolge(id as GruppeId);
    return i === -1 ? GRUPPER.length : i;
  };
  return [...perGruppe.entries()]
    .sort(([a], [b]) => rang(a) - rang(b) || a.localeCompare(b))
    .map(([id, liste]) => ({
      id,
      navn: id === UTEN_REGISTER ? UTEN_REGISTER_NAVN : gruppeNavn(id as GruppeId),
      mottakere: liste,
    }));
}

/**
 * Personer som kan legges til anledningen: ikke arkivert og ikke aktive
 * mottakere. `foreslatt` = aktive etter arven (f.eks. lagt til i registeret
 * etter at planleggingen startet), `ovrige` = resten. Ingen legges til
 * automatisk.
 */
export function kanLeggesTil(
  anledning: Anledning,
  personer: Person[],
  grupper: Grupper,
): { foreslatt: Person[]; ovrige: Person[] } {
  const type = anledning.type === "annen" ? null : anledning.type;
  const foreslatt: Person[] = [];
  const ovrige: Person[] = [];
  for (const p of personer) {
    if (p.arkivert) continue;
    // Mottakere (også fjernede, som hentes fram fra sin egen liste) hoppes over.
    if (anledning.mottakere[p.id]) continue;
    (type && effektivStandard(p, grupper, type).aktiv ? foreslatt : ovrige).push(p);
  }
  const s = (a: Person, b: Person) =>
    gruppeRekkefolge(a.gruppe) - gruppeRekkefolge(b.gruppe) || a.navn.localeCompare(b.navn, "nb");
  return { foreslatt: foreslatt.sort(s), ovrige: ovrige.sort(s) };
}

/** Personens løpende ideer (uten anledning). */
export const lopendeIdeer = (personId: string, gaver: Gave[]): Gave[] =>
  gaver
    .filter((g) => g.personId === personId && !g.anledningId)
    .sort((a, b) => a.opprettet.localeCompare(b.opprettet) || a.id.localeCompare(b.id));

/** Gaver på tidligere anledninger for personen (historikk), nyeste først. */
export function historikk(
  personId: string,
  gaver: Gave[],
  anledninger: Anledning[],
  unntattId: string,
): { anledning: Anledning; gaver: Gave[] }[] {
  const ut: { anledning: Anledning; gaver: Gave[] }[] = [];
  for (const a of anledninger) {
    if (a.id === unntattId) continue;
    const egne = gaver.filter((g) => g.personId === personId && g.anledningId === a.id);
    if (egne.length > 0) ut.push({ anledning: a, gaver: egne });
  }
  return ut.sort(
    (x, y) => y.anledning.aar - x.anledning.aar || x.anledning.id.localeCompare(y.anledning.id),
  );
}

// ── Inndata ────────────────────────────────────────────────────────────

/** «350», «350,50», «0» → øre; tom → `undefined`; ugyldig → `null`. */
export function tolkPlanBelop(tekst: string): number | undefined | null {
  const renset = tekst.replace(/\s|kr/gi, "").replace(",", ".");
  if (renset === "") return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(renset)) return null;
  return Math.round(Number(renset) * 100);
}

export function belopTekst(ore: number): string {
  return `${new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: ore % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(ore / 100)} kr`;
}

/** Til et redigeringsfelt: 35000 → «350», 35050 → «350,50». */
export const belopFelt = (ore: number | undefined): string =>
  ore === undefined ? "" : (ore / 100).toFixed(ore % 100 === 0 ? 0 : 2).replace(".", ",");

export function budsjettTekst(b: FastBudsjett): string {
  return b.type === "belop" ? belopTekst(b.belopOre) : "Ikke satt";
}

/**
 * «24.12.1980» → «1980-12-24»; «24.12» → «--12-24»; tom → `undefined`;
 * ugyldig → `null`.
 */
export function tolkFodselsdato(tekst: string): string | undefined | null {
  const t = tekst.trim();
  if (t === "") return undefined;
  const m = /^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/.exec(t);
  if (!m) return null;
  const dag = Number(m[1]);
  const mnd = Number(m[2]);
  const aar = m[3] ? Number(m[3]) : 2000; // skuddår for å tillate 29.02 uten år
  const d = new Date(Date.UTC(aar, mnd - 1, dag));
  if (d.getUTCMonth() !== mnd - 1 || d.getUTCDate() !== dag) return null;
  const mm = String(mnd).padStart(2, "0");
  const dd = String(dag).padStart(2, "0");
  return m[3] ? `${m[3]}-${mm}-${dd}` : `--${mm}-${dd}`;
}

export function fodselsdatoTekst(lagret: string | undefined): string {
  if (!lagret) return "";
  const m = /^(\d{4}|-)-?(\d{2})-(\d{2})$/.exec(lagret);
  if (!m) return lagret;
  return m[1] === "-"
    ? `${Number(m[3])}.${Number(m[2])}`
    : `${Number(m[3])}.${Number(m[2])}.${m[1]}`;
}

/** «2025-12-28» → «28.12.2025»; annet vises som det er. */
export function datoTekst(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : iso;
}

export const STATUS_TEKST: Record<Gave["status"], string> = {
  ide: "Idé",
  kjopt: "Kjøpt",
  gitt: "Gitt",
};
