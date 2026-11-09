/**
 * Helårsoversikten for gaver (roadmap Gaver punkt 2, #20): per person
 * bursdag og jul i ett år, samlet gaveverdi og gjenstående rom mot
 * personens eget gavebudsjett. Rene funksjoner over den eksisterende
 * kontrakten (docs/arkitektur/gave-relasjon-kartlegging.md §3):
 *
 * - Året og anledningen avgjøres BARE av gavens `anledningId`
 *   (`jul-<år>`, `bursdag-<personId>-<år>`), aldri av kjøpsdatoen.
 * - Budsjettet per anledning er øyeblikksbildet på anledningen når den
 *   finnes (som i juleplanen), ellers personens effektive standard
 *   (`effektivStandard`: personunntak → gruppe → standard).
 * - Mangler en anledning som er med, budsjett, er årets budsjett UKJENT;
 *   det regnes aldri som 0. Ingen antakelse om at alle får like mye.
 * - Gaveverdi = beløpene på gaver i planen (valgt idé, kjøpt, gitt), som
 *   i juleoversikten. Gaver uten beløp telles for seg.
 *
 * Ingenting her skriver, oppretter gaver eller poster i økonomien.
 */
import type { Anledning, AnledningsType, FastBudsjett, Gave, Person } from "@app-types/gaver";
import { GRUPPER } from "@app-types/gaver";
import {
  type Grupper,
  type Kilde,
  IKKE_SATT,
  effektivStandard,
  iPlanen,
  julAnledningId,
} from "./gaver";

/** Én bursdag per person og år (kontrakten §3). */
export const bursdagAnledningId = (personId: string, aar: number): string =>
  `bursdag-${personId}-${aar}`;

/**
 * Personens bursdag i `aar` som anledning, med budsjettet fra arven som
 * øyeblikksbilde. Lagres med create-if-absent når brukeren eksplisitt
 * registrerer en bursdagsgave; finnes den, brukes den lagrede.
 */
export function nyBursdagAnledning(
  person: Person,
  aar: number,
  grupper: Grupper,
  tid: string,
): Anledning {
  return {
    id: bursdagAnledningId(person.id, aar),
    type: "bursdag",
    aar,
    mottakere: { [person.id]: { budsjett: effektivStandard(person, grupper, "bursdag").budsjett } },
    versjon: 1,
    opprettet: tid,
    oppdatert: tid,
  };
}

export type BudsjettKilde = Kilde | "anledning";

export interface AnledningsDel {
  type: AnledningsType;
  anledningId: string;
  /** Den lagrede anledningen, eller `null` hvis den ikke er startet/registrert. */
  anledning: Anledning | null;
  /** Teller i personens budsjett for året. */
  med: boolean;
  budsjett: FastBudsjett;
  budsjettFra: BudsjettKilde;
  /** Personens gaver på anledningen, eldste først. */
  gaver: Gave[];
  /** Sum beløp for gaver i planen. */
  verdiOre: number;
  /** Gaver i planen uten beløp (verdien er da ufullstendig). */
  utenBelop: number;
}

/** `kjent` = alle anledninger som er med, har beløp; `ukjent` = minst én mangler; `ingen` = ingen er med. */
export type AarsBudsjett =
  | { type: "kjent"; belopOre: number }
  | { type: "ukjent"; mangler: AnledningsType[] }
  | { type: "ingen" };

export interface HelaarsPerson {
  personId: string;
  /** `null` = gaver for en person som ikke finnes i registeret. */
  person: Person | null;
  navn: string;
  bursdag: AnledningsDel;
  jul: AnledningsDel;
  verdiOre: number;
  utenBelop: number;
  budsjett: AarsBudsjett;
  /** Budsjett minus gaveverdi (negativ = over); `null` når budsjettet ikke er kjent. */
  romOre: number | null;
}

export interface Helaarsoversikt {
  aar: number;
  personer: HelaarsPerson[];
  verdiOre: number;
  utenBelop: number;
  /** Sum budsjett for personene med kjent budsjett. */
  kjentBudsjettOre: number;
  antallUkjentBudsjett: number;
}

function anledningsDel(
  type: AnledningsType,
  anledningId: string,
  anledning: Anledning | null,
  personId: string,
  person: Person | null,
  grupper: Grupper,
  gaver: readonly Gave[],
): AnledningsDel {
  const egne = gaver
    .filter((g) => g.personId === personId && g.anledningId === anledningId)
    .sort((a, b) => a.opprettet.localeCompare(b.opprettet) || a.id.localeCompare(b.id));
  const plan = egne.filter(iPlanen);
  let med = false;
  let budsjett: FastBudsjett = IKKE_SATT;
  let budsjettFra: BudsjettKilde = "standard";
  if (anledning) {
    // Startet: anledningens øyeblikksbilde gjelder, som i juleplanen.
    const m = anledning.mottakere[personId];
    if (m && !m.fjernet) {
      med = true;
      budsjett = m.budsjett;
      budsjettFra = "anledning";
    }
  } else if (person && !person.arkivert) {
    const e = effektivStandard(person, grupper, type);
    med = e.aktiv;
    budsjett = e.budsjett;
    budsjettFra = e.budsjettFra;
  }
  return {
    type,
    anledningId,
    anledning,
    med,
    budsjett,
    budsjettFra,
    gaver: egne,
    verdiOre: plan.reduce((s, g) => s + (g.planlagtOre ?? 0), 0),
    utenBelop: plan.filter((g) => g.planlagtOre === undefined).length,
  };
}

function aarsBudsjett(deler: AnledningsDel[]): AarsBudsjett {
  const med = deler.filter((d) => d.med);
  if (med.length === 0) return { type: "ingen" };
  const mangler = med.filter((d) => d.budsjett.type !== "belop").map((d) => d.type);
  if (mangler.length > 0) return { type: "ukjent", mangler };
  return {
    type: "kjent",
    belopOre: med.reduce((s, d) => s + (d.budsjett.type === "belop" ? d.budsjett.belopOre : 0), 0),
  };
}

/**
 * Personene i oversikten: alle i registeret som ikke er arkivert, pluss
 * arkiverte og ukjente personer som har gaver i året eller står som
 * mottaker på årets jul eller bursdag. Sortert etter gruppe og navn.
 */
export function helaarsoversikt(
  aar: number,
  personer: readonly Person[],
  grupper: Grupper,
  anledninger: readonly Anledning[],
  gaver: readonly Gave[],
): Helaarsoversikt {
  const perId = new Map(personer.map((p) => [p.id, p]));
  const anlPerId = new Map(anledninger.map((a) => [a.id, a]));
  const julId = julAnledningId(aar);
  const jul = anlPerId.get(julId) ?? null;

  const ider = new Set<string>();
  for (const p of personer) if (!p.arkivert) ider.add(p.id);
  for (const g of gaver) {
    if (g.anledningId === julId || g.anledningId === bursdagAnledningId(g.personId, aar)) {
      ider.add(g.personId);
    }
  }
  if (jul) for (const [id, m] of Object.entries(jul.mottakere)) if (!m.fjernet) ider.add(id);
  for (const p of personer) {
    const b = anlPerId.get(bursdagAnledningId(p.id, aar));
    if (b?.mottakere[p.id] && !b.mottakere[p.id]!.fjernet) ider.add(p.id);
  }

  const ut: HelaarsPerson[] = [...ider].map((personId) => {
    const person = perId.get(personId) ?? null;
    const bId = bursdagAnledningId(personId, aar);
    const bursdag = anledningsDel(
      "bursdag",
      bId,
      anlPerId.get(bId) ?? null,
      personId,
      person,
      grupper,
      gaver,
    );
    const julDel = anledningsDel("jul", julId, jul, personId, person, grupper, gaver);
    const verdiOre = bursdag.verdiOre + julDel.verdiOre;
    const budsjett = aarsBudsjett([bursdag, julDel]);
    return {
      personId,
      person,
      navn: person?.navn ?? "Ukjent person",
      bursdag,
      jul: julDel,
      verdiOre,
      utenBelop: bursdag.utenBelop + julDel.utenBelop,
      budsjett,
      romOre: budsjett.type === "kjent" ? budsjett.belopOre - verdiOre : null,
    };
  });

  const rang = (p: HelaarsPerson) => {
    const i = p.person ? GRUPPER.findIndex((g) => g.id === p.person!.gruppe) : -1;
    return i === -1 ? GRUPPER.length : i;
  };
  ut.sort(
    (a, b) =>
      rang(a) - rang(b) ||
      a.navn.localeCompare(b.navn, "nb") ||
      a.personId.localeCompare(b.personId),
  );

  return {
    aar,
    personer: ut,
    verdiOre: ut.reduce((s, p) => s + p.verdiOre, 0),
    utenBelop: ut.reduce((s, p) => s + p.utenBelop, 0),
    kjentBudsjettOre: ut.reduce(
      (s, p) => s + (p.budsjett.type === "kjent" ? p.budsjett.belopOre : 0),
      0,
    ),
    antallUkjentBudsjett: ut.filter((p) => p.budsjett.type === "ukjent").length,
  };
}
