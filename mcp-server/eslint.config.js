// Modulgrenser for MCP-serveren (speiler web/eslint.config.js sin ånd):
//   handleliste/ → rene regler + tjenestelogikk; kjenner kun store-PORTEN
//                  (store/types.ts), aldri Firebase, HTTP eller MCP-SDK-et.
//   auth/        → tokenvalidering + autorisasjon; ingen Firebase/HTTP.
//   store/firebaseAdminStore.ts og main.ts → eneste steder som får
//                  importere firebase-admin.
//   @domain/*    → kun web/ sine rene Handleliste-regler og konstanter.
//   @generators/* → kun i tester (paritet mot appens rene referanse).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const firebaseAdmin = {
  group: ["firebase-admin", "firebase-admin/*", "firebase", "firebase/*"],
  message: "firebase-admin importeres kun i src/store/firebaseAdminStore.ts og src/main.ts.",
};
const transportLayers = {
  group: ["@modelcontextprotocol/*", "node:http", "**/http/*", "**/mcp/*"],
  message: "handleliste/ og auth/ er transport-uavhengige — ingen MCP-SDK/HTTP her.",
};
const sharedDomain = {
  regex: "^(@domain/(?!shopping/|shared/)|@generators/)",
  message: "MCP-serveren deler kun domain/shopping og domain/shared med web/.",
};
const noRelativeWeb = {
  group: ["**/web/**"],
  message: "Del kode med web/ kun via @domain/* og @app-types/* (aldri web/ sitt datalag).",
};

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,js}"],
    languageOptions: { ecmaVersion: 2023, globals: globals.node },
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [firebaseAdmin, sharedDomain, noRelativeWeb] },
      ],
    },
  },
  {
    files: ["src/handleliste/**/*.ts", "src/auth/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [firebaseAdmin, transportLayers, sharedDomain, noRelativeWeb] },
      ],
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [firebaseAdmin, noRelativeWeb] }],
    },
  },
  {
    files: ["src/store/firebaseAdminStore.ts", "src/main.ts", "src/**/*.integration.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [sharedDomain, noRelativeWeb] }],
    },
  },
);
