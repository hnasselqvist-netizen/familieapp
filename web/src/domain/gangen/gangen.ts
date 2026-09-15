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
 * 1:1-karakterisering av `trengerVurdering`-tellingen i `GangenScreen`
 * (§index.html linje 2480-2485) — UENDRET oppførsel, ikke del av
 * Kontrolltårnets korrigering (den gjaldt kun kvitteringstellingen under).
 */
export function tellTrengerVurdering(
  transaksjoner: BankTransaksjon[],
  hendelser: BankHendelse[],
): number {
  return transaksjoner.filter((t) => {
    if (t.status === "ignorert" || t.behandlingstype === "intern_overforing") return false;
    const h = finnHendelseForTransaksjon(hendelser, t.id);
    if (h) return false;
    return t.status !== "matchet";
  }).length;
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
