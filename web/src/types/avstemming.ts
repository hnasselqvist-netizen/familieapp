/**
 * Saldoavstemming per konto og kalendermåned (#59, Helens produktbeslutning
 * 2026-10-08, Kontrolltårnet 6059631349).
 *
 * `families/{familyId}/saldokontroller/{kontoNøkkel}/{YYYY-MM}` — én
 * registrert faktisk saldo fra banken per konto og måned. Ny, additiv node:
 * ingen eksisterende data endres. Status (avstemt/avvik/startpunkt) LAGRES
 * ALDRI; den utledes alltid av kontrollpunktene og dagens transaksjoner, så
 * den revurderes automatisk ved etterimport.
 */
export interface SaldoKontroll {
  /** Kontoen slik `normaliserKonto` leser den (kanonisk nøkkel, eller rå verdi). */
  konto: string;
  /** Kalendermåneden saldoen avslutter (`YYYY-MM`) — kontrollperioden. */
  maaned: string;
  /** Saldodatoen (`YYYY-MM-DD`) — siste dag i måneden. */
  dato: string;
  /**
   * Faktisk saldo fra banken, med fortegn sett fra kontoeieren: positiv =
   * penger på konto, negativ = gjeld. For MC lagres «Skyldig beløp» negativt.
   */
  faktiskSaldo: number;
  registrert: string;
  oppdatert: string;
  /** Øyeblikksbilde av månedens transaksjoner da saldoen ble lagret. */
  grunnlag?: { antall: number; nettoOre: number };
}
