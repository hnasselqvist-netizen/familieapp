/**
 * Autorisasjon PER VERKTØYKALL (Issue #27, 5936936743 §1 + 5937138669 pkt. 1):
 *
 *   gyldig token  →  krevd scope  →  eksplisitt kobling idpSub → firebaseUid
 *   →  koblingen ikke deaktivert  →  firebaseUid er FORTSATT medlem av
 *   familien  →  FamilyContext
 *
 * `familyId` kommer ALDRI fra forespørselen (verktøyene har ikke engang et
 * slikt felt) — kun fra den lagrede koblingen, og medlemskapet sjekkes på
 * nytt ved hvert kall, så tilgang kan trekkes tilbake på tre uavhengige
 * måter: deaktiver koblingen, fjern medlemskapet, eller blokker brukeren i
 * IdP-en (tokens slutter å valideres / fornyes).
 *
 * Ingen e-postbasert implisitt kobling, i noen retning.
 */
import { assertSafeFamilyId } from "../store/paths";
import type { FamilyId, HverdagsflytStore } from "../store/types";
import type { Scope } from "./protectedResource";
import type { VerifiedToken } from "./tokens";

export interface FamilyContext {
  familyId: FamilyId;
  firebaseUid: string;
  idpSub: string;
  clientId: string;
}

export type AuthorizationCode =
  "insufficient_scope" | "not_linked" | "link_disabled" | "not_member";

export class AuthorizationError extends Error {
  readonly code: AuthorizationCode;
  readonly requiredScope?: Scope;

  constructor(code: AuthorizationCode, message: string, requiredScope?: Scope) {
    super(message);
    this.code = code;
    this.requiredScope = requiredScope;
    this.name = "AuthorizationError";
  }
}

export async function authorizeToolCall(
  store: HverdagsflytStore,
  token: VerifiedToken,
  requiredScope: Scope,
): Promise<FamilyContext> {
  if (!token.scopes.includes(requiredScope)) {
    throw new AuthorizationError(
      "insufficient_scope",
      `Tokenet mangler scope ${requiredScope}.`,
      requiredScope,
    );
  }

  const link = await store.getPrincipalLink(token.sub);
  if (!link) {
    throw new AuthorizationError(
      "not_linked",
      "Denne innloggingen er ikke koblet til en Hverdagsflyt-bruker.",
    );
  }
  if (link.disabled) {
    throw new AuthorizationError("link_disabled", "Koblingen til Hverdagsflyt er deaktivert.");
  }

  const familyId = assertSafeFamilyId(link.familyId);
  if (!(await store.isFamilyMember(familyId, link.firebaseUid))) {
    throw new AuthorizationError(
      "not_member",
      "Den koblede Hverdagsflyt-brukeren er ikke lenger medlem av familien.",
    );
  }

  return { familyId, firebaseUid: link.firebaseUid, idpSub: token.sub, clientId: token.clientId };
}
