import type { GaveStatus } from "@app-types/gaver";

/**
 * Trinnvis utrulling av status «Pakket» (#20, ordre 7005959850, review
 * 5973381911). Se `docs/drift/gaver-pakket-utrulling.md`.
 *
 * `true` = AKTIVERT (#20 7038853728, etter Helens bekreftede
 * klientoppdatering): «Pakket» kan velges i statusvalgene og skrives av
 * hook-handlingene som de andre statusene.
 *
 * `false` = FORBEREDT (rollback, utrullingsdokumentet §7): appen leser,
 * viser og regner fortsatt med `pakket`, men den kan ikke VELGES, og
 * hook-handlingene avviser den før noe skrives. En gave som allerede er
 * `pakket`, vises riktig og kan endres bort eller lagres med uendret status.
 * Rollback er å revertere aktiveringscommiten — aldri forberedelsen.
 */
export const PAKKET_AKTIVERT: boolean = true;

/** En status som ikke er aktivert, ble forsøkt valgt. Ingenting er skrevet. */
export class StatusIkkeAktivert extends Error {
  override name = "StatusIkkeAktivert";
  constructor(status: GaveStatus) {
    super(`Statusen «${status}» er ikke aktivert ennå. Ingenting er lagret.`);
  }
}

/**
 * Om `ny` kan velges for en gave som i dag har `gjeldende` (`undefined` =
 * ny gave), med bryteren i stillingen `aktivert`. «Pakket» kan bare velges
 * når den er aktivert, eller beholdes når gaven allerede er pakket. Ren
 * funksjon, så både aktivert modus og rollback-modusen kan testes direkte.
 */
export function kanVelgeStatusMed(
  aktivert: boolean,
  ny: GaveStatus,
  gjeldende?: GaveStatus,
): boolean {
  return ny !== "pakket" || aktivert || gjeldende === "pakket";
}

/** {@link kanVelgeStatusMed} med appens faktiske bryter (`PAKKET_AKTIVERT`). */
export function kanVelgeStatus(ny: GaveStatus, gjeldende?: GaveStatus): boolean {
  return kanVelgeStatusMed(PAKKET_AKTIVERT, ny, gjeldende);
}
