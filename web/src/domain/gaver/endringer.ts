/**
 * Endringene skjemaene sender, som rene byggere (review 5731352564 P2).
 *
 * Hver bygger patcher BARE feltene skjemaet eier, med stier ned til det
 * enkelte feltet («unntak/jul/aktiv», «…/budsjett/type»). Ukjente felt og
 * underfelt i den lagrede posten bevares derfor, også under et unntak, et
 * budsjett eller en mottaker. «Arv» sletter bare de KJENTE feltene.
 * `undefined` = slett akkurat det feltet; `null` brukes aldri.
 */
import type {
  Anledning,
  Budsjettvalg,
  Endring,
  FastBudsjett,
  GaveStatus,
  GruppeId,
  Person,
  PersonUnntak,
} from "@app-types/gaver";
import { type Grupper, leggTilMottaker } from "./gaver";

export interface PersonUtkast {
  navn: string;
  gruppe: GruppeId;
  fodselsdato?: string;
  notat?: string;
  /** Unntak for jul; et manglende felt (eller `{type: "arv"}`) = arv fra gruppen. */
  jul: PersonUnntak;
}

export interface GaveUtkast {
  personId: string;
  anledningId?: string;
  tekst: string;
  status: GaveStatus;
  valgt?: boolean;
  planlagtOre?: number;
}

/** Budsjettet under `prefiks`: bare `type` og `belopOre` røres. */
export function budsjettEndring(prefiks: string, b: Budsjettvalg | undefined): Endring {
  if (!b || b.type === "arv") {
    return { [`${prefiks}/type`]: undefined, [`${prefiks}/belopOre`]: undefined };
  }
  return {
    [`${prefiks}/type`]: b.type,
    [`${prefiks}/belopOre`]: b.type === "belop" ? b.belopOre : undefined,
  };
}

export function personEndring(u: PersonUtkast): Endring {
  return {
    navn: u.navn.trim(),
    gruppe: u.gruppe,
    fodselsdato: u.fodselsdato || undefined,
    notat: u.notat?.trim() || undefined,
    "unntak/jul/aktiv": typeof u.jul.aktiv === "boolean" ? u.jul.aktiv : undefined,
    ...budsjettEndring("unntak/jul/budsjett", u.jul.budsjett),
  };
}

export function gruppeStandardEndring(jul: { aktiv: boolean; budsjett: FastBudsjett }): Endring {
  return {
    "standard/jul/aktiv": jul.aktiv,
    ...budsjettEndring("standard/jul/budsjett", jul.budsjett),
  };
}

/**
 * Legg til eller tilbake. Tilbake etter myk fjerning sletter BARE `fjernet`
 * (øyeblikksbildet og ev. ukjente felt står); en ny mottaker får budsjettet
 * fra arven.
 */
export function leggTilMottakerEndring(
  anledning: Anledning,
  person: Person,
  grupper: Grupper,
): Endring {
  const sti = `mottakere/${person.id}`;
  if (anledning.mottakere[person.id]) return { [`${sti}/fjernet`]: undefined };
  return budsjettEndring(`${sti}/budsjett`, leggTilMottaker(anledning, person, grupper).budsjett);
}

export const fjernMottakerEndring = (personId: string, tid: string): Endring => ({
  [`mottakere/${personId}/fjernet`]: tid,
});

export const mottakerBudsjettEndring = (personId: string, b: FastBudsjett): Endring =>
  budsjettEndring(`mottakere/${personId}/budsjett`, b);

export function gaveEndring(u: GaveUtkast): Endring {
  return {
    personId: u.personId,
    anledningId: u.anledningId || undefined,
    tekst: u.tekst.trim(),
    status: u.status,
    // Kjøpt/gitt er alltid i planen; «valgt» gjelder bare en idé.
    valgt: u.status === "ide" && u.valgt ? true : undefined,
    planlagtOre: u.planlagtOre,
  };
}

/** En endring som ny verdi (til oppretting): stier blir objekter, `undefined` utelates. */
export function tilVerdi(endring: Endring): Record<string, unknown> {
  const ut: Record<string, unknown> = {};
  for (const [sti, verdi] of Object.entries(endring)) {
    if (verdi === undefined) continue;
    const deler = sti.split("/");
    let node = ut;
    for (const del of deler.slice(0, -1)) {
      const neste = node[del];
      node[del] = neste && typeof neste === "object" ? neste : {};
      node = node[del] as Record<string, unknown>;
    }
    node[deler[deler.length - 1]!] = verdi;
  }
  return ut;
}
