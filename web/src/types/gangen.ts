/**
 * Minimalt, LESE-orientert syn på tre Bankimport/Kvittering-datakilder
 * (`families/{familyId}/transaksjoner`, `.../hendelser`, `.../receipts`)
 * — kun de feltene Gangen faktisk leser for sine tre signaler ("krever
 * vurdering"/"kvittering venter"/"middag i dag"), IKKE en full
 * karakterisering av hele Bankimport-/Kvitteringsdatamodellen
 * (§Kontrolltårn-handoff, Issue #20, "hovedløft" — Bankimport/Kvittering
 * selv er fortsatt utenfor denne skiven, kun LESING for Gangens
 * oppsummeringssignaler er i scope).
 *
 * Kalt `BankHendelse` her, IKKE `Hendelse` — det navnet er allerede tatt
 * av `MealEventOption`s "hendelse"-konsept (§types/mealEvent.ts, en helt
 * annen ting: en brukervalgt Middagsplan-dagtype som "Middag hos
 * svigermor"). Samme norske ord, to urelaterte domenebegreper i
 * produksjonskoden — atskilt her for å unngå navnekollisjon.
 */

/** Kun feltene Gangen faktisk leser fra `families/{familyId}/transaksjoner/{id}`. */
export interface BankTransaksjon {
  id: string;
  status: string;
  behandlingstype?: string;
}

/**
 * Kun feltene Gangen faktisk leser fra `families/{familyId}/hendelser/{id}`
 * — Bankimports behandlingslogg (§index.html linje ~6819-6825), ikke å
 * forveksle med Middagsplans `mealEvents`.
 */
export interface BankHendelse {
  id: string;
  transaksjonId: string | null;
  receiptId: string | null;
}

/** Kun feltene Gangen faktisk leser fra `families/{familyId}/receipts/{id}`. */
export interface Kvittering {
  id: string;
  forkastet?: boolean;
  matchingStatus: "unmatched" | "suggested" | "matched";
  suggestedTransactionId: string | null;
}
