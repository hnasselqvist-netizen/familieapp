/**
 * Driftsskriptene for vedleggstjenesten (#59 B, R1/R2; 6553344913), testet mot
 * en FALSK `gcloud` på PATH. Den logger hvert kall og svarer fra en skriptet
 * tilstand. Ekte gcloud eller Firebase kalles aldri, og ingenting
 * opprettes noe sted.
 *
 * Låser:
 *  - bootstrap: tørrkjøring som standard (ingen endrende kall), prosjektvern,
 *    at alle førtilstandssjekker kjøres før første endring, idempotens, ingen
 *    overtakelse av ukjente ressurser, stopp ved første feil, bare additiv IAM,
 *    og at Invoker-sjekken bare endres her;
 *  - preflight: bare lesende kall;
 *  - deploy-workflowen: bare manuell, bare main, beskyttet environment,
 *    eksplisitt bekreftelse, ingen IAM- eller Invoker-flagg og ingen
 *    emulatorvariabler.
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

const RUNTIME_SA = "hverdagsflyt-vedlegg@familieapp-a5d15.iam.gserviceaccount.com";
const DEPLOY_SA = "hverdagsflyt-mcp-deployer@familieapp-a5d15.iam.gserviceaccount.com";

const FALSK_GCLOUD = `#!/usr/bin/env node
const fs = require("fs");
const st = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, "utf8"));
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(a) + "\\n");
const fmt = (a.find((x) => x.startsWith("--format=")) || "").slice(9);
const ut = (s) => { process.stdout.write(s + "\\n"); process.exit(0); };
const feil = (m) => { process.stderr.write(m + "\\n"); process.exit(1); };
if (st.feilPa && a.join(" ").includes(st.feilPa)) feil("ERROR: injisert feil");
const [g, h, i] = a;
if (g === "projects" && h === "describe") ut(st.prosjektnummer);
if (g === "iam" && h === "service-accounts" && i === "describe") {
  const sa = st.sa[a[3]];
  if (!sa) feil("NOT_FOUND");
  ut(fmt ? sa.description : "ok");
}
if (g === "iam" && h === "service-accounts" && i === "list") ut((st.githubAction || []).join("\\n"));
if (g === "iam" && h === "workload-identity-pools") ut("ok");
if (g === "artifacts" && i === "describe") st.arRepo ? ut("ok") : feil("NOT_FOUND");
if (g === "storage" && h === "buckets" && i === "describe") {
  const b = st.bucket;
  if (!b) feil("NOT_FOUND");
  ut(fmt ? [b.location, b.ubla, b.pap, b.merke || ""].join("\\t") : "ok");
}
if (g === "run" && h === "services" && i === "describe") {
  const s = st.service;
  if (!s) feil("NOT_FOUND");
  if (fmt.includes("urls")) ut("https://hverdagsflyt-vedlegg.invalid");
  ut(fmt ? [s.merke || "", s.sa].join("\\t") : "ok");
}
if (g === "billing") ut("True");
if (g === "projects" && h === "get-iam-policy") ut("roles/firebasehosting.admin");
if (g === "org-policies") ut("constraints/iam.allowedPolicyMemberDomains");
ut("");
`;

interface Tilstand {
  prosjektnummer: string;
  sa: Record<string, { description: string }>;
  arRepo: boolean;
  bucket?: { location: string; ubla: string; pap: string; merke?: string };
  service?: { merke?: string; sa: string };
  githubAction?: string[];
  feilPa?: string;
}

const tom = (): Tilstand => ({
  prosjektnummer: "1075494790067",
  sa: { [DEPLOY_SA]: { description: "" } },
  arRepo: true,
});
const ferdigOppsatt = (): Tilstand => ({
  ...tom(),
  sa: { [DEPLOY_SA]: { description: "" }, [RUNTIME_SA]: { description: "hverdagsflyt-vedlegg" } },
  bucket: {
    location: "EUROPE-WEST1",
    ubla: "True",
    pap: "enforced",
    merke: "hverdagsflyt-vedlegg",
  },
  service: { merke: "hverdagsflyt-vedlegg", sa: RUNTIME_SA },
});

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

function kjor(skript: string, st: Tilstand, ...args: string[]) {
  const state = path.join(dir, "state.json");
  const log = path.join(dir, "log.jsonl");
  writeFileSync(state, JSON.stringify(st));
  writeFileSync(log, "");
  const r = spawnSync("bash", [skript, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_STATE: state, FAKE_LOG: log },
  });
  const kall = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as string[]);
  return { status: r.status, ut: r.stdout, feil: r.stderr, kall };
}

// Hver test starter bash og mange `node`-prosesser (én per falskt gcloud-kall).
// Under parallell last i full suite gikk 5 s-standarden ut (reprodusert), så
// prosessbaserte tester får et eksplisitt budsjett.
const SPAWN_TIMEOUT = 30_000;

const LESENDE = new Set(["describe", "list", "get-iam-policy"]);
const verb = (k: string[]) =>
  k.find((x) =>
    [
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
    ].includes(x),
  ) ?? `ukjent:${k.join(" ")}`;
const endrende = (kall: string[][]) => kall.filter((k) => !LESENDE.has(verb(k)));
const FORBUDT = ["set-iam-policy", "remove-iam-policy-binding", "delete", "update"];

describe("vedlegg-bootstrap.sh (falsk gcloud)", { timeout: SPAWN_TIMEOUT }, () => {
  it("tørrkjøring som standard: full endringsliste skrives, men ingen endrende kall", () => {
    const r = kjor(BOOTSTRAP, tom());
    expect(r.status).toBe(0);
    expect(endrende(r.kall)).toEqual([]);
    expect(r.ut).toMatch(/Endringsliste \(10 kall/);
    expect(r.ut).toContain("storage buckets create gs://familieapp-a5d15-kvitteringer");
    expect(r.ut).toContain("--no-invoker-iam-check");
    expect(r.ut).toMatch(/Tørrkjøring — ingenting er endret/);
  });

  it("--apply på tomt prosjekt: nøyaktig endringslisten, i rekkefølge, bare additiv IAM", () => {
    const r = kjor(BOOTSTRAP, tom(), "--apply");
    expect(r.status).toBe(0);
    const e = endrende(r.kall);
    expect(e.map((k) => `${k[0]} ${k[1]} ${verb(k)}`)).toEqual([
      "services enable enable",
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
    const roller = e.flatMap((k) => k.filter((x) => x.startsWith("--role=")));
    expect(roller).toEqual([
      "--role=roles/storage.objectCreator",
      "--role=roles/storage.objectViewer",
      "--role=roles/firebasedatabase.viewer",
      "--role=roles/firebaseauth.viewer",
      "--role=roles/iam.serviceAccountUser",
      "--role=roles/run.developer",
    ]);
    // Deployeren får bare actAs på kjøretidsidentiteten og run.developer på tjenesten.
    const tilDeployer = e.filter((k) => k.includes(`--member=serviceAccount:${DEPLOY_SA}`));
    expect(tilDeployer.map((k) => k.find((x) => x.startsWith("--role=")))).toEqual([
      "--role=roles/iam.serviceAccountUser",
      "--role=roles/run.developer",
    ]);
    const deploy = e.find((k) => verb(k) === "deploy")!;
    expect(deploy).toEqual(
      expect.arrayContaining([
        "--ingress=internal",
        "--no-invoker-iam-check",
        `--service-account=${RUNTIME_SA}`,
        "--labels=formaal=hverdagsflyt-vedlegg",
      ]),
    );
    const botte = e.find((k) => k[1] === "buckets" && verb(k) === "create")!;
    expect(botte).toEqual(
      expect.arrayContaining([
        "--location=europe-west1",
        "--uniform-bucket-level-access",
        "--public-access-prevention",
        "--update-labels=formaal=hverdagsflyt-vedlegg",
      ]),
    );
    expect(r.kall.some((k) => FORBUDT.includes(verb(k)))).toBe(false);
  });

  it("alle førtilstandssjekker kjøres før første endring", () => {
    const r = kjor(BOOTSTRAP, tom(), "--apply");
    const forsteEndring = r.kall.findIndex((k) => !LESENDE.has(verb(k)));
    const sisteSjekk = r.kall.findLastIndex(
      (k, i) => LESENDE.has(verb(k)) && i < r.kall.length - 1, // siste kall er URL-utskriften
    );
    expect(forsteEndring).toBeGreaterThan(sisteSjekk);
  });

  it("prosjektavvik: stopper etter første kall, ingen endring", () => {
    const r = kjor(BOOTSTRAP, { ...tom(), prosjektnummer: "999" }, "--apply");
    expect(r.status).not.toBe(0);
    expect(r.feil).toMatch(/prosjektnummer '999'/);
    expect(r.kall).toHaveLength(1);
  });

  it("mangler MCP-oppsettet: stopper før endring", () => {
    for (const st of [
      { ...tom(), sa: {} },
      { ...tom(), arRepo: false },
    ]) {
      const r = kjor(BOOTSTRAP, st, "--apply");
      expect(r.status).not.toBe(0);
      expect(endrende(r.kall)).toEqual([]);
    }
  });

  it("idempotent: alt finnes og er vårt → ingen create/deploy, bare additive bindinger", () => {
    const r = kjor(BOOTSTRAP, ferdigOppsatt(), "--apply");
    expect(r.status).toBe(0);
    const e = endrende(r.kall);
    expect(e.some((k) => ["create", "deploy"].includes(verb(k)))).toBe(false);
    expect(e.filter((k) => verb(k) === "add-iam-policy-binding")).toHaveLength(6);
  });

  it.each<[string, Tilstand]>([
    [
      "umerket bøtte",
      { ...tom(), bucket: { location: "EUROPE-WEST1", ubla: "True", pap: "enforced" } },
    ],
    [
      "bøtte i feil region",
      { ...ferdigOppsatt(), bucket: { ...ferdigOppsatt().bucket!, location: "US" } },
    ],
    [
      "bøtte uten public access prevention",
      { ...ferdigOppsatt(), bucket: { ...ferdigOppsatt().bucket!, pap: "inherited" } },
    ],
    [
      "bøtte uten UBLA",
      { ...ferdigOppsatt(), bucket: { ...ferdigOppsatt().bucket!, ubla: "False" } },
    ],
    [
      "identitet med annen beskrivelse",
      { ...ferdigOppsatt(), sa: { ...ferdigOppsatt().sa, [RUNTIME_SA]: { description: "annen" } } },
    ],
    ["umerket tjeneste", { ...ferdigOppsatt(), service: { sa: RUNTIME_SA } }],
    [
      "tjeneste med annen identitet",
      { ...ferdigOppsatt(), service: { merke: "hverdagsflyt-vedlegg", sa: "annen@x" } },
    ],
  ])("overtar aldri ukjente ressurser: %s → STOPP uten endring", (_navn, st) => {
    const r = kjor(BOOTSTRAP, st, "--apply");
    expect(r.status).not.toBe(0);
    expect(r.feil).toMatch(/STOPP/);
    expect(endrende(r.kall)).toEqual([]);
  });

  it("feil i et endrende kall: stopper der, ingen senere kall", () => {
    const r = kjor(BOOTSTRAP, { ...tom(), feilPa: "run deploy" }, "--apply");
    expect(r.status).not.toBe(0);
    expect(r.feil).toMatch(/STOPP: kallet feilet/);
    const e = endrende(r.kall);
    expect(verb(e.at(-1)!)).toBe("deploy");
    expect(e.some((k) => k[0] === "run" && k[1] === "services")).toBe(false);
  });

  it("ukjent argument avvises uten kall", () => {
    const r = kjor(BOOTSTRAP, tom(), "--force");
    expect(r.status).toBe(2);
    expect(r.kall).toEqual([]);
  });
});

describe("vedlegg-preflight.sh (falsk gcloud)", { timeout: SPAWN_TIMEOUT }, () => {
  it("bare lesende kall, også når ressurser finnes", () => {
    for (const st of [tom(), { ...ferdigOppsatt(), githubAction: ["github-action-1@x"] }]) {
      const r = kjor(PREFLIGHT, st);
      expect(r.status).toBe(0);
      expect(endrende(r.kall)).toEqual([]);
      expect(r.ut).toMatch(/Ingenting er endret/);
    }
  });

  it("melder minste manglende opplysning når Hosting-identiteten ikke er entydig", () => {
    const ingen = kjor(PREFLIGHT, tom());
    expect(ingen.ut).toMatch(/MANGLER: entydig Hosting-deployidentitet/);
    const en = kjor(PREFLIGHT, { ...tom(), githubAction: ["github-action-1@x"] });
    expect(en.ut).not.toMatch(/MANGLER/);
    expect(en.ut).toMatch(/github-action-1@x\s+roles\/firebasehosting\.admin/);
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
