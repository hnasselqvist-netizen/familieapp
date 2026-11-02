import type { Gave, Person } from "@app-types/gaver";
import { belopFelt, fodselsdatoTekst } from "@domain/gaver/gaver";
import { budsjettUtkast } from "./budsjettUtkast";
import type { GaveFelt, PersonFelt, useUtkastLager } from "./utkast";

/** Åpning av skjemaer i utkastlageret (se `utkast.ts`). */

export const gaveFelt = (g: Gave | null): GaveFelt => ({
  tekst: g?.tekst ?? "",
  status: g?.status ?? "ide",
  valgt: g?.valgt ?? false,
  belop: belopFelt(g?.planlagtOre),
});

/** Åpner et gaveskjema i utkastlageret (ny: `grunn = null` og en ny id). */
export function apneGave(
  lager: ReturnType<typeof useUtkastLager>,
  n: string,
  grunn: Gave | null,
  personId: string,
  anledningId: string | undefined,
  id?: string,
): void {
  lager.sett(n, {
    art: "gave",
    id: grunn?.id ?? id ?? "",
    grunn,
    personId,
    anledningId,
    felt: gaveFelt(grunn),
  });
}

export const personFelt = (p: Person | null): PersonFelt => ({
  navn: p?.navn ?? "",
  gruppe: p?.gruppe ?? "naer",
  fodselsdato: fodselsdatoTekst(p?.fodselsdato),
  notat: p?.notat ?? "",
  aktiv: typeof p?.unntak.jul?.aktiv === "boolean" ? (p.unntak.jul.aktiv ? "ja" : "nei") : "arv",
  budsjett: budsjettUtkast(p?.unntak.jul?.budsjett),
});

/** Åpner et personskjema i utkastlageret (ny: `grunn = null` og en ny id). */
export function apnePerson(
  lager: ReturnType<typeof useUtkastLager>,
  n: string,
  grunn: Person | null,
  id?: string,
): void {
  lager.sett(n, { art: "person", id: grunn?.id ?? id ?? "", grunn, felt: personFelt(grunn) });
}
