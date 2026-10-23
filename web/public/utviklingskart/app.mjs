/* global document, window, localStorage, setInterval, AbortController, URL */
import { repository, stages, tracks } from "./tracks.mjs";
import { buildTrack, classifyPull, shortText } from "./model.mjs";
import { loadSnapshot } from "./github.mjs";

const refreshMs = 15 * 60 * 1000;
const cacheKey = "hverdagsflyt-utviklingskart-v1";
const cards = document.getElementById("tracks");
const sync = document.getElementById("sync");
const error = document.getElementById("error");
const button = document.getElementById("refresh");
let snapshot;
let fetching = false;
let retryAt = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(text, href) {
  const node = element("a", text);
  try {
    const url = new URL(href);
    if (url.origin !== "https://github.com" || !url.pathname.startsWith(`/${repository}/`)) {
      return element("span", text);
    }
    node.href = url.href;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
  } catch {
    return element("span", text);
  }
  return node;
}

function date(value) {
  return new Date(value).toLocaleString("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function field(label, text, href, className) {
  const group = element("div", "", className);
  group.append(element("dt", label));
  const content = element("dd");
  content.append(href ? link(text, href) : element("span", text));
  group.append(content);
  return group;
}

function renderTrack(track) {
  const card = element("article", "", "track");
  const header = element("div", "", "track-header");
  const title = element("div");
  const heading = element("h2", track.name);
  heading.id = `track-${track.id}`;
  card.setAttribute("aria-labelledby", heading.id);
  title.append(heading, element("p", track.description, "description"));
  const state = element("div");
  state.append(element("span", track.stage, "badge"), element("p", track.basis, "basis"));
  header.append(title, state);
  const steps = element("ol", "", "steps");
  steps.setAttribute("aria-label", `Status: ${track.stage}`);
  const index = stages.indexOf(track.stage);
  stages.forEach((stage, i) => {
    const step = element("li", stage, i === index ? "current" : i < index ? "passed" : "");
    if (i === index) step.setAttribute("aria-current", "step");
    steps.append(step);
  });
  const fields = element("dl", "", "fields");
  fields.append(field("Nå", track.now, track.source), field("Neste", track.next));
  if (track.waiting) fields.append(field("Venter på", track.waiting, track.source, "waiting"));
  const details = element("details", "", "track-details");
  details.append(
    element(
      "summary",
      track.active.length
        ? `${track.active.length} åpen PR · Kilder og handoff`
        : "Kilder og handoff",
    ),
  );
  const sources = element("div", "", "detail-row");
  if (track.hasIssue)
    sources.append(
      link(`Handoff #${track.issue}`, `https://github.com/${repository}/issues/${track.issue}`),
    );
  if (track.latestMerged)
    sources.append(link(`Sist merget: #${track.latestMerged.number}`, track.latestMerged.html_url));
  details.append(sources);
  for (const pull of track.active) {
    const paragraph = element("p");
    paragraph.append(link(`#${pull.number} · ${pull.title}`, pull.html_url));
    details.append(paragraph);
  }
  if (track.newestComment) {
    const paragraph = element("p", "Siste handoff: ", "handoff");
    paragraph.append(link(shortText(track.newestComment.body, 260), track.newestComment.html_url));
    details.append(paragraph);
  }
  if (track.newerHandoff && !track.noteDate) {
    details.append(
      element(
        "p",
        "Nyere handoff finnes. Eldre mellom-PR-notat er skjult; status viser siste leveranse eller aktive PR-er.",
      ),
    );
  }
  if (track.noteDate)
    details.append(
      element("p", `Kortnotat bekreftet ${date(track.noteDate)}. PR-status hentes automatisk.`),
    );
  if (track.issueClosed)
    details.append(
      element(
        "p",
        "Handoff-issue er lukket. Vurder om sporet skal arkiveres eller få en ny handoff.",
      ),
    );
  card.append(header, steps, fields, details);
  return card;
}

function render() {
  const mapped = tracks.map((track) =>
    buildTrack(
      track,
      snapshot.pulls.filter((pull) => classifyPull(pull, tracks) === track.id),
      snapshot.issues.find((issue) => issue.number === track.issue),
      snapshot.comments[track.issue],
    ),
  );
  cards.replaceChildren(...mapped.map(renderTrack));
  cards.setAttribute("aria-busy", "false");
  const open = mapped.reduce((count, track) => count + track.active.length, 0);
  const waiting = mapped.filter((track) => track.waiting).length;
  document.getElementById("summary").textContent =
    `${tracks.length} hovedspor · ${open} åpne PR-er${waiting ? ` · ${waiting} spor venter på noe` : ""}`;
  sync.textContent = `Sist hentet ${date(snapshot.fetchedAt)} · Oppdateres hvert 15. minutt`;
}

async function refresh() {
  if (fetching || Date.now() < retryAt) return;
  fetching = true;
  button.disabled = true;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);
  try {
    const fresh = await loadSnapshot(tracks, { signal: controller.signal });
    snapshot = fresh;
    render();
    error.hidden = true;
    try {
      localStorage.setItem(cacheKey, JSON.stringify(fresh));
    } catch {
      /* Privat modus / full lagring. */
    }
  } catch (failure) {
    retryAt = failure.retryAt || Date.now() + refreshMs;
    error.textContent = `${failure.name === "AbortError" ? "GitHub svarte ikke i tide." : failure.message} ${snapshot ? `Viser sist hentede oversikt fra ${date(snapshot.fetchedAt)}.` : "Ingen live-status tilgjengelig ennå."} Prøv igjen etter ${date(retryAt)}.`;
    error.hidden = false;
    cards.setAttribute("aria-busy", "false");
    if (!snapshot) sync.textContent = "Venter på GitHub. Kildene kan fortsatt åpnes direkte.";
  } finally {
    window.clearTimeout(timeout);
    fetching = false;
    button.disabled = false;
  }
}

try {
  const cached = JSON.parse(localStorage.getItem(cacheKey));
  if (
    cached &&
    Array.isArray(cached.pulls) &&
    Array.isArray(cached.issues) &&
    cached.comments &&
    Number.isFinite(Date.parse(cached.fetchedAt))
  ) {
    snapshot = cached;
    render();
    error.textContent = `Viser lagret oversikt fra ${date(cached.fetchedAt)} mens GitHub oppdateres.`;
    error.hidden = false;
  }
} catch {
  /* Ødelagt eller utilgjengelig cache skal ikke hindre live-henting. */
}
button.addEventListener("click", () => {
  if (Date.now() < retryAt) {
    error.textContent = `Neste forsøk etter ${date(retryAt)}. Sist hentede oversikt beholdes.`;
    error.hidden = false;
    return;
  }
  void refresh();
});
setInterval(() => {
  if (!document.hidden) void refresh();
}, refreshMs);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (!snapshot || Date.now() - Date.parse(snapshot.fetchedAt) >= refreshMs))
    void refresh();
});
void refresh();
