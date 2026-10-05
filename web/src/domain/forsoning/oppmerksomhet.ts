/**
 * «Trenger oppmerksomhet» på Forvaltning-forsiden (Forvaltning produktfase
 * 1, #34 6000282907). Rene handlingssignaler: hvert tall er antallet ting
 * brukeren faktisk må ta stilling til, og hver ting telles bare ett sted.
 *
 * Kildene er de samme køene skjermene viser, så tallet på forsiden alltid
 * er det brukeren møter når hun åpner køen:
 *  - transaksjoner: `arbeidsko` (disjunkte faner, se `transaksjonsoversikt.ts`);
 *  - kvitteringer: `aktiveKvitteringer` (Kvitteringsinnboksens liste).
 *
 * «På vent» er en bevisst beslutning brukeren allerede har tatt, ikke en ny
 * handling. Det telles for seg og inngår ikke i `antallHandlinger`.
 */
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { aktiveKvitteringer } from "./kvitteringsinnboks";
import { arbeidsko } from "./transaksjonsoversikt";

export interface Oppmerksomhet {
  /** «Krever vurdering»: uten økonomisk effekt og uten forslag. */
  transaksjonerAVurdere: number;
  /** «Forslag til match»: et forslag venter på bekreftelse. */
  forslagTilMatch: number;
  /** Kvitteringer som ikke er ferdig behandlet eller forkastet. */
  kvitteringer: number;
  /** Av `kvitteringer`: de som har et transaksjonsforslag klart. */
  kvitteringerMedForslag: number;
  /** Satt på vent av brukeren — vises rolig, er ikke en ny handling. */
  paaVent: number;
  /** Summen av det som krever en handling (uten «på vent»). */
  antallHandlinger: number;
}

export function beregnOppmerksomhet(
  transaksjoner: readonly TransaksjonRecord[],
  hendelser: readonly HendelseRecord[],
  rules: readonly RegelRecord[],
  kvitteringer: readonly KvitteringRecord[],
): Oppmerksomhet {
  const ko = arbeidsko(transaksjoner, hendelser, rules);
  const aktive = aktiveKvitteringer(kvitteringer, hendelser);
  const transaksjonerAVurdere = ko.vurdering.length;
  const forslagTilMatch = ko.forslag.length;
  return {
    transaksjonerAVurdere,
    forslagTilMatch,
    kvitteringer: aktive.length,
    kvitteringerMedForslag: aktive.filter((r) => r.matchingStatus === "suggested").length,
    paaVent: ko.paavent.length,
    antallHandlinger: transaksjonerAVurdere + forslagTilMatch + aktive.length,
  };
}
