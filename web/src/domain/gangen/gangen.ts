/**
 * Rene motorfunksjoner for Gangens tre "hva trenger deg nå"-signaler
 * (§Kontrolltårn-handoff, Issue #20, "hovedløft"). Ingen Firebase, ingen
 * UI — mottar allerede hentede lister, returnerer et tall/en verdi.
 */
import type { BankHendelse, BankTransaksjon, Kvittering } from "@app-types/gangen";

/** 1:1-karakterisering av `finnHendelseForTransaksjon` (§index.html linje 10022-10025). */
export function finnHendelseForTransaksjon(
  hendelser: BankHendelse[],
  transaksjonId: string | null,
): BankHendelse | null {
  if (!transaksjonId) return null;
  return hendelser.find((h) => h.transaksjonId === transaksjonId) ?? null;
}

/**
 * Gangens «N transaksjoner venter på vurdering»: antallet transaksjoner
 * brukeren må ta stilling til, talt likt som Forvaltning-forsiden
 * (`domain/forsoning/oppmerksomhet.ts`) — summen av arbeidskøens
 * «Krever vurdering» og «Forslag til match» (`arbeidsko`, disjunkte faner).
 * Hver transaksjon telles én gang.
 *
 * Utgangspunkt: `trengerVurdering` i `GangenScreen` (§index.html linje
 * 2480-2485): ikke ignorert/intern, ingen koblet hendelse, ikke `matchet`.
 *
 * **Bevisst avvik (Forvaltning produktfase, #59):** en koblet hendelse som
 * verken er `ferdig` eller `pa_vent` (uplassert) telles med. Arbeidskøen
 * viser den i «Krever vurdering» (avvik pre-cutover 2), så uten dette sa
 * Gangen «ingenting venter» mens Forvaltning viste noe å vurdere. «På
 * vent» er brukerens egen beslutning og telles ikke, som på Forvaltning.
 */
export function tellTrengerVurdering(
  transaksjoner: BankTransaksjon[],
  hendelser: BankHendelse[],
): number {
  return transaksjoner.filter((t) => {
    if (t.status === "foresoatt_match") return true;
    if (t.status === "ignorert" || t.behandlingstype === "intern_overforing") return false;
    const h = finnHendelseForTransaksjon(hendelser, t.id);
    if (!h) return t.status !== "matchet";
    return h.status !== "ferdig" && h.status !== "pa_vent";
  }).length;
}

/**
 * Av `tellTrengerVurdering`: transaksjonene som er forslag til match —
 * samme definisjon som arbeidskøens «Forslag til match»
 * (`arbeidsko().forslag`, §domain/forsoning/transaksjonsoversikt.ts).
 * Gangen bruker den til å åpne riktig kø direkte.
 */
export function tellForslagTilMatch(transaksjoner: BankTransaksjon[]): number {
  return transaksjoner.filter((t) => t.status === "foresoatt_match").length;
}

/**
 * Erstatter den gamle `kvitteringerApne`-tellingen (§index.html linje
 * 2487-2491, `!r.forkastet && (!finnHendelseForKvittering(...) ||
 * hendelse.status!=="ferdig")`) — den regnet ENHVER aktiv, ikke-ferdig
 * kvittering med, uavhengig av om systemet faktisk hadde noe konkret å
 * foreslå.
 *
 * **Låst korrigering** (§Kontrolltårn-handoff, Issue #20, "hovedløft",
 * bekreftet av Helen): Gangens kvitteringsmelding skal KUN gjelde
 * kvitteringer som faktisk er klare for kobling — verifisert mot
 * `KvitteringInnboksScreen`s egen skrivelogikk (§index.html linje
 * 5879-5881, 5992-5994): en kvittering får `matchingStatus:"suggested"`
 * KUN når systemet har et konkret forslag (samtidig med
 * `suggestedTransactionId`), og flyttes til `matchingStatus:"matched"`
 * i SAMME skriving som den faktisk kobles — `"suggested"` alene betyr
 * derfor allerede "har et konkret, ubekreftet forslag, ikke ferdig
 * kvittert ennå", uten behov for en egen "ferdig"-sjekk via hendelsen.
 */
export function erKvitteringKlarForKobling(receipt: Kvittering): boolean {
  if (receipt.forkastet) return false;
  return receipt.matchingStatus === "suggested" && receipt.suggestedTransactionId !== null;
}

export function tellKvitteringerKlareForKobling(receipts: Kvittering[]): number {
  return receipts.filter(erKvitteringKlarForKobling).length;
}
