import { createContext, useContext } from "react";
import type { FamilyId } from "@app-types/family";

/**
 * Det ENE stedet i appen som vet hvilken husstand som er aktiv.
 *
 * I dag finnes bare "familie1", og ingen UI bygges for å velge eller
 * bytte husstand (§låst produktbeslutning — ikke bygg multi-tenant nå).
 * Poenget med denne seamen er utelukkende at de ~30 stedene som i
 * dagens index.html hardkoder `FAM = "families/familie1"` blir ETT sted
 * her — billig å gjøre nå, dyrt å rydde opp i senere. Se
 * docs/beslutninger for resonnementet.
 */
const FamilyIdContext = createContext<FamilyId>("familie1");

export const FamilyIdProvider = FamilyIdContext.Provider;

export function useFamilyId(): FamilyId {
  return useContext(FamilyIdContext);
}
