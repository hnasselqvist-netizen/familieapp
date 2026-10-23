import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { tracks } from "../../web/public/utviklingskart/tracks.mjs";

// Bruker repoets eksisterende Playwright, ingen ny avhengighet eller Firebase.
const require = createRequire(
  new URL("../../web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const files = new Set([
  "index.html",
  "styles.css",
  "app.mjs",
  "model.mjs",
  "tracks.mjs",
  "github.mjs",
]);
const fixture = process.env.MAP_FIXTURE
  ? JSON.parse(await readFile(process.env.MAP_FIXTURE, "utf8"))
  : {
      issues: tracks.map((track) => ({
        number: track.issue,
        title: track.name,
        state: "open",
      })),
      pulls: [
        {
          number: 100,
          title: "Forvaltning R1",
          state: "open",
          draft: true,
          updated_at: "2026-10-03T12:00:00Z",
          html_url:
            "https://github.com/hnasselqvist-netizen/familieapp/pull/100",
        },
      ],
      comments: {},
    };
const server = createServer(async (request, response) => {
  const file =
    request.url === "/utviklingskart/"
      ? "index.html"
      : request.url?.split("/").pop();
  if (!files.has(file)) {
    response.writeHead(404).end();
    return;
  }
  const data = await readFile(
    new URL(`../../web/public/utviklingskart/${file}`, import.meta.url),
  );
  response.setHeader(
    "Content-Type",
    file.endsWith(".mjs")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : "text/html",
  );
  response.end(data);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let calls = 0;
  const forbidden = [];
  const errors = [];
  let mode = "success";
  await context.route("https://api.github.com/**", async (route) => {
    calls++;
    if (mode === "offline") return route.abort("internetdisconnected");
    if (mode === "limited")
      return route.fulfill({
        status: 403,
        headers: {
          "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 3600),
        },
        body: "{}",
      });
    const path = new URL(route.request().url()).pathname;
    const commentIssue = path.match(/issues\/(\d+)\/comments$/)?.[1];
    const data = commentIssue
      ? (fixture.comments[commentIssue] ?? [])
      : path.endsWith("/pulls")
        ? fixture.pulls
        : fixture.issues;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  // Eksterne fonter er ikke nødvendig for reproducerbar offline-QA.
  await context.route("https://fonts.**/**", (route) => route.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /firebase|googleapis.com\/identity|firebasedatabase/i.test(request.url())
    )
      forbidden.push(request.url());
  });
  const url = `http://127.0.0.1:${server.address().port}/utviklingskart/`;
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await page.waitForFunction(
      () => document.querySelectorAll("article.track").length === 4,
    );
    await page.waitForFunction(
      () => !document.getElementById("refresh").disabled,
    );
    assert.equal(await page.locator("article.track").count(), 4);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(await page.locator("[aria-current=step]").count(), 4);
    await page.locator(".track-details summary").first().click();
    assert.equal(
      await page.locator(".track-details").first().getAttribute("open"),
      "",
    );
    await page.locator(".track-details summary").first().click();
    if (process.env.MAP_SCREENSHOTS) {
      await mkdir(process.env.MAP_SCREENSHOTS, { recursive: true });
      await page.screenshot({
        path: `${process.env.MAP_SCREENSHOTS}/utviklingskart-${width}.png`,
        fullPage: true,
      });
    }
  }
  // API-feil må bevare statuskortene og markere dem som gamle.
  mode = "offline";
  await page.getByRole("button", { name: "Oppdater", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("error").hidden);
  assert.match(await page.locator("#error").textContent(), /sist hentede/i);
  assert.equal(await page.locator("article.track").count(), 4);
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("refresh").disabled,
  );
  assert.equal(await page.locator("article.track").count(), 4);
  assert.match(await page.locator("#error").textContent(), /sist hentede/i);

  // Rate-limit uten cache: ingen falsk grønn/fersk status; gjentatt klikk gjør ingen kall.
  const fresh = await context.newPage();
  await fresh.goto(url);
  await fresh.evaluate(() => localStorage.clear());
  mode = "limited";
  await fresh.reload();
  await fresh.waitForFunction(
    () =>
      !document.getElementById("refresh").disabled &&
      !document.getElementById("error").hidden,
  );
  assert.match(
    await fresh.locator("#error").textContent(),
    /Ingen live-status/,
  );
  const before = calls;
  await fresh.getByRole("button", { name: "Oppdater", exact: true }).click();
  assert.equal(calls, before);
  assert.equal(await fresh.locator("article.track").count(), 0);

  // GitHub-innhold er ren tekst. Utrygge lenker får ingen href.
  mode = "success";
  fixture.pulls = [
    {
      ...fixture.pulls[0],
      number: 999,
      state: "open",
      draft: false,
      title: 'Forvaltning <img src=x onerror="window.injected=true">',
      html_url: "javascript:alert(1)",
      updated_at: "2026-10-04T00:00:00Z",
    },
  ];
  await fresh.reload();
  await fresh.waitForFunction(
    () => document.querySelectorAll("article.track").length === 4,
  );
  assert.equal(await fresh.locator("#tracks img").count(), 0);
  assert.equal(await fresh.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(await fresh.evaluate(() => window.injected), undefined);
  assert.equal(forbidden.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Browser-QA OK: 1100/390px, kilder, cache/offline, rate-limit, innholdssikkerhet, null Firebase-kall.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
