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
