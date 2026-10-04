/**
 * Oppretter ETT medlemskap `families/{familyId}/members/{uid}` = `true`
 * (Issue #27, Kontrolltårn-beslutning 5983011174). Samme mønster som
 * `principalLink.ts`: ren planlegging (`planAddMember`) + en tynn utfører
 * over små porter, så logikken testes mot in-memory og mot emulatoren.
 *
 * Hvorfor finnes den: MCP-serveren krever medlemskap (`auth/authorize.ts`),
 * og `link-principal` nekter bevisst å lage det. Medlemsnoden har ingen
 * effekt for appen før de medlemsbaserte reglene deployes (ADR 0001), så
 * den kan mangle i produksjon.
 *
 * Sikkerhetsegenskaper (alle testet):
 *  - Tørrkjøring er standard; `--apply` skriver nøyaktig én node, med verdi `true`.
 *  - Familien må finnes. Kommandoen oppretter aldri en ny familie (en
 *    skrivefeil i `--family` gir avslag, ikke en «spøkelsesfamilie»).
 *  - Firebase Auth-brukeren må finnes og være aktiv. Operatøren oppgir
 *    e-post (eller UID), og svaret viser identiteten (e-post, navn,
 *    leverandører, opprettet/sist innlogget), så riktig bruker kan
 *    bekreftes uten å kopiere en UID fra konsollen.
 *  - Oppslaget må gi nøyaktig den e-posten/UID-en som ble bedt om.
 *  - `--expect-uid` fester resultatet til en UID operatøren allerede har sett.
 *  - Et eksisterende medlemskap røres aldri; en eksplisitt `false` (tilgang
 *    trukket tilbake) overskrives heller aldri.
 *  - Medlemskap og principal-kobling er separate steg (`link-principal`).
 */
import { assertSafeFamilyId, memberPath } from "../store/paths";

/** Det operatøren trenger for å bekrefte at det er riktig bruker. */
export interface AuthUserInfo {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  disabled: boolean;
  /** Innloggingsleverandører, f.eks. `password`, `google.com`. */
  providers: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AddMemberRequest {
  familyId: string;
  /** Nøyaktig én av `uid` og `email`. */
  uid?: string;
  email?: string;
  /** Avslå hvis oppslaget ikke gir denne UID-en. */
  expectUid?: string;
}

/** Kun det utføreren trenger av databasen. */
export interface MemberDb {
  get(path: string): Promise<unknown>;
  set(path: string, value: unknown): Promise<void>;
  /** Finnes `families/{familyId}` med minst ett barn? */
  familyExists(familyId: string): Promise<boolean>;
}

/** Oppslag i Firebase Auth. `null` = ingen slik bruker. */
export interface AuthDirectory {
  byUid(uid: string): Promise<AuthUserInfo | null>;
  byEmail(email: string): Promise<AuthUserInfo | null>;
}

export interface MemberFacts {
  user: AuthUserInfo | null;
  familyExists: boolean;
  /** Rå verdi av `families/{f}/members/{uid}`. */
  current: unknown;
}

export type AddMemberPlan =
  | { action: "create"; path: string; next: true; user: AuthUserInfo; current: unknown }
  | { action: "unchanged"; path: string; user: AuthUserInfo; current: unknown }
  | { action: "refuse"; reason: string; user?: AuthUserInfo; current?: unknown };

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Input-validering uten I/O. Returnerer et avslagsgrunn, eller `null`. */
export function validateAddMember(req: AddMemberRequest): string | null {
  try {
    assertSafeFamilyId(req.familyId);
  } catch {
    return `Ugyldig familyId «${req.familyId}».`;
  }
  const hasUid = req.uid !== undefined;
  const hasEmail = req.email !== undefined;
  if (hasUid && hasEmail) return "Oppgi enten --email eller --uid, ikke begge.";
  if (!hasUid && !hasEmail) return "Oppgi --email (anbefalt) eller --uid.";
  if (req.email !== undefined) {
    if (req.email !== req.email.trim()) return "e-post har mellomrom i kantene.";
    if (req.email.length > 254 || !EMAIL.test(req.email)) return "e-post har ugyldig form.";
  }
  if (req.uid !== undefined && !SAFE_ID.test(req.uid)) {
    return "uid har ugyldig form (bokstaver, tall, - og _, maks 128 tegn).";
  }
  if (req.expectUid !== undefined && !SAFE_ID.test(req.expectUid)) {
    return "expect-uid har ugyldig form.";
  }
  return null;
}

export function planAddMember(req: AddMemberRequest, facts: MemberFacts): AddMemberPlan {
  const invalid = validateAddMember(req);
  if (invalid) return { action: "refuse", reason: invalid };

  const { user } = facts;
  if (!user) {
    return {
      action: "refuse",
      reason: `Fant ingen Firebase Auth-bruker med ${req.email !== undefined ? `e-post ${req.email}` : `uid ${req.uid}`}.`,
    };
  }
  // Forsvar i dybden: oppslaget skal gi nøyaktig det som ble bedt om.
  if (req.email !== undefined && user.email?.toLowerCase() !== req.email.toLowerCase()) {
    return {
      action: "refuse",
      reason: `Oppslaget ga en bruker med e-post ${String(user.email)}, ikke ${req.email}.`,
      user,
    };
  }
  if (req.uid !== undefined && user.uid !== req.uid) {
    return { action: "refuse", reason: `Oppslaget ga uid ${user.uid}, ikke ${req.uid}.`, user };
  }
  if (req.expectUid !== undefined && user.uid !== req.expectUid) {
    return {
      action: "refuse",
      reason: `Brukeren har uid ${user.uid}, men --expect-uid var ${req.expectUid}.`,
      user,
    };
  }
  if (user.disabled) {
    return { action: "refuse", reason: "Firebase-brukeren er deaktivert.", user };
  }
  if (!facts.familyExists) {
    return {
      action: "refuse",
      reason: `families/${req.familyId} finnes ikke. Oppretter aldri en ny familie.`,
      user,
    };
  }

  const path = memberPath(req.familyId, user.uid);
  if (facts.current === false) {
    return {
      action: "refuse",
      reason:
        `${path} er satt til false (tilgangen er trukket tilbake). ` +
        "Skriver ikke over uten en bevisst beslutning.",
      user,
      current: facts.current,
    };
  }
  // Samme regel som `isFamilyMember`: alt annet enn null/false er medlemskap.
  if (facts.current !== null && facts.current !== undefined) {
    return { action: "unchanged", path, user, current: facts.current };
  }
  return { action: "create", path, next: true, user, current: facts.current };
}

export async function runAddMember(
  db: MemberDb,
  auth: AuthDirectory,
  req: AddMemberRequest,
  apply: boolean,
): Promise<AddMemberPlan & { applied: boolean }> {
  // Ingen I/O før input er gyldig.
  const invalid = validateAddMember(req);
  if (invalid) return { action: "refuse", reason: invalid, applied: false };

  const user =
    req.email !== undefined ? await auth.byEmail(req.email) : await auth.byUid(req.uid as string);
  if (!user)
    return { ...planAddMember(req, { user, familyExists: false, current: null }), applied: false };

  const [familyExists, current] = await Promise.all([
    db.familyExists(req.familyId),
    db.get(memberPath(req.familyId, user.uid)),
  ]);
  const plan = planAddMember(req, { user, familyExists, current });
  if (apply && plan.action === "create") {
    await db.set(plan.path, plan.next);
    return { ...plan, applied: true };
  }
  return { ...plan, applied: false };
}

/**
 * Prosjekt-ID for Auth-oppslaget mot ekte prosjekt. Utledes fra databasens
 * URL (`https://{prosjekt}-default-rtdb.{region}.firebasedatabase.app`) og
 * må stemme med `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT` hvis den er satt, så
 * Auth aldri slår opp i et annet prosjekt enn databasen tilhører.
 */
export function resolveProjectId(
  databaseUrl: string,
  envProject: string | undefined,
): { projectId: string } | { error: string } {
  const fromUrl = /^https:\/\/([a-z0-9-]+?)-default-rtdb\./.exec(databaseUrl)?.[1];
  if (envProject && fromUrl && envProject !== fromUrl) {
    return {
      error:
        `Prosjekt-ID ${envProject} (GOOGLE_CLOUD_PROJECT) stemmer ikke med databasen ${fromUrl}. ` +
        "Auth-oppslaget ville gått mot feil prosjekt.",
    };
  }
  const projectId = fromUrl ?? envProject;
  return projectId
    ? { projectId }
    : { error: "Kunne ikke fastslå prosjekt-ID. Sett GOOGLE_CLOUD_PROJECT." };
}
