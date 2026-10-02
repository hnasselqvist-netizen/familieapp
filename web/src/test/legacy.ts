/**
 * Testhjelper for KARAKTERISERING mot dagens faktiske legacy-kode
 * (§CLAUDE.md: "skriv en karakteriseringstest mot dagens faktiske
 * oppførsel i index.html FØR koden flyttes").
 *
 * Leser repo-rotens `index.html` (read-only — filen endres aldri), skjærer
 * ut navngitte rene funksjoner ved klammeparentes-matching, og evaluerer
 * dem isolert med eksplisitt injiserte avhengigheter (f.eks. en
 * deterministisk `uid`). Testene kan dermed kjøre legacy-funksjonen og
 * TypeScript-porten side om side på samme input — et avvik i porten
 * feiler testen, i stedet for at testen bare beskriver hva vi TROR
 * legacy gjør.
 *
 * Kun for rene funksjoner uten JSX/React/Firebase. En funksjon som ikke
 * finnes (omdøpt/fjernet i legacy) gir en tydelig feil, ikke en stille
 * tom test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const LEGACY_PATH = path.resolve(import.meta.dirname, "../../../index.html");

let cachedSource: string | null = null;
function legacySource(): string {
  if (cachedSource === null) cachedSource = readFileSync(LEGACY_PATH, "utf8");
  return cachedSource;
}

/** Tegn som, når de er siste ikke-blanke tegn, betyr at en `/` starter en regex-literal. */
const REGEX_PRECEDERS = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);

/**
 * Nøkkelord som, når de står rett foran en `/`, betyr at `/` starter en
 * regex-literal (`return /}/.test(x)`), ikke en divisjon (`a / b`).
 */
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** Starter en `/` ved `i` en regex-literal, gitt siste ikke-blanke tegn før den? */
function startsRegex(src: string, i: number, lastSignificant: string): boolean {
  if (lastSignificant === "" || REGEX_PRECEDERS.has(lastSignificant)) return true;
  if (!/[A-Za-z0-9_$]/.test(lastSignificant)) return false;
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j]!)) j--;
  let k = j;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k]!)) k--;
  return REGEX_KEYWORDS.has(src.slice(k + 1, j + 1));
}

/**
 * Indeksen RETT ETTER den klammeparentesen som lukker blokken som åpnes
 * ved `openIdx`. Hopper over strenger, template literals, kommentarer og
 * regex-literals (inkl. tegnklasser), slik at f.eks. `/"/g` eller
 * `"{"` ikke forstyrrer tellingen. Template literals håndteres rekursivt:
 * `${...}` åpner en ny `matchBlock`, så nestede template literals,
 * objektliteraler, regex og kommentarer inne i uttrykket telles korrekt
 * (bevist syntetisk i `legacyExtract.legacy.test.ts`).
 */
export function matchBlock(src: string, openIdx: number): number {
  if (src[openIdx] !== "{") throw new Error(`Forventet '{' ved ${openIdx}`);
  let depth = 0;
  let lastSignificant = "";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (c === "/" && next === "*") {
      i = src.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i, c);
      lastSignificant = c;
      continue;
    }
    if (c === "/" && startsRegex(src, i, lastSignificant)) {
      i = skipRegex(src, i);
      lastSignificant = "/";
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    if (!/\s/.test(c)) lastSignificant = c;
  }
  throw new Error("Ubalansert blokk i legacy-kilden");
}

function skipString(src: string, start: number, quote: string): number {
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (quote === "`" && c === "$" && src[i + 1] === "{") {
      i = matchBlock(src, i + 1) - 1;
      continue;
    }
    if (c === quote) return i;
  }
  throw new Error("Uavsluttet streng i legacy-kilden");
}

function skipRegex(src: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      while (/[a-z]/i.test(src[i + 1] ?? "")) i++;
      return i;
    }
    if (c === "\n") throw new Error("Uavsluttet regex i legacy-kilden");
  }
  throw new Error("Uavsluttet regex i legacy-kilden");
}

function uniqueIndexOf(src: string, needle: string): number {
  const first = src.indexOf(needle);
  if (first === -1) throw new Error(`Fant ikke «${needle.trim()}» i index.html`);
  if (src.indexOf(needle, first + 1) !== -1) {
    throw new Error(`«${needle.trim()}» forekommer flere ganger i index.html — tvetydig uttrekk`);
  }
  return first;
}

/**
 * Finnes `snippet` ordrett i legacy-kilden? For tester som SIMULERER en
 * legacy-skriving (f.eks. `setShopping` sin helnode-skriving) og må feile
 * dersom simuleringen ikke lenger speiler den faktiske koden.
 */
export function legacyContains(snippet: string): boolean {
  return legacySource().includes(snippet);
}

/** Kildeteksten til en toppnivå `function NAVN(...) {...}`. */
export function extractFunction(name: string): string {
  const src = legacySource();
  const start = uniqueIndexOf(src, `\nfunction ${name}(`) + 1;
  const open = src.indexOf("{", src.indexOf(")", start));
  return src.slice(start, matchBlock(src, open));
}

/**
 * Kildeteksten til en (komponent-lokal) `const NAVN = (...) => ...` —
 * blokk-kropp (`=> {...}`) eller uttrykk-kropp avsluttet med `;`.
 */
export function extractConstArrow(name: string): string {
  const src = legacySource();
  const start = uniqueIndexOf(src, `const ${name} = `);
  const arrow = src.indexOf("=>", start);
  let bodyStart = arrow + 2;
  while (/\s/.test(src[bodyStart]!)) bodyStart++;
  if (src[bodyStart] === "{") return `${src.slice(start, matchBlock(src, bodyStart))};`;
  return src.slice(start, src.indexOf(";\n", bodyStart) + 1);
}

/**
 * Uttrykket som starter RETT ETTER `marker` (som må være unik) og slutter
 * ved første `)`, `]`, `}`, `,` eller `;` på dybde 0 — f.eks. updateren i
 * `setRules(prev=>…)` (marker `…setRules(`) eller verdien i en
 * komponent-lokal `const X = …;`. Strenger, template literals,
 * kommentarer og regex hoppes over som i `matchBlock`. For komponent-
 * lokale closures som ikke er egne funksjoner og derfor ikke kan trekkes
 * ut med `extractFunction`/`extractConstArrow`.
 */
export function extractInlineExpression(marker: string): string {
  const src = legacySource();
  const start = uniqueIndexOf(src, marker) + marker.length;
  let depth = 0;
  let lastSignificant = "";
  for (let i = start; i < src.length; i++) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      i = src.indexOf("\n", i);
      continue;
    }
    if (c === "/" && next === "*") {
      i = src.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i, c);
      lastSignificant = c;
      continue;
    }
    if (c === "/" && startsRegex(src, i, lastSignificant)) {
      i = skipRegex(src, i);
      lastSignificant = "/";
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return src.slice(start, i).trim();
      depth--;
    } else if ((c === "," || c === ";") && depth === 0) {
      return src.slice(start, i).trim();
    }
    if (!/\s/.test(c)) lastSignificant = c;
  }
  throw new Error(`Fant ikke slutten på uttrykket etter «${marker.trim()}»`);
}

/** En toppnivå `const NAVN = verdi;` (f.eks. en konstant). */
export function extractConstValue(name: string): string {
  const src = legacySource();
  const start = uniqueIndexOf(src, `\nconst ${name} = `) + 1;
  return src.slice(start, src.indexOf(";", start) + 1);
}

export interface LegacyModuleSpec {
  functions?: string[];
  constArrows?: string[];
  constValues?: string[];
  /** Globale avhengigheter de uttrukne funksjonene refererer til (f.eks. `uid`). */
  globals?: Record<string, unknown>;
}

/**
 * Evaluerer de uttrukne legacy-funksjonene i ett felles skop (slik at de
 * kan kalle hverandre, som i index.html) og returnerer dem ved navn.
 */
export function loadLegacy<
  T extends Record<string, (...args: never[]) => unknown> = Record<
    string,
    (...args: unknown[]) => unknown
  >,
>(spec: LegacyModuleSpec): T {
  const parts = [
    ...(spec.constValues ?? []).map(extractConstValue),
    ...(spec.functions ?? []).map(extractFunction),
    ...(spec.constArrows ?? []).map(extractConstArrow),
  ];
  const names = [
    ...(spec.functions ?? []),
    ...(spec.constArrows ?? []),
    ...(spec.constValues ?? []),
  ];
  const globals = spec.globals ?? {};
  const factory = new Function(
    ...Object.keys(globals),
    `"use strict";\n${parts.join("\n\n")}\nreturn { ${names.join(", ")} };`,
  ) as (...args: unknown[]) => T;
  return factory(...Object.values(globals));
}

/** Deterministisk id-generator — samme sekvens gis til legacy og port i en differensialtest. */
export function idSequence(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
