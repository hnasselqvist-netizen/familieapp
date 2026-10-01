/**
 * RTDB-stier og nøkkelkoding. Handleliste-/varebasestiene er identiske
 * med appens (`web/src/data/shopping.repository.ts`, `items.repository.ts`).
 */
import type { FamilyId } from "./types";

export const shoppingPath = (familyId: FamilyId) => `families/${familyId}/shopping`;
export const shoppingEntryPath = (familyId: FamilyId, id: string) =>
  `${shoppingPath(familyId)}/${id}`;
export const itemsPath = (familyId: FamilyId) => `families/${familyId}/items`;
export const itemPath = (familyId: FamilyId, id: string) => `${itemsPath(familyId)}/${id}`;
export const memberPath = (familyId: FamilyId, uid: string) =>
  `families/${familyId}/members/${encodeKey(uid)}`;

export const principalPath = (idpSub: string) => `mcp/principals/${encodeKey(idpSub)}`;
export const actionPath = (familyId: FamilyId, requestId: string) =>
  `mcp/actions/${familyId}/${encodeKey(requestId)}`;

/**
 * Gjør en vilkårlig streng (f.eks. Auth0-sub `google-oauth2|1234`) til en
 * gyldig, deterministisk og fortsatt menneskelesbar RTDB-nøkkel:
 * `. # $ [ ] /`, `%` og kontrolltegn percent-kodes. Vanlige subs
 * (`google-oauth2|1234`, `auth0|abc`) er uendret.
 */
export function encodeKey(raw: string): string {
  if (!raw) throw new Error("Tom RTDB-nøkkel");
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[.#$[\]/%\u0000-\u001f\u007f]/g, (c) => {
    return `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}

/** `familyId` kommer alltid fra en lagret kobling, men valideres likevel før den inngår i en sti. */
export function assertSafeFamilyId(familyId: string): FamilyId {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(familyId)) {
    throw new Error("Ugyldig familyId i principal-kobling");
  }
  return familyId;
}
