/**
 * Én husstand i dag ("familie1"), men aldri hardkodet mer enn dette
 * ene stedet — se src/hooks/useFamilyId.ts. Firebase-reglene
 * (infra/firebase/database.rules.json) er allerede parameterisert med
 * $familyId; denne typen er appens speil av det, uten noe UI eller
 * produktfunksjonalitet bygget rundt det ennå.
 */
export type FamilyId = string;
