/**
 * Datalag for autentisering. Samme prinsipp som resten av src/data/**:
 * eneste sted som kaller Firebase Auth SDK-et direkte — ingen andre
 * filer skal importere `firebase/auth`, ei heller for typer.
 */
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import type { AuthUser } from "@app-types/auth";

export function subscribeAuthUser(onChange: (user: AuthUser | null) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), (user) => {
    onChange(user ? { uid: user.uid, email: user.email } : null);
  });
}

export async function login(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export async function logout(): Promise<void> {
  await signOut(getFirebaseAuth());
}
