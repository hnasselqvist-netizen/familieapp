/**
 * Firebase Admin-adaptere for `add-member` (`memberAdd.ts`). Deles av CLI-en
 * (`addMember.ts`) og emulatortesten, slik at testen kjører de SAMME
 * adapterne som operatøren bruker. Ren I/O — ingen beslutninger her.
 */
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { Database } from "firebase-admin/database";
import type { AuthDirectory, AuthUserInfo, MemberDb } from "./memberAdd";

export function memberDb(db: Database): MemberDb {
  return {
    get: async (path) => (await db.ref(path).get()).val() as unknown,
    set: (path, value) => db.ref(path).set(value),
    // Ett barn holder: vi trenger bare vite at familien finnes, ikke laste den ned.
    familyExists: async (familyId) =>
      (await db.ref(`families/${familyId}`).orderByKey().limitToFirst(1).get()).exists(),
  };
}

function info(user: UserRecord): AuthUserInfo {
  return {
    uid: user.uid,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    displayName: user.displayName ?? null,
    disabled: user.disabled,
    providers: user.providerData.map((p) => p.providerId),
    createdAt: user.metadata.creationTime || null,
    lastSignInAt: user.metadata.lastSignInTime || null,
  };
}

/** `auth/user-not-found` er «ingen slik bruker»; alle andre feil (tilgang, nett) kastes videre. */
async function lookup(fetch: () => Promise<UserRecord>): Promise<AuthUserInfo | null> {
  try {
    return info(await fetch());
  } catch (err) {
    if ((err as { code?: string }).code === "auth/user-not-found") return null;
    throw err;
  }
}

export function authDirectory(auth: Auth): AuthDirectory {
  return {
    byUid: (uid) => lookup(() => auth.getUser(uid)),
    byEmail: (email) => lookup(() => auth.getUserByEmail(email)),
  };
}
