// Serverer KUN legacy-`index.html` fra repo-roten (en ekte opprinnelse — en
// Playwright-fulfilled side fikk aldri svar fra emulatoren).
//
//   node e2e-legacy/server.mjs                       → uendret fil på :4180
//   node e2e-legacy/server.mjs --port 4181 --diff <fil>
//     → en MIDLERTIDIG kopi med den foreslåtte diffen anvendt (git apply).
//       Repoets index.html endres aldri.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { port: { type: "string", default: "4180" }, diff: { type: "string" } },
});
let fil = path.resolve(import.meta.dirname, "../../index.html");
if (values.diff) {
  const dir = mkdtempSync(path.join(tmpdir(), "legacy-sperre-"));
  copyFileSync(fil, path.join(dir, "index.html"));
  execFileSync("git", ["apply", path.resolve(values.diff)], { cwd: dir, stdio: "inherit" });
  fil = path.join(dir, "index.html");
}
createServer(async (req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(await readFile(fil));
}).listen(Number(values.port), "127.0.0.1");
