/**
 * Datalag for autentisering. Samme prinsipp som resten av src/data/**:
 * eneste sted som kaller Firebase Auth SDK-et direkte — ingen andre
 * filer skal importere `firebase/auth`, ei heller for typer.
 */
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import type { AuthUser } from "@app-types/auth";

export function subscribeAuthUser(onChange: (user: AuthUser | null) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), (user) => {
    onChange(user ? { uid: user.uid, email: user.email, displayName: user.displayName } : null);
  });
}

export async function login(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export async function logout(): Promise<void> {
  await signOut(getFirebaseAuth());
}

/**
 * Lokal identitet for én innlogging (Mat #20, review 5969643874). Hver
 * `currentUser`-instans får sin egen: en utlogging og ny innlogging gir et nytt
 * objekt og dermed en ny sesjon, også med samme uid. En vanlig tokenfornyelse
 * beholder objektet og sesjonen. Verdien forlater aldri nettleseren.
 */
const sesjoner = new WeakMap<object, string>();
let nesteSesjon = 0;

/** Sesjonen til et innloggings-objekt (se over). Brukes av datalaget for å binde et forsøk. */
export function sesjonFor(bruker: object): string {
  let s = sesjoner.get(bruker);
  if (s === undefined) {
    nesteSesjon += 1;
    s = `sesjon-${nesteSesjon}`;
    sesjoner.set(bruker, s);
  }
  return s;
}

/** Sesjonen akkurat nå, eller `null` når ingen er innlogget. */
export function aktivSesjon(): string | null {
  const bruker = getFirebaseAuth().currentUser;
  return bruker ? sesjonFor(bruker) : null;
}

/**
 * Varsler ved enhver endring av innloggingen. `onIdTokenChanged`, ikke
 * `onAuthStateChanged`: den siste varsler bare når uid-en endres, og ville
 * ikke sett en ny innlogging med samme uid.
 */
export function subscribeAuthSesjon(onChange: () => void): () => void {
  return onIdTokenChanged(getFirebaseAuth(), () => onChange());
}
