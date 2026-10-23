/* global fetch */
// Lesing uten token. Ingen server, hemmeligheter eller GitHub-skriving.
export async function fetchPages(path, { fetcher = fetch, signal } = {}) {
  const items = [];
  let url = `https://api.github.com/repos/hnasselqvist-netizen/familieapp/${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  for (let page = 0; url && page < 20; page++) {
    const response = await fetcher(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal,
      credentials: "omit",
      cache: "no-cache",
    });
    if (!response.ok) {
      const reset = response.headers.get("x-ratelimit-reset");
      const error = new Error(
        response.status === 403 || response.status === 429
          ? "GitHub ber oss vente før neste oppdatering."
          : `GitHub kunne ikke hentes (${response.status}).`,
      );
      error.retryAt = reset ? Number(reset) * 1000 : Date.now() + 15 * 60 * 1000;
      throw error;
    }
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Uventet svar fra GitHub.");
    items.push(...data);
    const next = response.headers.get("link")?.match(/<([^>]+)>; rel="next"/);
    url = next?.[1] ?? null;
    if (url && !url.startsWith("https://api.github.com/repos/hnasselqvist-netizen/familieapp/")) {
      throw new Error("Uventet paginering fra GitHub.");
    }
  }
  if (url) throw new Error("GitHub-resultatet ble for stort. Ingen delvis status vises.");
  return items;
}

export async function loadSnapshot(tracks, options) {
  const issues = [...new Set(tracks.map((track) => track.issue))];
  const [allIssues, pulls, ...comments] = await Promise.all([
    fetchPages("issues?state=all&sort=updated&direction=desc", options),
    fetchPages("pulls?state=all&sort=updated&direction=desc", options),
    ...issues.map((number) => fetchPages(`issues/${number}/comments`, options)),
  ]);
  return {
    fetchedAt: new Date().toISOString(),
    issues: allIssues.filter((issue) => !issue.pull_request),
    pulls,
    comments: Object.fromEntries(issues.map((number, index) => [number, comments[index]])),
  };
}
