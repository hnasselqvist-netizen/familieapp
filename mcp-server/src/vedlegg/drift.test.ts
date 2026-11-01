/**
 * Driftsskriptene for vedleggstjenesten (#59 B, R1/R2; 6553344913, review
 * 5729887292), testet mot en FALSK `gcloud` på PATH. Den logger hvert kall,
 * svarer fra en skriptet tilstand med realistiske feiltyper, og AVVISER
 * ukjente flagg per kommando. Ekte gcloud eller Firebase kalles aldri.
 *
 * Låser:
 *  - bootstrap: tørrkjøring som standard; prosjektvern; tretilstands
 *    førtilstand der bare positiv ikke-funnet gir opprettelse, og leseavslag,
 *    tidsavbrudd, deaktivert API og ukjent feil gir STOPP med null mutasjoner;
 *    bøtteeierskap via prosjektets bøtteliste; aldri overtakelse av ukjente
 *    ressurser; bare additiv IAM; stopp ved første feil;
 *  - preflight: bare lesende kall, «ukjent» aldri som «finnes ikke», og U4 og
 *    org-policyer ærlig merket;
 *  - deploy-workflowen: bare manuell, bare main, beskyttet environment,
 *    bekreftelse, ingen IAM- eller Invoker-flagg og ingen emulatorvariabler.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROT = path.resolve(import.meta.dirname, "../../..");
const BOOTSTRAP = path.join(ROT, "infra/gcp/vedlegg-bootstrap.sh");
const PREFLIGHT = path.join(ROT, "infra/gcp/vedlegg-preflight.sh");
const WORKFLOW = path.join(ROT, ".github/workflows/deploy-vedlegg-cloudrun.yml");

const BUCKET = "familieapp-a5d15-kvitteringer";
const RUNTIME_SA = "hverdagsflyt-vedlegg@familieapp-a5d15.iam.gserviceaccount.com";
const DEPLOY_SA = "hverdagsflyt-mcp-deployer@familieapp-a5d15.iam.gserviceaccount.com";

// Tillatte flagg per kommando. Ukjente flagg avvises som av ekte gcloud.
// `--labels` på `storage buckets create` er kildeverifisert av Kontrolltårnet
// (review 5729887292). Øvrige flagg er ikke kildeverifisert fra Claude-økten.
// Se U6 i docs/drift/kvitteringsvedlegg.md.
const FLAGG: Record<string, string[]> = {
  "projects describe": ["format"],
  "projects get-iam-policy": ["flatten", "filter", "format"],
  "projects add-iam-policy-binding": ["member", "role", "condition", "quiet"],
  "services list": ["enabled", "project", "format"],
  "billing projects describe": ["format"],
  "iam service-accounts describe": ["project", "quiet", "format"],
  "iam service-accounts list": ["project", "filter", "format"],
  "iam service-accounts create": ["display-name", "description", "project", "quiet"],
  "iam service-accounts add-iam-policy-binding": ["member", "role", "project", "quiet"],
  "iam workload-identity-pools providers describe": [
    "workload-identity-pool",
    "location",
    "project",
    "format",
  ],
  "artifacts repositories describe": ["location", "project", "quiet", "format"],
  "storage buckets list": ["project", "quiet", "format"],
  "storage buckets describe": ["project", "quiet", "format"],
  "storage buckets create": [
    "location",
    "default-storage-class",
    "uniform-bucket-level-access",
    "public-access-prevention",
    "labels",
    "project",
    "quiet",
  ],
  "storage buckets add-iam-policy-binding": ["member", "role", "project", "quiet"],
  "run services describe": ["region", "project", "quiet", "format"],
  "run deploy": [
    "image",
    "region",
    "service-account",
    "ingress",
    "no-invoker-iam-check",
    "labels",
    "min-instances",
    "max-instances",
    "project",
    "quiet",
  ],
  "run services add-iam-policy-binding": ["region", "member", "role", "project", "quiet"],
  "org-policies describe": ["effective", "project", "format"],
};

const FALSK_GCLOUD = `#!/usr/bin/env node
const fs = require("fs");
const st = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, "utf8"));
const FLAGG = JSON.parse(process.env.FAKE_FLAGG);
// Globale gcloud-flagg som gjelder alle kommandoer.
const GLOBALE = ["project", "quiet", "format", "flatten", "verbosity"];
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(a) + "\\n");
const ut = (s) => { process.stdout.write(s + "\\n"); process.exit(0); };
const feil = (m, k = 1) => { process.stderr.write(m + "\\n"); process.exit(k); };
const pos = a.filter((x) => !x.startsWith("--"));
const nokkel = Object.keys(FLAGG).filter((k) => pos.join(" ").startsWith(k)).sort((x, y) => y.length - x.length)[0];
if (!nokkel) feil("ERROR: (gcloud) Invalid choice: " + pos.join(" "), 2);
for (const f of a.filter((x) => x.startsWith("--"))) {
  const navn = f.slice(2).split("=")[0];
  if (!GLOBALE.includes(navn) && !FLAGG[nokkel].includes(navn)) feil("ERROR: (gcloud." + nokkel.replace(/ /g, ".") + ") unrecognized arguments: " + f, 2);
}
if (st.feilPa && a.join(" ").includes(st.feilPa)) feil("ERROR: injisert feil");
const FEIL = {
  denied: "ERROR: (gcloud) PERMISSION_DENIED: The caller does not have permission (403)",
  timeout: "ERROR: gcloud crashed (ReadTimeout): timed out",
  disabled: "ERROR: (gcloud) SERVICE_DISABLED: API has not been used in project",
  rart: "ERROR: (gcloud) noe helt annet gikk galt",
};
const svarFor = (v, notFound, finnes) => {
  if (v === undefined || v === "notfound") feil(notFound);
  if (typeof v === "string" && FEIL[v]) feil(FEIL[v]);
  ut(finnes(v));
};
const fmt = (a.find((x) => x.startsWith("--format=")) || "").slice(9);
switch (nokkel) {
  case "projects describe": ut(st.prosjektnummer);
  case "services list":
    if (typeof st.apier === "string") feil(FEIL[st.apier]);
    ut((st.apier || ["run.googleapis.com", "storage.googleapis.com"]).join("\\n"));
  case "billing projects describe": ut("True");
  case "iam service-accounts describe":
    svarFor(st.sa[a[3]], "ERROR: (gcloud.iam.service-accounts.describe) NOT_FOUND: Unknown service account", (v) => fmt.includes("description") ? v.description : a[3]);
  case "artifacts repositories describe":
    svarFor(st.arRepo, "ERROR: (gcloud.artifacts.repositories.describe) NOT_FOUND: Repository not found", () => "hverdagsflyt");
  case "iam workload-identity-pools providers describe": ut("familieapp");
  case "storage buckets list":
    if (typeof st.bucketListe === "string") feil(FEIL[st.bucketListe]);
    ut(st.bucket && typeof st.bucket === "object" && st.bucket.eier !== "fremmed" ? "${BUCKET}\\nannen-bøtte" : "annen-bøtte");
  case "storage buckets describe":
    svarFor(st.bucket, "ERROR: (gcloud.storage.buckets.describe) gs://x not found: 404.", (b) =>
      fmt.includes("location") ? [b.location, b.ubla, b.pap, b.merke || ""].join("\\t") : "${BUCKET}");
  case "run services describe":
    if (fmt.includes("urls")) ut("https://hverdagsflyt-vedlegg.invalid");
    svarFor(st.service, "ERROR: (gcloud.run.services.describe) Cannot find service [hverdagsflyt-vedlegg]", (s) => [s.merke || "", s.sa].join("\\t"));
  case "iam service-accounts list":
    if (typeof st.githubAction === "string") feil(FEIL[st.githubAction]);
    ut((st.githubAction || []).join("\\n"));
  case "projects get-iam-policy": ut("roles/firebasehosting.admin");
  case "org-policies describe":
    if (st.orgPolicy) feil(FEIL[st.orgPolicy]);
    ut('{"spec": {}}');
  default: ut("");
}
`;

type Feiltype = "notfound" | "denied" | "timeout" | "disabled" | "rart";
interface Tilstand {
  prosjektnummer: string;
  sa: Record<string, { description: string } | Feiltype>;
  arRepo: object | Feiltype;
  apier?: string[] | Feiltype;
  bucketListe?: Feiltype;
  bucket?:
    | { location: string; ubla: string; pap: string; merke?: string; eier?: "egen" | "fremmed" }
    | Feiltype;
  service?: { merke?: string; sa: string } | Feiltype;
  githubAction?: string[] | Feiltype;
  orgPolicy?: Feiltype;
  feilPa?: string;
}

const tom = (): Tilstand => ({
  prosjektnummer: "1075494790067",
  sa: { [DEPLOY_SA]: { description: "" } },
  arRepo: {},
});
const VAR_BOTTE = {
  location: "EUROPE-WEST1",
  ubla: "True",
  pap: "enforced",
  merke: "hverdagsflyt-vedlegg",
};
const ferdigOppsatt = (): Tilstand => ({
  ...tom(),
  sa: { [DEPLOY_SA]: { description: "" }, [RUNTIME_SA]: { description: "hverdagsflyt-vedlegg" } },
  bucket: { ...VAR_BOTTE },
  service: { merke: "hverdagsflyt-vedlegg", sa: RUNTIME_SA },
});

// Hver test starter bash og mange `node`-prosesser (én per falskt gcloud-kall).
// Under parallell last i full suite gikk 5 s-standarden ut (reprodusert), så
// prosessbaserte tester får et eksplisitt budsjett.
const SPAWN_TIMEOUT = 30_000;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vedlegg-drift-"));
  writeFileSync(path.join(dir, "gcloud"), FALSK_GCLOUD);
  chmodSync(path.join(dir, "gcloud"), 0o755);
  // `sleep` skal aldri trengs (ingen «does not exist» fra den falske gcloud).
  writeFileSync(path.join(dir, "sleep"), "#!/bin/sh\necho 'sleep kalt' >&2; exit 99\n");
  chmodSync(path.join(dir, "sleep"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function kjor(skript: string, st: Tilstand, args: string[] = [], env: Record<string, string> = {}) {
  const state = path.join(dir, "state.json");
  const log = path.join(dir, "log.jsonl");
  writeFileSync(state, JSON.stringify(st));
  writeFileSync(log, "");
  const r = spawnSync("bash", [skript, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_STATE: state,
      FAKE_LOG: log,
      FAKE_FLAGG: JSON.stringify(FLAGG),
      ...env,
    },
  });
  const kall = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as string[]);
  return { status: r.status, ut: r.stdout, feil: r.stderr, kall };
}

const LESENDE = new Set(["describe", "list", "get-iam-policy"]);
const VERB = [
  "describe",
  "list",
  "get-iam-policy",
  "enable",
  "create",
  "deploy",
  "add-iam-policy-binding",
  "set-iam-policy",
  "remove-iam-policy-binding",
  "delete",
  "update",
];
const verb = (k: string[]) => k.find((x) => VERB.includes(x)) ?? `ukjent:${k.join(" ")}`;
const endrende = (kall: string[][]) => kall.filter((k) => !LESENDE.has(verb(k)));
const FORBUDT = ["set-iam-policy", "remove-iam-policy-binding", "delete", "update", "enable"];

describe("den falske gcloud", { timeout: SPAWN_TIMEOUT }, () => {
  it("avviser ukjente flagg, f.eks. --update-labels på storage buckets create", () => {
    const skript = path.join(dir, "x.sh");
    writeFileSync(skript, `gcloud storage buckets create gs://x --update-labels=a=b`);
    const r = kjor(skript, tom());
    expect(r.status).toBe(2);
    expect(r.feil).toMatch(/unrecognized arguments: --update-labels/);
  });
});

describe("vedlegg-bootstrap.sh (falsk gcloud)", { timeout: SPAWN_TIMEOUT }, () => {
  it("tørrkjøring som standard: full endringsliste skrives, men ingen endrende kall", () => {
    const r = kjor(BOOTSTRAP, tom());
    expect(r.status, r.feil).toBe(0);
    expect(endrende(r.kall)).toEqual([]);
    expect(r.ut).toMatch(/Endringsliste \(9 kall/);
    expect(r.ut).toContain(`storage buckets create gs://${BUCKET}`);
    expect(r.ut).toContain("--labels=formaal=hverdagsflyt-vedlegg");
    expect(r.ut).not.toContain("--update-labels");
    expect(r.ut).toMatch(/Tørrkjøring — ingenting er endret/);
  });

  it("--apply på tomt prosjekt: nøyaktig endringslisten, gyldige flagg, bare additiv IAM", () => {
    const r = kjor(BOOTSTRAP, tom(), ["--apply"]);
    expect(r.status, r.feil).toBe(0);
    const e = endrende(r.kall);
    expect(e.map((k) => `${k[0]} ${k[1]} ${verb(k)}`)).toEqual([
      "storage buckets create",
      "iam service-accounts create",
      "storage buckets add-iam-policy-binding",
      "storage buckets add-iam-policy-binding",
      "projects add-iam-policy-binding add-iam-policy-binding",
      "projects add-iam-policy-binding add-iam-policy-binding",
      "iam service-accounts add-iam-policy-binding",
      "run deploy deploy",
      "run services add-iam-policy-binding",
    ]);
    expect(e.flatMap((k) => k.filter((x) => x.startsWith("--role=")))).toEqual([
      "--role=roles/storage.objectCreator",
      "--role=roles/storage.objectViewer",
      "--role=roles/firebasedatabase.viewer",
      "--role=roles/firebaseauth.viewer",
      "--role=roles/iam.serviceAccountUser",
      "--role=roles/run.developer",
    ]);
    const tilDeployer = e.filter((k) => k.includes(`--member=serviceAccount:${DEPLOY_SA}`));
    expect(tilDeployer.map((k) => k.find((x) => x.startsWith("--role=")))).toEqual([
      "--role=roles/iam.serviceAccountUser",
      "--role=roles/run.developer",
    ]);
    expect(e.find((k) => verb(k) === "deploy")).toEqual(
      expect.arrayContaining([
        "--ingress=internal",
        "--no-invoker-iam-check",
        `--service-account=${RUNTIME_SA}`,
        "--labels=formaal=hverdagsflyt-vedlegg",
      ]),
    );
    expect(e.find((k) => k[1] === "buckets" && verb(k) === "create")).toEqual(
      expect.arrayContaining([
        "--location=europe-west1",
        "--uniform-bucket-level-access",
        "--public-access-prevention",
        "--labels=formaal=hverdagsflyt-vedlegg",
      ]),
    );
    expect(r.kall.some((k) => FORBUDT.includes(verb(k)))).toBe(false);
  });

  it("hele førtilstanden leses før første endring", () => {
    const r = kjor(BOOTSTRAP, tom(), ["--apply"]);
    const forsteEndring = r.kall.findIndex((k) => !LESENDE.has(verb(k)));
    const lesingerEtter = r.kall.slice(forsteEndring, -1).filter((k) => LESENDE.has(verb(k)));
    expect(forsteEndring).toBeGreaterThan(0);
    expect(lesingerEtter).toEqual([]); // bare URL-utskriften til slutt
  });

  it("idempotent: alt finnes og er vårt → ingen create/deploy, bare additive bindinger", () => {
    const r = kjor(BOOTSTRAP, ferdigOppsatt(), ["--apply"]);
    expect(r.status, r.feil).toBe(0);
    const e = endrende(r.kall);
    expect(e.some((k) => ["create", "deploy"].includes(verb(k)))).toBe(false);
    expect(e.filter((k) => verb(k) === "add-iam-policy-binding")).toHaveLength(6);
  });

  // Review 5729887292 P1: alt annet enn positiv ikke-funnet skal STOPPE før mutasjon.
  const LESEFEIL: Feiltype[] = ["denied", "timeout", "disabled", "rart"];
  const ukjentFortilstand: [string, Tilstand][] = [
    ...LESEFEIL.map((f): [string, Tilstand] => [
      `bøtte-describe ${f} (reviewens repro)`,
      { ...tom(), bucket: f },
    ]),
    ...LESEFEIL.map((f): [string, Tilstand] => [`bøtteliste ${f}`, { ...tom(), bucketListe: f }]),
    ...LESEFEIL.map((f): [string, Tilstand] => [
      `kjøretidsidentitet ${f}`,
      { ...tom(), sa: { [DEPLOY_SA]: { description: "" }, [RUNTIME_SA]: f } },
    ]),
    ...LESEFEIL.map((f): [string, Tilstand] => [`tjeneste ${f}`, { ...tom(), service: f }]),
    ...LESEFEIL.map((f): [string, Tilstand] => [
      `deployidentitet ${f}`,
      { ...tom(), sa: { [DEPLOY_SA]: f } },
    ]),
    ...LESEFEIL.map((f): [string, Tilstand] => [`AR-repo ${f}`, { ...tom(), arRepo: f }]),
    ...LESEFEIL.map((f): [string, Tilstand] => [`API-liste ${f}`, { ...tom(), apier: f }]),
    ["deployidentitet mangler", { ...tom(), sa: {} }],
    ["AR-repo mangler", { ...tom(), arRepo: "notfound" }],
    ["Cloud Storage-API ikke aktivert", { ...tom(), apier: ["run.googleapis.com"] }],
    ["bøtta finnes i et annet prosjekt", { ...tom(), bucket: { ...VAR_BOTTE, eier: "fremmed" } }],
    ["umerket egen bøtte", { ...tom(), bucket: { ...VAR_BOTTE, merke: undefined } }],
    ["egen bøtte i feil region", { ...ferdigOppsatt(), bucket: { ...VAR_BOTTE, location: "US" } }],
    ["egen bøtte uten PAP", { ...ferdigOppsatt(), bucket: { ...VAR_BOTTE, pap: "inherited" } }],
    ["egen bøtte uten UBLA", { ...ferdigOppsatt(), bucket: { ...VAR_BOTTE, ubla: "False" } }],
    [
      "identitet med annen beskrivelse",
      { ...ferdigOppsatt(), sa: { ...ferdigOppsatt().sa, [RUNTIME_SA]: { description: "annen" } } },
    ],
    ["umerket tjeneste", { ...ferdigOppsatt(), service: { sa: RUNTIME_SA } }],
    [
      "tjeneste med annen identitet",
      { ...ferdigOppsatt(), service: { merke: "hverdagsflyt-vedlegg", sa: "annen@x" } },
    ],
  ];
  it.each(ukjentFortilstand)("STOPP med null mutasjoner: %s", (_navn, st) => {
    const r = kjor(BOOTSTRAP, st, ["--apply"]);
    expect(r.status).not.toBe(0);
    expect(r.feil).toMatch(/STOPP/);
    expect(endrende(r.kall)).toEqual([]);
  });

  it("prosjektavvik eller uleselig prosjekt: stopper etter første kall", () => {
    const r = kjor(BOOTSTRAP, { ...tom(), prosjektnummer: "999" }, ["--apply"]);
    expect(r.status).not.toBe(0);
    expect(r.feil).toMatch(/prosjektnummer '999'/);
    expect(r.kall).toHaveLength(1);
  });

  it("feil i et endrende kall: stopper der, ingen senere kall", () => {
    const r = kjor(BOOTSTRAP, { ...tom(), feilPa: "run deploy" }, ["--apply"]);
    expect(r.status).not.toBe(0);
    expect(r.feil).toMatch(/STOPP: kallet feilet/);
    const e = endrende(r.kall);
    expect(verb(e.at(-1)!)).toBe("deploy");
    expect(e.some((k) => k[0] === "run" && k[1] === "services")).toBe(false);
  });

  it("ukjent argument avvises uten kall, og bøttenavnet kan ikke overstyres", () => {
    const r = kjor(BOOTSTRAP, tom(), ["--force"]);
    expect(r.status).toBe(2);
    expect(r.kall).toEqual([]);
    const o = kjor(BOOTSTRAP, tom(), [], { VEDLEGG_BUCKET: "fremmed-bøtte" });
    expect(o.ut).toContain(`gs://${BUCKET}`);
    expect(o.ut).not.toContain("fremmed-bøtte");
  });
});

describe("vedlegg-preflight.sh (falsk gcloud)", { timeout: SPAWN_TIMEOUT }, () => {
  it("bare lesende kall, også når ressurser finnes eller lesing feiler", () => {
    for (const st of [
      tom(),
      { ...ferdigOppsatt(), githubAction: ["github-action-1@x"] },
      {
        ...tom(),
        bucket: "denied" as const,
        githubAction: "denied" as const,
        orgPolicy: "denied" as const,
      },
    ]) {
      const r = kjor(PREFLIGHT, st);
      expect(r.status, r.feil).toBe(0);
      expect(endrende(r.kall)).toEqual([]);
      expect(r.ut).toMatch(/Ingenting er endret/);
    }
  });

  it("leseavslag rapporteres som UKJENT, aldri som «finnes ikke»", () => {
    const r = kjor(PREFLIGHT, { ...tom(), bucket: "denied", service: "timeout" });
    expect(r.ut).toMatch(
      /bøtte gs:\/\/familieapp-a5d15-kvitteringer\s+UKJENT \(.*PERMISSION_DENIED/,
    );
    expect(r.ut).toMatch(/tjeneste hverdagsflyt-vedlegg\s+UKJENT/);
    const ok = kjor(PREFLIGHT, tom());
    expect(ok.ut).toMatch(/bøtte gs:\/\/familieapp-a5d15-kvitteringer\s+finnes ikke/);
  });

  it("bøtte utenfor prosjektet meldes eksplisitt", () => {
    const r = kjor(PREFLIGHT, { ...tom(), bucket: { ...VAR_BOTTE, eier: "fremmed" } });
    expect(r.ut).toMatch(/FINNES UTENFOR PROSJEKTET/);
  });

  it("U4: én kandidat er ikke bevis; leseavslag er ukjent; oppgitt client_email vises som oppgitt", () => {
    const en = kjor(PREFLIGHT, { ...tom(), githubAction: ["github-action-1@x"] });
    expect(en.ut).toMatch(/1 \(kandidater, IKKE bevist kobling\)/);
    expect(en.ut).toMatch(/U4 UKJENT/);
    const avslag = kjor(PREFLIGHT, { ...tom(), githubAction: "denied" });
    expect(avslag.ut).toMatch(/github-action-\*-kandidater\s+UKJENT \(leseavslag/);
    expect(avslag.ut).toMatch(/U4 UKJENT/);
    const oppgitt = kjor(PREFLIGHT, tom(), [], { HOSTING_SA_EMAIL: "github-action-1@x" });
    expect(oppgitt.ut).toMatch(/oppgitt client_email\s+github-action-1@x \(oppgitt av operatør\)/);
    expect(oppgitt.ut).not.toMatch(/U4 UKJENT/);
  });

  it("U3: effektive org-policyer leses enkeltvis; uleselig er UKJENT, og arv utover er umerket kartlagt", () => {
    const ok = kjor(PREFLIGHT, tom());
    expect(ok.ut).toMatch(/arvede policyer utover disse er ikke kartlagt/);
    const describe = ok.kall.filter((k) => k[0] === "org-policies");
    expect(describe.length).toBeGreaterThanOrEqual(5);
    expect(describe.every((k) => k[1] === "describe" && k.includes("--effective"))).toBe(true);
    const avslag = kjor(PREFLIGHT, { ...tom(), orgPolicy: "denied" });
    expect(avslag.ut).toMatch(/run\.allowedIngress\s+UKJENT/);
  });

  it("feil prosjekt: stopper uten flere kall", () => {
    const r = kjor(PREFLIGHT, { ...tom(), prosjektnummer: "1" });
    expect(r.status).not.toBe(0);
    expect(r.kall).toHaveLength(1);
  });
});

describe("deploy-vedlegg-cloudrun.yml", () => {
  const tekst = readFileSync(WORKFLOW, "utf8");
  const wf = parse(tekst) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: {
      deploy: {
        environment: string;
        env: Record<string, string>;
        steps: { name?: string; run?: string; uses?: string }[];
      };
    };
  };
  const steg = wf.jobs.deploy.steps;
  const kjorTekst = steg.map((s) => s.run ?? "").join("\n");

  it("bare manuell utløsing, bare main, beskyttet environment, eksplisitt bekreftelse", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(wf.jobs.deploy.environment).toBe("mcp-production");
    expect(steg[0]!.run).toContain('"${{ github.ref }}" != "refs/heads/main"');
    expect(kjorTekst).toContain('"$BEKREFT" != "vedlegg-ekte-data"');
  });

  it("ingen IAM- eller Invoker-endring, og bare kjente gcloud-kall", () => {
    for (const forbudt of [
      "allow-unauthenticated",
      "invoker-iam-check",
      "add-iam-policy-binding",
      "set-iam-policy",
      "remove-iam-policy-binding",
      " delete",
    ]) {
      expect(kjorTekst).not.toContain(forbudt);
    }
    const gcloud = [...kjorTekst.matchAll(/gcloud ([a-z-]+ [a-z-]+(?: [a-z-]+)?)/g)].map(
      (m) => m[1],
    );
    expect(new Set(gcloud)).toEqual(
      new Set(["auth configure-docker", "run deploy", "run services describe"]),
    );
  });

  it("ekte lager med eksplisitt opt-in og ingen emulatorvariabler; røyktest før push, skrivefri verifisering etter", () => {
    expect(kjorTekst).toContain('"VEDLEGG_LAGER": "gcs"');
    expect(kjorTekst).toContain('"VEDLEGG_ALLOW_PRODUCTION": "true"');
    expect(wf.jobs.deploy.env.VEDLEGG_BUCKET).toBe(BUCKET);
    expect(tekst).not.toMatch(/EMULATOR_HOST/);
    const navn = steg.map((s) => s.name ?? s.uses ?? "");
    const i = (t: string) => navn.findIndex((n) => n.includes(t));
    expect(i("Røyktest")).toBeGreaterThan(i("Bygg image"));
    expect(i("Push")).toBeGreaterThan(i("Røyktest"));
    expect(i("Verifiser")).toBeGreaterThan(i("Deploy til Cloud Run"));
    expect(kjorTekst).toContain("smoke-vedlegg-container.sh");
    expect(kjorTekst).toContain("verify-vedlegg-deployed.sh");
  });
});
