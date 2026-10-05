/**
 * Legacy-skrivesperren for R3b-cutover (§Issue #34, ADR 0002) er en
 * FERDIG, men IKKE ANVENDT `index.html`-patch:
 * `docs/arkitektur/r3b-legacy-skrivesperre.patch`. Den anvendes som egen,
 * revertérbar commit i cutover-releasen — med eksplisitt mandat — sammen
 * med at `hooks/forsoningAktivering.ts` slås på.
 *
 * Testen holder patchen ærlig mens den ligger på vent:
 *  - den må gjelde rent mot DAGENS `index.html` (endres setterne i legacy,
 *    feiler testen, og patchen må oppdateres);
 *  - den er rent additiv (bare `+`-linjer), så revert er trivielt;
 *  - anvendt i minnet gjør den de fire sentrale setterne til no-ops: ingen
 *    `dbSet`, ingen lokal endring, promiset løses, og brukeren varsles én
 *    gang per sidelasting;
 *  - et permanent banner (Kontrolltårn-valg 5971209605) vises øverst i
 *    legacy-Forvaltning og RegelSenter, så sperren kan sees uten å forsøke
 *    en skriving;
 *  - uten sperren (flagget av) oppfører setterne seg som i dag, og banneret
 *    rendres ikke.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { extractConstValue, matchBlock } from "../../test/legacy";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const LEGACY = readFileSync(path.join(ROOT, "index.html"), "utf8");
const PATCH = readFileSync(
  path.join(ROOT, "docs/arkitektur/r3b-legacy-skrivesperre.patch"),
  "utf8",
);

const SETTERE = [
  ["setReceipts", "receipts"],
  ["setHendelser", "hendelser"],
  ["setRules", "rules"],
  ["setTransaksjoner", "transaksjoner"],
] as const;

/** Minimal unified-diff-anvender: hver hunk må treffe NØYAKTIG på sin linje. */
function anvendPatch(src: string, patch: string): string {
  const linjer = src.split("\n");
  const hunker = patch.split(/^(?=@@ )/m).slice(1);
  let forskyvning = 0;
  for (const hunk of hunker) {
    const [hode, ...kropp] = hunk.replace(/\n$/, "").split("\n");
    const m = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(hode!);
    if (!m) throw new Error(`Ugyldig hunk-hode: ${hode}`);
    const start = Number(m[1]) - 1 + forskyvning;
    const gamle = kropp.filter((l) => !l.startsWith("+")).map((l) => l.slice(1));
    const nye = kropp.filter((l) => !l.startsWith("-")).map((l) => l.slice(1));
    const faktisk = linjer.slice(start, start + gamle.length);
    if (faktisk.join("\n") !== gamle.join("\n")) {
      throw new Error(`Patchen treffer ikke index.html ved linje ${start + 1}`);
    }
    linjer.splice(start, gamle.length, ...nye);
    forskyvning += nye.length - gamle.length;
  }
  return linjer.join("\n");
}

function uttrekk(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start === -1 || src.indexOf(marker, start + 1) !== -1) {
    throw new Error(`«${marker}» må finnes nøyaktig én gang`);
  }
  const arrow = src.indexOf("=>", start);
  const open = src.indexOf("{", arrow);
  return `${src.slice(start, matchBlock(src, open))});`;
}

/** Evaluerer settere fra `src` med fangede avhengigheter (dbSet, lokal state, alert). */
function lastSettere(src: string, sperre: boolean | null) {
  const dbSet = vi.fn(() => Promise.resolve());
  const alert = vi.fn();
  const warn = vi.fn();
  const lokal: Record<string, unknown[]> = {};
  const env: Record<string, unknown> = {
    dbSet,
    FAM: "families/familie1",
    window: { alert },
    console: { warn },
  };
  for (const [setter] of SETTERE) {
    const navn = `${setter}Local`;
    lokal[navn] = [{ id: "a" }];
    env[navn] = (u: (prev: unknown[]) => unknown[]) => {
      lokal[navn] = u(lokal[navn]!);
    };
  }
  const deler: string[] = [];
  if (sperre !== null) {
    deler.push(`const FORSONING_SKRIVESPERRE = ${sperre};`);
    // Til banneret (JSX, testet for seg under).
    const blokk = src.slice(
      src.indexOf("let forsoningSperreVarslet"),
      src.indexOf("// Permanent banner"),
    );
    deler.push(blokk.replace("const FORSONING_SKRIVESPERRE = true;", ""));
  }
  for (const [setter] of SETTERE) deler.push(uttrekk(src, `const ${setter} = (updater)`));
  const fns = new Function(
    ...Object.keys(env),
    `"use strict";\n${deler.join("\n")}\nreturn { ${SETTERE.map(([s]) => s).join(", ")} };`,
  )(...Object.values(env)) as Record<string, (u: unknown) => Promise<void>>;
  return { fns, dbSet, alert, warn, lokal };
}

const PATCHET = anvendPatch(LEGACY, PATCH);

/** Et JSX-element som et rent tre (domain/ har ingen React-avhengighet). */
interface Node {
  tag: string;
  props: Record<string, unknown> | null;
  children: unknown[];
}

const tekstAv = (n: unknown): string =>
  n === null || n === undefined || typeof n === "boolean"
    ? ""
    : typeof n === "object"
      ? (n as Node).children.map(tekstAv).join("")
      : String(n);

/**
 * Banneret fra den patchede kilden: JSX transpileres som Babel gjør i
 * nettleseren, men med en egen `h`-fabrikk som bygger et rent tre.
 */
function renderBanner(sperre: boolean): Node | null {
  const kilde = PATCHET.slice(
    PATCHET.indexOf("const NY_FORVALTNING_URL"),
    PATCHET.indexOf("const dbListen"),
  );
  const js = ts.transpileModule(`${extractConstValue("P")}\n${kilde}`, {
    compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: "h", target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const h = (tag: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    tag,
    props,
    children,
  });
  const banner = new Function(
    "h",
    "FORSONING_SKRIVESPERRE",
    `"use strict";\n${js}\nreturn ForsoningSperreBanner;`,
  )(h, sperre) as () => Node | null;
  return banner();
}

describe("R3b legacy-skrivesperre (patch, ikke anvendt)", () => {
  it("er ikke anvendt i dag, men gjelder rent mot dagens index.html", () => {
    expect(LEGACY).not.toContain("FORSONING_SKRIVESPERRE");
    expect(PATCHET).toContain("const FORSONING_SKRIVESPERRE = true;");
  });

  it("er rent additiv: ingen fjernede linjer, bare sperreblokken og én vakt per setter", () => {
    const endret = PATCH.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
    expect(endret.filter((l) => l.startsWith("-"))).toEqual([]);
    const vakter = endret.filter((l) => l.includes("if(FORSONING_SKRIVESPERRE)"));
    expect(vakter).toHaveLength(4);
    for (const [setter, node] of SETTERE) {
      expect(PATCHET).toMatch(
        new RegExp(
          `const ${setter} = \\(updater\\) => new Promise\\(\\(resolve\\) => \\{\\n    if\\(FORSONING_SKRIVESPERRE\\) \\{ varsleForsoningSperret\\("${node}"\\); resolve\\(\\); return; \\}`,
        ),
      );
    }
  });

  it("sperret: ingen dbSet, ingen lokal endring, promiset løses, ett varsel per sidelasting", async () => {
    const { fns, dbSet, alert, warn, lokal } = lastSettere(PATCHET, true);
    for (const [setter] of SETTERE) {
      await expect(
        fns[setter]!((prev: unknown[]) => [...prev, { id: "ny" }]),
      ).resolves.toBeUndefined();
      await fns[setter]!([{ id: "ferdig-array" }]);
    }
    expect(dbSet).not.toHaveBeenCalled();
    for (const [setter] of SETTERE) expect(lokal[`${setter}Local`]).toEqual([{ id: "a" }]);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(8);
    expect(warn.mock.calls.map((c) => /til (\w+) er sperret/.exec(String(c[0]))![1])).toEqual(
      SETTERE.flatMap(([, node]) => [node, node]),
    );
  });

  it("flagget av: setterne skriver nøyaktig som dagens legacy", async () => {
    const patchetAv = lastSettere(PATCHET, false);
    const dagens = lastSettere(LEGACY, null);
    for (const k of [patchetAv, dagens]) {
      for (const [setter] of SETTERE) {
        await k.fns[setter]!((prev: unknown[]) => [...prev, { id: "ny" }]);
      }
    }
    expect(patchetAv.dbSet.mock.calls).toEqual(dagens.dbSet.mock.calls);
    expect(patchetAv.dbSet.mock.calls.map((c) => (c as unknown[])[0])).toEqual(
      SETTERE.map(([, node]) => `families/familie1/${node}`),
    );
    expect(patchetAv.lokal).toEqual(dagens.lokal);
    expect(patchetAv.alert).not.toHaveBeenCalled();
  });

  it("banneret: vises med sperren, rendres ikke uten", () => {
    const sperret = renderBanner(true)!;
    expect(sperret.tag).toBe("div");
    expect(sperret.props).toMatchObject({ role: "status" });
    const tekst = tekstAv(sperret);
    expect(tekst).toContain("Bankimport, kvitteringer og regler er flyttet til den nye appen.");
    expect(tekst).toContain("endringer lagres ikke");
    const lenke = sperret.children.find((c) => (c as Node)?.tag === "a") as Node;
    expect(lenke.props).toMatchObject({ href: "https://familieapp-a5d15.web.app/forvaltning" });
    expect(tekstAv(lenke)).toBe("Åpne Forvaltning i den nye appen →");
    expect(renderBanner(false)).toBeNull();
  });

  it("banneret står øverst i legacy-Forvaltning og RegelSenter, og ingen andre steder", () => {
    const steder = [...PATCHET.matchAll(/<ForsoningSperreBanner\/>/g)].map((m) => m.index!);
    expect(steder).toHaveLength(2);
    const forvaltning = PATCHET.indexOf("function ForvaltningScreen(");
    const regelsenter = PATCHET.indexOf("function RegelSenter(");
    // Første element i ForvaltningScreen sin hoved-return, før fanelinjen.
    expect(PATCHET.slice(forvaltning, steder[0])).toMatch(/\n {2}return \(\n {4}<div>\n {6}$/);
    expect(steder[0]).toBeLessThan(PATCHET.indexOf("{/* Intern tab-bar */}", forvaltning));
    // Første element i RegelSenter sitt faste innhold (vises både mobil og desktop).
    expect(steder[1]).toBeGreaterThan(regelsenter);
    expect(PATCHET.slice(regelsenter, steder[1])).toMatch(
      /\n {2}const fastInnhold = \(\n {4}<>\n {6}$/,
    );
  });

  it("de fire setterne er de ENESTE legacy-skriverne av nodene (ingen andre dbSet-stier)", () => {
    const stier = [...LEGACY.matchAll(/dbSet\(`\$\{FAM\}\/(\w+)`/g)].map((m) => m[1]);
    for (const [, node] of SETTERE) expect(stier.filter((s) => s === node)).toHaveLength(1);
    expect(LEGACY).not.toMatch(/_db\.ref\(`\$\{FAM\}\/(transaksjoner|hendelser|receipts|rules)/);
  });
});
