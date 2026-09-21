/**
 * Midlertidig, fullstendig isolert MCP-testflate.
 *
 * Formål (Issue #27, kommentar 5761279861): avgjøre EMPIRISK om Helens
 * faktiske ChatGPT Plus-konto tilbyr/kjører skrivehandlinger via en
 * tilkoblet MCP-server i Developer Mode — ikke bygge noe Hverdagsflyt
 * skal beholde. Denne filen importerer bevisst ALDRI `firebase-admin`
 * eller noe Hverdagsflyt-domenekode, og rører ingen Firebase-node.
 *
 * To verktøy:
 * - `test_read` (readOnlyHint: true) — returnerer en statisk testverdi.
 *   Krever ingen bekreftelse i ChatGPT.
 * - `test_write` — lagrer en tekstnotis i en variabel i prosessminnet
 *   (IKKE i Firebase, IKKE persistent på tvers av kalde starter). Formålet
 *   er kun å se om ChatGPT faktisk TILBYR og KJØRER verktøyet — ikke å
 *   bevise ekte persistens.
 *
 * Autentisering: enkel delt hemmelighet i query-strengen (`?k=`), lest
 * fra `MCP_TEST_SECRET` i kjøretidsmiljøet. Verdien genereres og settes
 * KUN ved deploy-tidspunktet via `.github/workflows/deploy-mcp-test.yml`
 * sin `workflow_dispatch`-input — den committes ALDRI til repoet (som er
 * offentlig) og logges ikke. Dette er en bevisst forenkling for en
 * engangstest, IKKE mønsteret for den faktiske Hverdagsflyt-
 * integrasjonen (se arkitekturforslaget i Issue #27) — men gir
 * endepunktet reell tilgangskontroll fremfor å stå helt åpent, selv om
 * konsekvensen av at hemmeligheten skulle lekke er ufarlig (verktøyene
 * gjør uansett ingenting utover å returnere en fast streng eller lagre
 * en kort tekst i midlertidig prosessminne).
 *
 * Opprydding: slett `mcp-test-harness/`-mappen, `functions`-blokken i
 * repo-rotens `firebase.json`, `.github/workflows/deploy-mcp-test.yml`,
 * og kjør `firebase functions:delete mcpTestHarness --project <prosjekt>`
 * når testen er ferdig.
 */
const { onRequest } = require("firebase-functions/v2/https");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

let lastWrittenNote = null;

function buildServer() {
  const server = new McpServer({ name: "hverdagsflyt-mcp-test", version: "0.1.0" });

  server.registerTool(
    "test_read",
    {
      title: "Testlesing",
      description:
        "Returnerer en statisk testverdi. Ingen tilgang til Hverdagsflyt-data noe sted.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            value: "hverdagsflyt-mcp-test-ok",
            checkedAt: new Date().toISOString(),
          }),
        },
      ],
    }),
  );

  server.registerTool(
    "test_write",
    {
      title: "Testskriving",
      description:
        "Lagrer en kort tekstnotis i isolert minnetilstand for DENNE testen. Ingen Hverdagsflyt-data eller Firebase-node berøres — notisen forsvinner ved neste kalde start.",
      inputSchema: { note: z.string().min(1).max(200) },
    },
    async ({ note }) => {
      lastWrittenNote = { note, savedAt: new Date().toISOString() };
      return {
        content: [
          {
            type: "text",
            text: `Lagret testnotis i minnet: "${note}" (${lastWrittenNote.savedAt})`,
          },
        ],
      };
    },
  );

  return server;
}

exports.mcpTestHarness = onRequest({ cors: true }, async (req, res) => {
  const expectedKey = process.env.MCP_TEST_SECRET;
  if (!expectedKey || req.query.k !== expectedKey) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
