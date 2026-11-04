/**
 * Endre koblet målpost på en eksisterende regel (#59, Helens bestilling
 * 6543518396, ordre 6643098967). Ren modul; kalleren skriver.
 *
 * - Valgene kommer fra dagens autoritative økonomistruktur (`budget`,
 *   `incomeGroups`, `sparingGroups`) — aktive poster, samme kilder som
 *   `finnMalpostForRegel` og postvalget ved behandling. Ingen ny struktur.
 * - Et mål identifiseres av type + id (`malNokkel`), så like navn på ulike
 *   steder holdes fra hverandre.
 * - Endringen er ÉN sammenhengende oppdatering av `targetId`, `targetType`,
 *   `targetName` og `targetGruppe`, beregnet mot FERSK regelliste og FERSK
 *   struktur. Navn og livsområde hentes fra strukturen, aldri fra et
 *   gammelt utkast. Alle andre felt — mønster, matchtype, konto, eiere,
 *   confidence, mode, active, multiUse, brukstelling og ukjente felt —
 *   beholdes slik de ligger nå.
 * - Endringen gjelder regelen for fremtidig bruk. Ingen transaksjoner,
 *   hendelser eller kontrollmetadata endres.
 */
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { PlasseringType, RegelRecord } from "@app-types/forsoning";

export interface RegelGrupperKilde {
  budgetGroups: BudsjettGruppe[] | null | undefined;
  incomeGroups: BudsjettGruppe[] | null | undefined;
  sparingGroups: BudsjettGruppe[] | null | undefined;
}

export interface RegelMal {
  type: PlasseringType;
  id: string;
  navn: string;
  /** Livsområdet (gruppens etikett), som `targetGruppe`. */
  gruppe: string;
}

export const MALTYPE_LABEL: Record<PlasseringType, string> = {
  budget: "Kostnad",
  income: "Inntekt",
  sparing: "Sparing",
};

/** Stabil nøkkel for et mål: type + id (like navn på ulike steder er ulike mål). */
export const malNokkel = (m: { type: PlasseringType; id: string }) => `${m.type}:${m.id}`;

/** Regelens nåværende mål som nøkkel. Eldre regler uten `targetType` er kostnad. */
export const regelMalNokkel = (r: Pick<RegelRecord, "targetType" | "targetId">) =>
  malNokkel({ type: r.targetType || "budget", id: r.targetId });

const KILDER: [keyof RegelGrupperKilde, PlasseringType][] = [
  ["budgetGroups", "budget"],
  ["incomeGroups", "income"],
  ["sparingGroups", "sparing"],
];

/** Alle gyldige mål: aktive (ikke arkiverte) poster i de tre strukturene, i strukturens rekkefølge. */
export function regelMalValg(grupper: RegelGrupperKilde): RegelMal[] {
  return KILDER.flatMap(([node, type]) =>
    (grupper[node] || []).flatMap((g) =>
      (g.items || [])
        .filter((it) => !(it.meta && it.meta.arkivert))
        .map((it) => ({ type, id: it.id, navn: it.name, gruppe: g.label })),
    ),
  );
}

/** Målet med denne type + id i fersk struktur, eller `null` (slettet, arkivert eller feil type). */
export function finnRegelMal(
  grupper: RegelGrupperKilde,
  m: { type: PlasseringType; id: string },
): RegelMal | null {
  return regelMalValg(grupper).find((x) => x.type === m.type && x.id === m.id) ?? null;
}

/** Søk i post, livsområde og type (små/store bokstaver likt). Tomt søk gir alle. */
export function sokRegelMal(valg: readonly RegelMal[], sok: string): RegelMal[] {
  const s = sok.trim().toLowerCase();
  if (!s) return [...valg];
  return valg.filter((m) =>
    [m.navn, m.gruppe, MALTYPE_LABEL[m.type]].some((t) => t.toLowerCase().includes(s)),
  );
}

export type EndreMalUtfall =
  | { status: "lagret"; mal: RegelMal }
  | { status: "uendret" }
  | { status: "regel_slettet" }
  | { status: "mal_ugyldig" }
  /**
   * Målet er endret av noen andre siden utkastet ble laget — ingenting
   * skrevet. `naa` er regelens faktiske mål i transaksjonen (review
   * 5776966235): grunnlaget for en eksplisitt ny lagring.
   */
  | {
      status: "endret_samtidig";
      naa: { targetType: PlasseringType; targetId: string; targetName: string };
    };

/**
 * Beregner ny regelliste for en målendring. `fra` er målet brukeren så da
 * utkastet ble laget; er regelens mål endret siden (av en annen skriver),
 * skrives ingenting (`endret_samtidig`) — ingen stille overskriving.
 * Ved alle andre utfall enn `lagret` er listen uendret (samme innhold).
 */
export function endreRegelMal(
  prev: readonly RegelRecord[] | null | undefined,
  regelId: string,
  fra: { type: PlasseringType; id: string },
  til: { type: PlasseringType; id: string },
  grupper: RegelGrupperKilde,
  naa: string,
): { regler: RegelRecord[]; utfall: EndreMalUtfall } {
  const liste = [...(prev || [])];
  const regel = liste.find((r) => r.id === regelId);
  if (!regel) return { regler: liste, utfall: { status: "regel_slettet" } };
  const mal = finnRegelMal(grupper, til);
  if (!mal) return { regler: liste, utfall: { status: "mal_ugyldig" } };
  const naaNokkel = regelMalNokkel(regel);
  // «Uendret» bare når HELE det kanoniske målet stemmer — også livsområdet
  // (review 5776966235). Et flyttet, omdøpt eller fjernet livsområde
  // oppdateres; et foreldet `targetGruppe` henger aldri igjen.
  if (
    naaNokkel === malNokkel(mal) &&
    regel.targetName === mal.navn &&
    (regel.targetGruppe || "") === mal.gruppe &&
    (mal.gruppe !== "" || !("targetGruppe" in regel))
  ) {
    return { regler: liste, utfall: { status: "uendret" } };
  }
  if (naaNokkel !== malNokkel(fra) && naaNokkel !== malNokkel(mal)) {
    return {
      regler: liste,
      utfall: {
        status: "endret_samtidig",
        naa: {
          targetType: regel.targetType || "budget",
          targetId: regel.targetId,
          targetName: regel.targetName,
        },
      },
    };
  }
  return {
    regler: liste.map((r) => {
      if (r.id !== regelId) return r;
      const ny: RegelRecord = {
        ...r,
        targetId: mal.id,
        targetType: mal.type,
        targetName: mal.navn,
        updatedAt: naa,
      };
      // Gruppefeltet erstattes alltid — aldri et foreldet livsområde etter bytte.
      if (mal.gruppe) ny.targetGruppe = mal.gruppe;
      else delete ny.targetGruppe;
      return ny;
    }),
    utfall: { status: "lagret", mal },
  };
}
