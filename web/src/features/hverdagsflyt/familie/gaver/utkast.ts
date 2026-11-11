import { createContext, useContext, useEffect } from "react";
import type { Anledning, Gave, GaveStatus, GruppeId, Person } from "@app-types/gaver";
import type { BudsjettUtkast } from "./budsjettUtkast";

/**
 * Utkastlageret (review 5731615381). Et åpent skjema og utkastet i det
 * eies her, på `GaverView`-nivå, ikke av raden som viser det. Når et
 * abonnement flytter raden (gruppebytte, gave flyttet mellom lister) eller
 * fjerner den (mottaker fjernet, person arkivert), forsvinner ikke
 * utkastet: raden som monteres på nytt henter det med samme nøkkel, og
 * finnes ingen rad (vert) for det, viser `UlagredeUtkast` det med en
 * forklaring. Opprinnelig grunnlag (versjonen brukeren så) lagres sammen
 * med utkastet, så lagring fortsatt gir riktig konflikt.
 */

export type AktivValg = "arv" | "ja" | "nei";

export interface PersonFelt {
  navn: string;
  gruppe: GruppeId;
  fodselsdato: string;
  notat: string;
  aktiv: AktivValg;
  budsjett: BudsjettUtkast;
  /** Bursdagsbudsjettet (helårsoversikten); «arv» = som gruppen. */
  bursdagBudsjett: BudsjettUtkast;
}

export interface GaveFelt {
  tekst: string;
  status: GaveStatus;
  valgt: boolean;
  belop: string;
  /** «YYYY-MM-DD» fra datofeltet, eller tom. */
  kjopsdato: string;
}

export type UtkastPost =
  | { art: "person"; id: string; grunn: Person | null; felt: PersonFelt }
  | {
      art: "gave";
      id: string;
      grunn: Gave | null;
      personId: string;
      anledningId?: string;
      felt: GaveFelt;
    }
  | {
      art: "budsjett";
      personId: string;
      /** Anledningen slik den var da skjemaet ble åpnet (versjonsvakten). */
      grunn: Anledning;
      felt: BudsjettUtkast;
    };

export const nokkel = {
  person: (id: string) => `person:${id}`,
  nyPerson: "person-ny",
  gave: (id: string) => `gave:${id}`,
  nyGave: (anledningId: string, personId: string) => `gave-ny:${anledningId}:${personId}`,
  nyIde: (personId: string) => `ide-ny:${personId}`,
  budsjett: (anledningId: string, personId: string) => `budsjett:${anledningId}:${personId}`,
};

export interface Lager {
  poster: Map<string, UtkastPost>;
  sett: (n: string, p: UtkastPost) => void;
  oppdater: (n: string, fn: (p: UtkastPost) => UtkastPost) => void;
  fjern: (n: string) => void;
  verter: ReadonlyMap<string, number>;
  registrer: (n: string) => () => void;
}

export const LagerKontekst = createContext<Lager | null>(null);

export function useUtkastLager(): Lager {
  const l = useContext(LagerKontekst);
  if (!l) throw new Error("useUtkastLager må brukes inne i <UtkastLager>.");
  return l;
}

/** Komponenten kan vise utkastene med disse nøklene (en «vert») så lenge den er montert. */
export function useVert(...nokler: string[]): void {
  const { registrer } = useUtkastLager();
  const samlet = nokler.join("\n");
  useEffect(() => {
    const av = samlet.split("\n").filter(Boolean).map(registrer);
    return () => av.forEach((f) => f());
  }, [samlet, registrer]);
}
