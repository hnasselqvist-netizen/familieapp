/**
 * Oppretter, endrer eller deaktiverer en principal-kobling
 * `mcp/principals/{idpSub}` → `{ firebaseUid, familyId }` (README §Auth).
 * Koblingen er ALDRI e-postbasert og opprettes aldri av serveren selv —
 * kun av en operatør, eksplisitt, via `linkPrincipal.ts`.
 *
 * Ren planlegging (`planPrincipalLink`) + en tynn utfører over en minimal
 * port, så samme logikk testes mot in-memory og mot RTDB-emulatoren.
 */
import { assertSafeFamilyId, memberPath, principalPath } from "../store/paths";
import type { PrincipalLink } from "../store/types";

export interface PrincipalLinkRequest {
  idpSub: string;
  firebaseUid: string;
  familyId: string;
  /** Trekk tilbake tilgang uten å slette koblingen (audit-spor). */
  disable?: boolean;
  /** Tillat å peke en eksisterende kobling til en annen bruker/familie. */
  replace?: boolean;
}

export type PrincipalLinkPlan =
  | { action: "create" | "update"; path: string; next: PrincipalLink; current: unknown }
  | { action: "unchanged"; path: string; current: unknown }
  | { action: "refuse"; reason: string; current: unknown };

/** Kun det runneren trenger — implementeres av Admin SDK og av tester. */
export interface PrincipalLinkDb {
  get(path: string): Promise<unknown>;
  set(path: string, value: unknown): Promise<void>;
}

export function planPrincipalLink(
  req: PrincipalLinkRequest,
  current: unknown,
  isMember: boolean,
): PrincipalLinkPlan {
  if (!req.idpSub.trim() || req.idpSub !== req.idpSub.trim()) {
    return { action: "refuse", reason: "idpSub er tom eller har mellomrom i kantene.", current };
  }
  if (!req.firebaseUid.trim() || req.firebaseUid !== req.firebaseUid.trim()) {
    return {
      action: "refuse",
      reason: "firebaseUid er tom eller har mellomrom i kantene.",
      current,
    };
  }
  try {
    assertSafeFamilyId(req.familyId);
  } catch {
    return { action: "refuse", reason: `Ugyldig familyId «${req.familyId}».`, current };
  }
  // Deaktivering skal alltid kunne gjøres, også etter at medlemskapet er borte.
  if (!req.disable && !isMember) {
    return {
      action: "refuse",
      reason: `families/${req.familyId}/members/${req.firebaseUid} finnes ikke — koble kun eksisterende medlemmer.`,
      current,
    };
  }

  const path = principalPath(req.idpSub);
  const next: PrincipalLink = {
    firebaseUid: req.firebaseUid,
    familyId: req.familyId,
    ...(req.disable ? { disabled: true } : {}),
  };
  if (current === null || current === undefined) {
    return req.disable
      ? { action: "refuse", reason: "Ingen kobling å deaktivere.", current }
      : { action: "create", path, next, current };
  }
  const cur = current as Partial<PrincipalLink>;
  const samePerson = cur.firebaseUid === req.firebaseUid && cur.familyId === req.familyId;
  if (!samePerson && !req.replace) {
    return {
      action: "refuse",
      reason:
        `Koblingen peker allerede til ${String(cur.firebaseUid)} i ${String(cur.familyId)}. ` +
        "Bruk --replace bare hvis det er meningen.",
      current,
    };
  }
  if (samePerson && (cur.disabled === true) === (req.disable === true)) {
    return { action: "unchanged", path, current };
  }
  return { action: "update", path, next, current };
}

export async function runPrincipalLink(
  db: PrincipalLinkDb,
  req: PrincipalLinkRequest,
  apply: boolean,
): Promise<PrincipalLinkPlan & { applied: boolean }> {
  const [current, member] = await Promise.all([
    db.get(principalPath(req.idpSub)),
    req.familyId && /^[A-Za-z0-9_-]{1,128}$/.test(req.familyId) && req.firebaseUid.trim()
      ? db.get(memberPath(req.familyId, req.firebaseUid))
      : Promise.resolve(null),
  ]);
  const plan = planPrincipalLink(req, current, member !== null && member !== false);
  if (apply && (plan.action === "create" || plan.action === "update")) {
    await db.set(plan.path, plan.next);
    return { ...plan, applied: true };
  }
  return { ...plan, applied: false };
}
