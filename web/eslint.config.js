// Håndhever modulgrensene fra målarkitekturen mekanisk (ikke bare konvensjon):
//   domain      → ingenting internt (rene funksjoner, ingen React/Firebase)
//   generators  → domain, data, types
//   data        → types (eneste sted som får importere Firebase SDK;
//                 integrasjonstestene får i tillegg domain, se moduleZones)
//   hooks       → data, domain, types, React
//   features    → hooks, components, domain, generators, types
//   components  → domain, types, React (delte UI-atomer, ingen datatilgang)
//
// Et brudd feiler `npm run lint` og dermed CI — grensene er ikke til pynt.
import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const restrictedPath = (target, disallowFrom) => ({
  target: `./src/${target}/**/*`,
  from: disallowFrom.map((zone) => `./src/${zone}/**/*`),
});

// `dataFrom` skilles ut fordi datalagets INTEGRASJONSTESTER (og kun de) får
// importere `domain/`: de står i hookens sted og kobler inn de rene reglene
// datalaget tar som parameter (f.eks. `shoppingMergeRules`), slik at testen
// verifiserer den faktiske regelen appen kjører — ikke en kopi i testen.
const moduleZones = (dataFrom) => [
  restrictedPath("domain", ["generators", "data", "hooks", "features", "components"]),
  restrictedPath("generators", ["hooks", "features", "components"]),
  restrictedPath("data", dataFrom),
  restrictedPath("hooks", ["features", "components"]),
  restrictedPath("components", ["data", "generators", "hooks", "features"]),
];

export default tseslint.config(
  { ignores: ["dist", "coverage", "playwright-report", "test-results"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: { project: ["./tsconfig.app.json", "./tsconfig.integration.json"] },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // ── Motor: domain kjenner ingenting annet i src/ ──────────────
      "import/no-restricted-paths": [
        "error",
        { zones: moduleZones(["domain", "generators", "hooks", "features", "components"]) },
      ],
    },
  },
  {
    files: ["src/data/**/*.integration.test.ts"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        { zones: moduleZones(["generators", "hooks", "features", "components"]) },
      ],
    },
  },
  {
    // Firebase SDK-et skal KUN importeres av datalaget.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/data/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["firebase", "firebase/*"],
              message: "Firebase importeres kun i src/data/** — bruk et repository derfra.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react-dom/*", "react-router-dom"],
              message: "domain/ er rene funksjoner — ingen React-avhengighet.",
            },
          ],
        },
      ],
    },
  },
);
