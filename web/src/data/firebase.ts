/**
 * Eneste fil i hele appen som initialiserer Firebase SDK-et.
 * Alt annet som trenger databasen går via et repository i src/data/**
 * — se f.eks. freezer.repository.ts — aldri direkte mot `firebase/*`
 * (håndhevet av eslint.config.js).
 *
 * Miljøstyrt: VITE_FIREBASE_USE_EMULATOR=true kobler til lokal
 * Firebase Emulator Suite i stedet for det ekte prosjektet — brukt av
 * `npm run dev` under lokal utvikling og av alle automatiserte tester.
 * Automatiserte tester skal ALDRI kunne nå produksjon eller en
 * Hosting-forhåndsvisning (§arkitekturbeslutning: preview vs.
 * produksjonsdata).
 */
import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, connectAuthEmulator, getAuth } from "firebase/auth";
import { connectDatabaseEmulator, type Database, getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let database: Database | undefined;

function shouldUseEmulator(): boolean {
  return import.meta.env.VITE_FIREBASE_USE_EMULATOR === "true";
}

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
    if (shouldUseEmulator()) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    }
  }
  return auth;
}

export function getFirebaseDatabase(): Database {
  if (!database) {
    database = getDatabase(getFirebaseApp());
    if (shouldUseEmulator()) {
      connectDatabaseEmulator(database, "127.0.0.1", 9000);
    }
  }
  return database;
}

/**
 * REST-URL for en databasesti (`families/.../shopping`), for versjonsbetingede
 * skrivinger med ETag (Firebase REST, `X-Firebase-ETag`/`if-match`) som
 * SDK-et ikke tilbyr. Bare HTTPS, eller den lokale emulatoren når
 * emulatoren er slått på — aldri noe annet.
 */
export function databaseRestUrl(sti: string): URL {
  const base = new URL(firebaseConfig.databaseURL ?? "");
  const lokal = base.protocol === "http:" && base.hostname === "127.0.0.1";
  if (!(base.protocol === "https:" || (shouldUseEmulator() && lokal))) {
    throw new Error("Ugyldig database-URL for REST.");
  }
  base.pathname = `/${sti.split("/").map(encodeURIComponent).join("/")}.json`;
  return base;
}
