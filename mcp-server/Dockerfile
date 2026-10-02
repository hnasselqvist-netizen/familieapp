# Container for MCP-serveren (Issue #27). Byggekontekst er REPO-ROTEN, fordi
# bundelen henter delte, rene Handleliste-regler fra web/src/domain (se
# tsconfig.json §paths):
#
#   docker build -f mcp-server/Dockerfile -t hverdagsflyt-mcp .
#
# Ingen hemmeligheter i imaget: JWKS er offentlig, og Firebase Admin SDK-et
# bruker plattformens tjenesteidentitet (ADC). All konfigurasjon kommer fra
# miljøet (src/config.ts) — uten FIREBASE_DATABASE_EMULATOR_HOST eller en
# eksplisitt MCP_ALLOW_PRODUCTION_DATA=true nekter serveren å starte, og
# skriveverktøyet er av med mindre MCP_HANDLELISTE_SKRIVING=aktiv.

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

FROM ${NODE_IMAGE} AS build
WORKDIR /repo/mcp-server
COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY web/src/domain /repo/web/src/domain
COPY web/src/types /repo/web/src/types
COPY mcp-server/tsconfig.json ./
COPY mcp-server/src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY mcp-server/package.json ./
# Ett registeroppslag totalt: produksjonsavhengighetene er de samme, låste
# pakkene som bygget brukte (prunet), ikke en ny løsning.
COPY --from=build /repo/mcp-server/node_modules ./node_modules
COPY --from=build /repo/mcp-server/dist/main.js ./dist/main.js
USER node
EXPOSE 8080
# Exec-form: node er PID 1 og mottar SIGTERM direkte (se main.ts §shutdown).
CMD ["node", "dist/main.js"]
