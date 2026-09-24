/**
 * Minimalt, LESE-orientert syn på tre Bankimport/Kvittering-datakilder
 * (`families/{familyId}/transaksjoner`, `.../hendelser`, `.../receipts`)
 * — kun de feltene som faktisk leses av de to konsumentene disse typene
 * deles mellom: Gangen (§Issue #20, "hovedløft" — sine tre signaler
 * "krever vurdering"/"kvittering venter"/"middag i dag") og Budsjett-
 * familien (§Issue #34, `domain/budsjettfamilie/`, Faktisk-beregning og
 * read-only drilldown). IKKE en full karakterisering av hele Bankimport-/
 * Kvitteringsdatamodellen — Bankimport/Kvittering-innboks selv, og all
 * SKRIVING til disse tre nodene (korrigering/kobling), er fortsatt
 * utenfor begge skiver, kun LESING er i scope her.
 *
 * Kalt `BankHendelse` her, IKKE `Hendelse` — det navnet er allerede tatt
 * av `MealEventOption`s "hendelse"-konsept (§types/mealEvent.ts, en helt
 * annen ting: en brukervalgt Middagsplan-dagtype som "Middag hos
 * svigermor"). Samme norske ord, to urelaterte domenebegreper i
 * produksjonskoden — atskilt her for å unngå navnekollisjon.
 */

/** Kun feltene Gangen/Budsjett-familien faktisk leser fra `families/{familyId}/transaksjoner/{id}`. */
export interface BankTransaksjon {
  id: string;
  status: string;
  behandlingstype?: string;
  /** Fritekst fra banken — brukt som visningstekst i Budsjett-familiens drilldown (§index.html linje 9704). */
  tekst?: string;
}

/** Én linje i en hendelses fordeling — hvilken budsjett-/inntekts-/sparepost beløpet er plassert på. */
export interface HendelseFordeling {
  plasseringId: string;
  belop: number;
  plasseringNavn?: string | null;
  eiere?: { person: string; prosent: number }[];
}

/**
 * Kun feltene Gangen/Budsjett-familien faktisk leser fra
 * `families/{familyId}/hendelser/{id}` — Bankimports behandlingslogg
 * (§index.html linje ~6819-6825), ikke å forveksle med Middagsplans
 * `mealEvents`.
 */
export interface BankHendelse {
  id: string;
  transaksjonId: string | null;
  receiptId: string | null;
  /** Kun "ferdig" telles med i Faktisk-beregning/drilldown (§index.html linje 9614, 9689). */
  status?: string;
  /** ISO-dato (YYYY-MM-DD) — måneds-filtrert via `dato.slice(0,7)`. */
  dato?: string;
  /** "manuell" gjør hendelsen gyldig uten noen bank-/kvitteringsobservasjon (§index.html linje 9621, 9692). */
  kilde?: string;
  kommentar?: string;
  fordelinger?: HendelseFordeling[];
}

/** Kun feltene Gangen/Budsjett-familien faktisk leser fra `families/{familyId}/receipts/{id}`. */
export interface Kvittering {
  id: string;
  forkastet?: boolean;
  matchingStatus: "unmatched" | "suggested" | "matched";
  suggestedTransactionId: string | null;
  /** Butikknavn — brukt som visningstekst i Budsjett-familiens drilldown (§index.html linje 9705). */
  merchant?: string;
}
