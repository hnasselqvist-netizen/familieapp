import type { GaveStatus } from "@app-types/gaver";

/**
 * Trinnvis utrulling av status «Pakket» (#20, ordre 7005959850, review
 * 5973381911). Se `docs/drift/gaver-pakket-utrulling.md`.
 *
 * `false` = FORBEREDT: appen leser, viser og regner med `pakket`, men den kan
 * ikke VELGES i statusvalgene, og hook-handlingene avviser den før noe
 * skrives. En gave som allerede er `pakket`, vises riktig og kan endres bort
 * eller lagres med uendret status.
 *
 * Aktivering er en egen, senere commit som setter denne til `true`, etter at
 * eldre åpne faner er håndtert som beskrevet i utrullingsdokumentet.
 */
export const PAKKET_AKTIVERT: boolean = false;

/** En status som ikke er aktivert, ble forsøkt valgt. Ingenting er skrevet. */
export class StatusIkkeAktivert extends Error {
  override name = "StatusIkkeAktivert";
  constructor(status: GaveStatus) {
    super(`Statusen «${status}» er ikke aktivert ennå. Ingenting er lagret.`);
  }
}

/**
 * Om `ny` kan velges for en gave som i dag har `gjeldende` (`undefined` =
 * ny gave). «Pakket» kan bare velges når den er aktivert, eller beholdes når
 * gaven allerede er pakket.
 */
export function kanVelgeStatus(ny: GaveStatus, gjeldende?: GaveStatus): boolean {
  return ny !== "pakket" || PAKKET_AKTIVERT || gjeldende === "pakket";
}
