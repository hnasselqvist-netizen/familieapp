import { stages } from "./tracks.mjs";

export function shortText(markdown, limit = 180) {
  const text = String(markdown ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*#+\s+/gm, "")
    .replace(/@\S+|[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

// Ingen tolkning av prose som «ferdig» eller «blokkert». Bare eksplisitt metadata.
// Valgfritt i eksisterende handoff: <!-- utviklingskart {"stage":"Designet",...} -->
export function readNote(body) {
  const match = String(body ?? "").match(/<!--\s*utviklingskart\s+(\{[\s\S]*?\})\s*-->/);
  if (!match) return null;
  try {
    const note = JSON.parse(match[1]);
    if (!stages.includes(note.stage) || typeof note.now !== "string" || !note.now.trim()) {
      return null;
    }
    for (const key of ["next", "waiting"]) {
      if (note[key] !== undefined && typeof note[key] !== "string") return null;
    }
    return {
      stage: note.stage,
      now: shortText(note.now),
      next: shortText(note.next),
      waiting: shortText(note.waiting),
    };
  } catch {
    return null;
  }
}

export function classifyPull(pull, tracks) {
  if (/utviklingskart/i.test(pull.title)) return null;
  const explicit = tracks.find((track) => track.pullNumbers?.includes(pull.number));
  if (explicit) return explicit.id;
  // Spornavnet først i tittelen veier tyngre enn en nevnt delmodul senere.
  const titleMatch = tracks
    .map((track) => ({ track, match: pull.title.match(new RegExp(track.titlePattern, "i")) }))
    .filter((entry) => entry.match)
    .sort((a, b) => a.match.index - b.match.index)[0]?.track;
  if (titleMatch) return titleMatch.id;
  // Fallback for nøytrale titler. Cross-referanser alene er for svakt.
  const linked = tracks.filter((track) =>
    new RegExp(`(?:closes|fixes|resolves|issue|refs)\\s+#${track.issue}\\b`, "i").test(
      pull.body ?? "",
    ),
  );
  return linked.length === 1 ? linked[0].id : null;
}

export function buildTrack(track, pulls, issue, comments = []) {
  const recent = [...pulls].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const active = recent.filter((pull) => pull.state === "open");
  const latestMerged = [...pulls]
    .filter((pull) => pull.merged_at)
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))[0];
  const newestComment = [...comments].sort((a, b) => b.id - a.id)[0];
  // Kun nyeste handoff teller; gamle blokkeringer skal aldri henge igjen.
  const commentNote = readNote(newestComment?.body);
  const newerHandoff =
    newestComment &&
    (newestComment.id > (track.note?.observedComment ?? 0) ||
      Date.parse(newestComment.updated_at) > Date.parse(track.note?.observedAt ?? 0));
  const note = commentNote
    ? { ...commentNote, source: newestComment.html_url, observedAt: newestComment.updated_at }
    : newerHandoff
      ? null
      : track.note;
  const newerMerged =
    latestMerged && (!note || Date.parse(latestMerged.merged_at) > Date.parse(note.observedAt));
  let stage = note?.stage ?? (latestMerged ? "Klar" : "Kartlagt");
  let basis = note ? "Handoff" : latestMerged ? "Siste leveranse" : "Ingen bekreftet byggestatus";
  let now =
    note?.now ??
    (newestComment
      ? shortText(newestComment.body.split(/\n\s*\n/)[0]) || "Ny handoff på GitHub."
      : issue
        ? shortText(issue.title)
        : "Ingen aktiv PR funnet.");
  let source = note?.source ?? newestComment?.html_url ?? issue?.html_url;
  let next = note?.next || "Neste oppdrag avklares i handoffen på GitHub.";
  let waiting = note?.waiting || "";
  if (newerMerged) {
    stage = "Klar";
    basis = "Siste leveranse";
    now = shortText(latestMerged.title);
    source = latestMerged.html_url;
    next = "Avklar neste skive eller bekreft at leveransen er i bruk.";
    waiting = "";
    if (
      newerHandoff &&
      Date.parse(newestComment.created_at ?? newestComment.updated_at) >
        Date.parse(latestMerged.merged_at)
    ) {
      basis = "Siste leveranse · Ny handoff";
      now = `Ny handoff: ${shortText(newestComment.body.split(/\n\s*\n/)[0], 150)}`;
      source = newestComment.html_url;
      next = "Neste oppdrag ligger i den nye handoffen.";
    }
  }
  if (active.length) {
    const focus = active[0];
    stage = focus.draft ? "Bygges" : "Review";
    basis = focus.draft ? "Draft PR" : "Åpen PR";
    now = shortText(focus.title);
    source = focus.html_url;
    next = focus.draft
      ? "Fullfør skiven og gjør PR-en klar for review."
      : "Review og merge før eventuell aktivering.";
    waiting = active.some((pull) =>
      pull.labels?.some((label) => /^(blocked|blokkert)$/i.test(label.name)),
    )
      ? "En åpen PR er merket blokkert. Se PR-en for avhengigheten."
      : "";
  }
  return {
    ...track,
    stage,
    basis,
    now,
    next,
    waiting,
    source,
    active,
    latestMerged,
    newestComment,
    newerHandoff,
    noteDate: note?.observedAt,
    issueClosed: issue?.state === "closed",
    hasIssue: !!issue,
  };
}
