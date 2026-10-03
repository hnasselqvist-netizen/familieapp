import { useCallback } from "react";
import { transactForsoningNode } from "@data/forsoningSkriving.repository";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { ForsoningSkrivingStengt, forsoningSkrivingAktiv } from "./forsoningAktivering";
import { useFamilyId } from "./useFamilyId";

/**
 * Felles skriver for forsoningsnodene (§Issue #34 R3b). Skriver en
 * `Beslutningsendring` som én helnode-transaksjon per node, i fast
 * rekkefølge: hendelser → transaksjoner → receipts → rules. Hendelsen er
 * sannheten (tilstand slås opp via `transaksjonId`), og regel-læring
 * kommer sist, så en feil underveis aldri etterlater en halv plassering.
 *
 * Avviser med `ForsoningSkrivingStengt` før datalaget røres så lenge
 * forsoningsporten er av (til R3b-cutover, ADR 0002).
 */
export function useForsoningSkriver(): (endring: Beslutningsendring) => Promise<void> {
  const familyId = useFamilyId();
  return useCallback(
    async (endring: Beslutningsendring) => {
      if (!forsoningSkrivingAktiv()) throw new ForsoningSkrivingStengt();
      if (endring.hendelser) await transactForsoningNode(familyId, "hendelser", endring.hendelser);
      if (endring.transaksjoner) {
        await transactForsoningNode(familyId, "transaksjoner", endring.transaksjoner);
      }
      if (endring.receipts) await transactForsoningNode(familyId, "receipts", endring.receipts);
      if (endring.rules) await transactForsoningNode(familyId, "rules", endring.rules);
    },
    [familyId],
  );
}
