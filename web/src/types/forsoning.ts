/**
 * Karakteriseringstyper for forsoningslaget — Bankimport, Kvitterings-
 * innboks, RegelSenter og hendelsene som binder dem sammen
 * (`families/{familyId}/transaksjoner|hendelser|receipts|rules`).
 * Datamodellen er UENDRET fra `index.html` — dette er ikke et nytt skjema
 * (§Issue #34, kartlegging 5938206324).
 *
 * Bevisst atskilt fra de minimale LESE-typene i `types/gangen.ts`
 * (`BankTransaksjon`/`BankHendelse`/`Kvittering`), som kun modellerer det
 * Gangen og Budsjett-familien faktisk leser. Navnene her har `Record`-
 * suffiks for å unngå kollisjon med dem og med Middagsplans "hendelse"-
 * begrep (§types/mealEvent.ts).
 *
 * Felt er valgfrie der legacy-data faktisk kan mangle dem (eldre poster,
 * ulike skriveveier). Ukjente felt bevares av alle motorene (spread), slik
 * at en port aldri stille stripper data legacy fortsatt bruker.
 */

export type Retning = "inn" | "ut";

/** Saldoavstemmingens avklaring av en ignorert transaksjon (#59). */
export type IgnorertSom = "dublett" | "bankbevegelse";
/** Tilstanden en saldokorrigering erstattet — det en reversering gjenoppretter. */
export interface TidligereTilstand {
  status: string | null;
  behandlingstype: string | null;
  motpartTransaksjonId: string | null;
  ignorertSom: IgnorertSom | null;
}

/**
 * `"dublett"`: transaksjonen er merket som dublett fra avstemmingen.
 * `"motpart_frakoblet"`: transaksjonen er en ekte intern overføring som
 * mistet koblingen fordi motposten (`arsakId`) ble merket som dublett.
 */
export interface SaldoKorrigering {
  type: "dublett" | "motpart_frakoblet";
  tidligere: TidligereTilstand;
  arsakId: string | null;
  tidspunkt: string;
}

export type KorrigeringsHandling =
  | "merket_dublett"
  | "angret_dublett"
  | "motpart_frakoblet"
  | "motpart_gjenkoblet"
  | "omklassifisert";

export interface KorrigeringsLoggpost {
  handling: KorrigeringsHandling;
  tidspunkt: string;
  /** Kort, lesbar beskrivelse av endringen (fra → til). */
  detalj: string;
}

export type PlasseringType = "budget" | "income" | "sparing";

export interface Eierandel {
  person: string;
  prosent: number;
}

/** Én linje i en hendelses fordeling — hvor (del)beløpet er plassert. */
export interface Fordeling {
  plasseringId: string;
  plasseringType: PlasseringType;
  /** Denormalisert ved plassering — historisk navn, ikke dagens. */
  plasseringNavn: string;
  /** Fortegn = effekt på posten (negativ = refusjon/motsatt retning). */
  belop: number;
  eiere: Eierandel[];
}

export type HendelseStatus = "ferdig" | "pa_vent" | "uplassert";

/** `families/{familyId}/hendelser[]` — sannheten for plassering/status. */
export interface HendelseRecord {
  id: string;
  status: HendelseStatus;
  paaVentAarsak: string | null;
  transaksjonId: string | null;
  receiptId: string | null;
  fordelinger: Fordeling[];
  dato: string;
  regelId: string | null;
  /** `"manuell"` = økonomisk hendelse uten bank-/kvitteringsobservasjon. */
  kilde?: "manuell";
  kommentar?: string | null;
  opprettet: string;
  oppdatert: string;
}

export interface LaertKobling {
  budgetItemId: string;
  navn: string;
  gruppe?: string;
  flerbruk: boolean;
  /** Ansvaret regelen bak forslaget foreskriver (#59); mangler = postens standard. */
  eiere?: Eierandel[];
}

/** `families/{familyId}/transaksjoner[]` — en ren bankobservasjon. */
export interface TransaksjonRecord {
  id: string;
  dato: string;
  tekst: string;
  /** Alltid absoluttverdi — fortegnet bæres av `retning`. */
  belop: number;
  retning: Retning;
  konto: string | null;
  status: string | null;
  hendelseId?: string | null;
  behandlingstype?: string;
  motpartTransaksjonId?: string;
  matchetMot?: string | null;
  matchetNavn?: string | null;
  laertKobling?: LaertKobling | null;
  laeringsKey?: string;
  /**
   * Hva en IGNORERT transaksjon er for saldoavstemmingen (#59). Settes bare
   * når Helen avklarer det eksplisitt; eldre ignorerte har ikke feltet og
   * regnes som uavklarte. `"dublett"` telles ikke i saldo, `"bankbevegelse"`
   * (ignorert bare for budsjettet) telles. Endrer ikke `status`.
   */
  ignorertSom?: IgnorertSom;
  /**
   * Aktiv korrigering gjort fra saldoavstemmingen (#59): tilstanden før
   * korrigeringen, så den kan reverseres nøyaktig. Mangler = ingen aktiv
   * korrigering. Feltet er additivt; ingen eksisterende data endres uten at
   * Helen gjør det eksplisitt.
   */
  saldoKorrigering?: SaldoKorrigering;
  /** Sporbarhet: hver korrigering og reversering legges til, aldri fjernet. */
  korrigeringslogg?: KorrigeringsLoggpost[];
  normalizedText?: string;
  importkilde?: string;
  importertDato?: string;
  originalRad?: string;
  updatedAt?: string;
}

export type MatchType = "er_lik" | "inneholder" | "starter_med";
export type RegelMode = "auto" | "suggest" | "review" | "disabled";

/** `families/{familyId}/rules[]`. */
export interface RegelRecord {
  id: string;
  pattern: string;
  normalizedPattern: string;
  matchType?: MatchType;
  targetType: PlasseringType;
  targetId: string;
  targetName: string;
  targetGruppe?: string;
  mode: RegelMode;
  confidence?: number;
  timesUsed?: number;
  lastMatched?: string;
  multiUse?: boolean;
  active?: boolean;
  /**
   * Sammensatt vilkår (#59, avanserte regler): regelen treffer bare når
   * betalingen er gjort fra denne kontoen, I TILLEGG til tekstvilkåret.
   * Verdien er den kanoniske kontonøkkelen fra `normaliserKonto`
   * (`"helen"`, `"felleskonto"`, …). Mangler/`null` = alle kontoer, som
   * alle eksisterende regler — feltet er additivt og krever ingen migrering.
   */
  kontoVilkar?: string | null;
  /**
   * Regelens RESULTAT for eierskap (#59, avanserte regler): ansvaret
   * plasseringen får når regelen treffer — samme form som en fordelings
   * `eiere` (jevnt delt mellom valgte personer). Mangler/tom = `Felles 100 %`,
   * som alle eksisterende regler. Kontoen er et treffvilkår, ikke eier.
   */
  eiere?: Eierandel[] | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface KvitteringSplit {
  targetType: "budget" | "income";
  targetId: string;
  targetName: string;
  amount: number;
  description?: string;
  ocrDescription?: string;
  learning?: { approved: boolean; source: string };
  eiere?: Eierandel[];
}

/** `families/{familyId}/receipts[]`. */
export interface KvitteringRecord {
  id: string;
  merchant?: string;
  purchaseDate?: string;
  total?: number;
  allocationMode?: "single" | "split" | null;
  splits?: KvitteringSplit[];
  matchingStatus?: "unmatched" | "suggested" | "matched";
  matchConfidence?: number;
  suggestedTransactionId?: string | null;
  matchingUpdatedAt?: string;
  hendelseId?: string | null;
  /** Eldre, direkte opplastingskobling fra Bankimport (`leggTilKvittering`). */
  transactionId?: string | null;
  forkastet?: boolean;
  /** Bankimport-opplasting: base64-data-URL lagret direkte i noden. */
  imageUrl?: string;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
  driveFolderId?: string | null;
  originalFileName?: string;
  mimeType?: string;
  ocrStatus?: string;
  ocrText?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * En plasserbar post slik Bankimport/Kvittering/manuell registrering
 * bygger den (`allePoster`, `byggAlleMalPoster`, `byggAlleSparingPoster`).
 */
export interface MalPost {
  id: string;
  name: string;
  retning?: Retning;
  plasseringType?: PlasseringType;
  targetType?: "budget" | "income";
  gruppe?: string;
  eier?: string;
}

/** Injiserte avhengigheter — id-generering og "nå" flyttet ut av motorene (§domain/freezer/freezer.ts). */
export interface MotorDeps {
  newId: () => string;
  /** ISO-tidsstempel. */
  naa: string;
}
