// Serverer KUN den uendrede legacy-`index.html` fra repo-roten på 127.0.0.1:4180
// (en ekte opprinnelse — en Playwright-fulfilled side fikk aldri svar fra emulatoren).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const fil = path.resolve(import.meta.dirname, "../../index.html");
createServer(async (req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(await readFile(fil));
}).listen(4180, "127.0.0.1");
