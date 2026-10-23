/**
 * Kjører den UENDREDE legacy-appen (`index.html` i repo-roten) mot Firebase
 * Emulator Suite — aldri mot produksjon. Brukt som reviewbart bevis for
 * overgangsplanen i `docs/beslutninger/0003-handleliste-en-aktiv-skriver.md`.
 *
 * Slik holdes legacy unna produksjon uten å endre filen:
 *  - `index.html` serveres uendret av `server.mjs`; CDN-skriptene via
 *    Playwright-ruter fra låste npm-kopier i `e2e-legacy/cdn/` (samme
 *    versjoner som `index.html` peker på). Ingenting hentes fra nettet.
 *  - Etter `firebase-database-compat.js` legges en liten innpakning av
 *    `firebase.initializeApp` til: legacy-konfigen byttes mot et
 *    `demo-`-prosjekt, og auth/database kobles til emulatoren før legacy
 *    selv rekker å bruke dem. Ukjent konfig → kast.
 *  - Alle andre forespørsler avbrytes, og websockets mot Firebase-verter
 *    stenges. Service workere blokkeres i konfigen.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type BrowserContext, type Page, expect } from "@playwright/test";

export const NS = "demo-familieapp-legacy-rtdb";
export const FAM = "families/familie1";
// Ekte loopback-server (server.mjs): fra en annen opprinnelse sperrer Chromium
// kall til emulatoren (Private Network Access), og en Playwright-«fulfilled»
// side fikk aldri svar fra emulatoren.
export const LEGACY_URL = "http://127.0.0.1:4180/";
/** Samme fil med den foreslåtte sperre-diffen anvendt på en midlertidig kopi. */
export const LEGACY_SPERRE_URL = "http://127.0.0.1:4181/";

const REPO = path.resolve(import.meta.dirname, "../..");
const DB = "http://127.0.0.1:9000";
const AUTH = "http://127.0.0.1:9099";

/**
 * CDN-adresser i `index.html` → fil i de LÅSTE kopiene i `e2e-legacy/cdn/`
 * (`package-lock.json` der). `react@18` løses til 18.3.1, siste 18.x.
 * Ingen nettverkshenting: harnessen er reproduserbar uten CDN.
 */
const CDN: Record<string, string> = {
  "https://unpkg.com/react@18/umd/react.production.min.js": "react/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js":
    "react-dom/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone@7.23.10/babel.min.js": "@babel/standalone/babel.min.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js":
    "firebase/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js":
    "firebase/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js":
    "firebase/firebase-database-compat.js",
};
const CDN_DIR = path.resolve(import.meta.dirname, "cdn/node_modules");

const EMULATOR_PATCH = `
;(function(){
  var orig = firebase.initializeApp;
  firebase.initializeApp = function(cfg, name){
    if(!cfg || cfg.projectId !== "familieapp-a5d15") throw new Error("legacy-harness: uventet Firebase-konfig");
    var app = orig.call(firebase, Object.assign({}, cfg, {
      apiKey: "demo-legacy", projectId: "demo-familieapp",
      authDomain: "demo-familieapp.firebaseapp.com",
      databaseURL: "https://${NS}.firebaseio.com"
    }), name);
    app.auth().useEmulator("${AUTH}", { disableWarnings: true });
    app.database().useEmulator("127.0.0.1", 9000);
    window.__legacyHarness = { emulator: true };
    return app;
  };
})();
`;

async function cdnInnhold(url: string): Promise<string> {
  try {
    return await readFile(path.join(CDN_DIR, CDN[url]!), "utf8");
  } catch {
    throw new Error(
      "Legacy-CDN-kopiene mangler: kjør `npm ci --prefix e2e-legacy/cdn --ignore-scripts` i web/.",
    );
  }
}

/** Ruter for hele konteksten. Kalles før første `goto`. */
export async function rutLegacy(context: BrowserContext): Promise<void> {
  await context.routeWebSocket(/firebaseio\.com|firebasedatabase\.app|googleapis\.com/, (ws) =>
    ws.close(),
  );
  // Emulatoren og legacy-serveren avskjæres ikke i det hele tatt.
  const direkte = (u: URL) =>
    u.href.startsWith(DB) ||
    u.href.startsWith(AUTH) ||
    u.href.startsWith(LEGACY_URL) ||
    u.href.startsWith(LEGACY_SPERRE_URL);
  await context.route(
    (u) => !direkte(u),
    async (route) => {
      const url = route.request().url();
      if (url in CDN) {
        let body = await cdnInnhold(url);
        if (url.endsWith("firebase-database-compat.js")) body += EMULATOR_PATCH;
        return route.fulfill({ contentType: "application/javascript", body });
      }
      if (
        url.startsWith("https://accounts.google.com/") ||
        url.startsWith("https://apis.google.com/")
      ) {
        return route.fulfill({ contentType: "application/javascript", body: "" });
      }
      return route.abort();
    },
  );
}

// ── Emulator-REST som «eier» (går utenom rules, bare mot emulatoren) ──
const OWNER = { Authorization: "Bearer owner" };
const dbUrl = (sti: string) => `${DB}/${sti}.json?ns=${NS}`;

export async function settRules(fil: string): Promise<void> {
  const res = await fetch(`${DB}/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: OWNER,
    body: await readFile(path.join(REPO, fil), "utf8"),
  });
  if (!res.ok) throw new Error(`rules: ${res.status} ${await res.text()}`);
}

export async function settData(sti: string, verdi: unknown): Promise<void> {
  const res = await fetch(dbUrl(sti), {
    method: "PUT",
    headers: OWNER,
    body: JSON.stringify(verdi),
  });
  if (!res.ok) throw new Error(`PUT ${sti}: ${res.status}`);
}

export async function lesData(sti: string): Promise<unknown> {
  const res = await fetch(dbUrl(sti), { headers: OWNER });
  return res.json();
}

/** Ny e-post/passord-bruker i auth-emulatoren, lagt inn som medlem. */
export async function nyttMedlem(): Promise<{ email: string; password: string }> {
  const email = `legacy-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = "legacy-passord-123";
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const { localId } = (await res.json()) as { localId: string };
  await settData(`${FAM}/members/${localId}`, true);
  return { email, password };
}

/** Åpner legacy, logger inn og venter på at appen har lastet. Samler sidefeil. */
export async function aapneLegacy(
  page: Page,
  bruker: { email: string; password: string },
  url: string = LEGACY_URL,
): Promise<string[]> {
  const feil: string[] = [];
  page.on("pageerror", (e) => feil.push(e.message));
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => "__legacyHarness" in window)).toBe(true);
  await page.getByPlaceholder("din@epost.no").fill(bruker.email);
  await page.getByPlaceholder("••••••••").fill(bruker.password);
  await page.getByRole("button", { name: "Logg inn" }).click();
  return feil;
}

/** Legacy-SDK-ens egen frakobling: skrivinger køes lokalt til `goOnline`. */
export async function legacyNett(page: Page, tilstand: "goOffline" | "goOnline"): Promise<void> {
  await page.evaluate((t) => {
    const fb = (window as unknown as { firebase: { database(): Record<string, () => void> } })
      .firebase;
    fb.database()[t]!();
  }, tilstand);
}
