/**
 * Mellomværende (#95): et utlegg som gjøres opp ved at en motpart slutter å
 * betale noe hun ellers betaler (gaven mamma la ut, motregnet i
 * abonnementene hun vanligvis dekker).
 *
 * To lagringssteder, med hver sin rolle:
 *  - **avtalen** i `families/{familyId}/mellomvaerender/{id}` — hva som er
 *    avtalt (beløp, startmåned, poster, eiere);
 *  - **den økonomiske effekten** som manuelle hendelser i `hendelser[]` med
 *    koblingsfeltet `mellomvaerende` og deterministisk id: kostnaden
 *    (`mv-{id}-kostnad`) og ett oppgjør per måned (`mv-{id}-{YYYY-MM}`).
 *
 * Restsaldo, forslag og forfalte måneder avledes fra hendelsene — ikke
 * lagret — så økonomien og oversikten aldri kan spriker.
 */
import type { Eierandel, PlasseringType } from "./forsoning";

/** En budsjettpost avtalen peker på, med eierne brukeren valgte. */
export interface MellomvaerendePost {
  postId: string;
  postNavn: string;
  plasseringType: PlasseringType;
  eiere: Eierandel[];
}

/** `families/{familyId}/mellomvaerender/{id}`. */
export interface Mellomvaerende {
  id: string;
  /** F.eks. «Gave fra mamma». */
  navn: string;
  /** F.eks. «Mamma». */
  motpart: string;
  /** Hele utlegget, i øre (> 0). */
  opprinneligOre: number;
  /** `YYYY-MM`: kostnaden føres og første oppgjør forfaller denne måneden. */
  startMaaned: string;
  /** Hvor utlegget er en faktisk kostnad (f.eks. Gaver). */
  kostnad: MellomvaerendePost;
  /** Hvor oppgjørene reduserer faktisk kostnad (f.eks. Abonnementer). */
  oppgjor: MellomvaerendePost;
  /** Første foreslåtte månedsbeløp, i øre (> 0). */
  standardBelopOre: number;
  opprettet: string;
  av: string;
}

export type MellomvaerendeHandling = "bekreftet" | "rettet" | "angret";

/** Én linje i sporet på en oppgjørshendelse. */
export interface MellomvaerendeSpor {
  handling: MellomvaerendeHandling;
  /** Beløpet etter handlingen (0 ved angring), i øre. */
  belopOre: number;
  tid: string;
  av: string;
}

/** Koblingsfeltet på en hendelse som hører til et mellomværende. */
export interface MellomvaerendeKobling {
  id: string;
  rolle: "kostnad" | "oppgjor";
  /** `YYYY-MM` for oppgjør; startmåneden for kostnaden. */
  maaned: string;
  /** Aktivt beløp i øre (0 = angret). */
  belopOre: number;
  spor: MellomvaerendeSpor[];
}
