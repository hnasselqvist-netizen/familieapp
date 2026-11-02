/**
 * Datakontrakten for gave- og relasjonsmodulen (S1, julegaver), se
 * docs/arkitektur/gave-relasjon-kartlegging.md §3.
 *
 * Fire noder under `families/{familyId}`:
 *   relasjonsgrupper/{gruppeId}, relasjoner/{personId},
 *   anledninger/{anledningId}, gaver/{gaveId}
 *
 * Alle beløp er PLAN i øre. Ingenting her skrives til budget, hendelser,
 * transaksjoner eller receipts.
 *
 * RTDB-stabilitet: Firebase lagrer aldri `null` (feltet forsvinner). Derfor
 * er budsjettvalget en diskriminert union med eksplisitt `type`, så «arv»,
 * «ikke satt» og et beløp (også 0) overlever en rundtur. Fravær av et felt
 * betyr alltid «arv»; `false` og `0` er ekte verdier som bevares.
 *
 * Hver post har `versjon` (heltall). En endring sendes med versjonen
 * brukeren så; avviker den lagrede, avvises skrivingen og utkastet beholdes.
 */

export const GRUPPER = [
  { id: "naer", navn: "Nærmeste familie" },
  { id: "utvidet", navn: "Utvidet familie" },
  { id: "venner", navn: "Venner" },
  { id: "andre", navn: "Andre" },
] as const;

export type GruppeId = (typeof GRUPPER)[number]["id"];

export type AnledningsType = "jul" | "bursdag";

/** Et fastsatt budsjett: enten bevisst ikke satt, eller et beløp (≥ 0). */
export type FastBudsjett = { type: "ikke_satt" } | { type: "belop"; belopOre: number };

/** Personens budsjettvalg: arv fra gruppen, eller et eget fastsatt budsjett. */
export type Budsjettvalg = { type: "arv" } | FastBudsjett;

/** Gruppens standard for én anledningstype. Fravær = standarden (aktiv, ikke satt). */
export interface GruppeStandard {
  aktiv?: boolean;
  budsjett?: FastBudsjett;
}

/** Personens unntak for én anledningstype. Fravær av et felt = arv fra gruppen. */
export interface PersonUnntak {
  aktiv?: boolean;
  budsjett?: Budsjettvalg;
}

export interface Gruppe {
  id: GruppeId;
  standard: Partial<Record<AnledningsType, GruppeStandard>>;
  /** 0 = ikke lagret ennå. */
  versjon: number;
}

export interface Person {
  id: string;
  navn: string;
  gruppe: GruppeId;
  /** "YYYY-MM-DD" eller "--MM-DD" (år ukjent). */
  fodselsdato?: string;
  notat?: string;
  unntak: Partial<Record<AnledningsType, PersonUnntak>>;
  /** ISO-tid. Arkivert = skjules fra nye anledninger, slettes aldri. */
  arkivert?: string;
  versjon: number;
  opprettet: string;
  oppdatert: string;
}

export interface Mottaker {
  /** Øyeblikksbilde ved opprettelse; endres bare for denne anledningen. */
  budsjett: FastBudsjett;
  /** ISO-tid. Fjernet fra årets liste; gavene beholdes og kan hentes fram igjen. */
  fjernet?: string;
}

export interface Anledning {
  id: string;
  type: AnledningsType | "annen";
  aar: number;
  navn?: string;
  mottakere: Record<string, Mottaker>;
  versjon: number;
  opprettet: string;
  oppdatert: string;
}

export type GaveStatus = "ide" | "kjopt" | "gitt";

export interface Gave {
  id: string;
  personId: string;
  /** Fravær = personens løpende idé, ikke knyttet til en anledning. */
  anledningId?: string;
  tekst: string;
  status: GaveStatus;
  /** En idé som er valgt som planen (teller i planlagt sum, ikke som kjøpt). */
  valgt?: boolean;
  /** Planlagt/anslått beløp i øre (≥ 0). Bare plan, aldri faktisk kostnad. */
  planlagtOre?: number;
  versjon: number;
  opprettet: string;
  oppdatert: string;
}

/**
 * En endring av én post: nøkler er felt eller stier («unntak/jul/aktiv»).
 * Verdien `undefined` sletter akkurat det feltet; `null` er aldri lov
 * (RTDB lagrer det ikke) og avvises av datalaget, også nestet.
 */
export type Endring = Record<string, unknown>;
