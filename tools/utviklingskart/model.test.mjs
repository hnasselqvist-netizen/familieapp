import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrack,
  classifyPull,
  readNote,
  shortText,
} from "../../web/public/utviklingskart/model.mjs";
import {
  fetchPages,
  loadSnapshot,
} from "../../web/public/utviklingskart/github.mjs";
import { tracks } from "../../web/public/utviklingskart/tracks.mjs";

const track = tracks.find((item) => item.id === "forvaltning");
const pull = {
  number: 100,
  title: "Forvaltning R1",
  state: "open",
  draft: true,
  updated_at: "2026-10-03T12:00:00Z",
  html_url: "https://github.com/hnasselqvist-netizen/familieapp/pull/100",
};
const comment = {
  id: 9999999999,
  body: "## Ny beslutning\n\nDetaljer",
  updated_at: "2026-10-03T13:00:00Z",
  html_url:
    "https://github.com/hnasselqvist-netizen/familieapp/issues/34#issuecomment-9999999999",
};

test("draft → Bygges, ready → Review, merged → Klar; aldri automatisk I bruk", () => {
  assert.equal(buildTrack(track, [pull]).stage, "Bygges");
  assert.equal(buildTrack(track, [{ ...pull, draft: false }]).stage, "Review");
  assert.equal(
    buildTrack(track, [
      { ...pull, state: "closed", merged_at: pull.updated_at },
    ]).stage,
    "Klar",
  );
});

test("lukket uten merge teller ikke som levert", () => {
  const result = buildTrack({ ...track, note: undefined }, [
    { ...pull, state: "closed" },
  ]);
  assert.equal(result.stage, "Kartlagt");
  assert.equal(result.latestMerged, undefined);
});

test("ny PR overstyrer gammel I bruk-bekreftelse og gammel blokkering", () => {
  const result = buildTrack(
    {
      ...track,
      note: { ...track.note, stage: "I bruk", waiting: "Gammel blocker" },
    },
    [pull],
  );
  assert.equal(result.stage, "Bygges");
  assert.equal(result.waiting, "");
});

test("ny handoff skjuler gammel status/ventetekst; siste merge forblir bare Klar", () => {
  const result = buildTrack(
    track,
    [{ ...pull, state: "closed", merged_at: pull.updated_at }],
    {},
    [comment],
  );
  assert.equal(result.noteDate, undefined);
  assert.equal(result.stage, "Klar");
  assert.equal(result.waiting, "");
  assert.equal(result.newerHandoff, true);
});

test("redigering av den sist observerte kommentaren ugyldiggjør kortnotatet", () => {
  assert.equal(
    buildTrack(track, [], {}, [{ ...comment, id: track.note.observedComment }])
      .noteDate,
    undefined,
  );
});

test("nyeste strukturerte kommentar er nok; eldre blocker gjenbrukes ikke", () => {
  const old = {
    ...comment,
    id: 1,
    body: '<!-- utviklingskart {"stage":"Designet","now":"Design","waiting":"Helen"} -->',
  };
  assert.equal(buildTrack(track, [], {}, [old, comment]).waiting, "");
  const fresh = {
    ...comment,
    body: '<!-- utviklingskart {"stage":"I bruk","now":"Verifisert","next":"Neste"} -->',
  };
  assert.equal(buildTrack(track, [], {}, [fresh]).stage, "I bruk");
  assert.equal(buildTrack(track, [pull], {}, [fresh]).stage, "Bygges");
});

test("markører valideres; vilkårlig prose blir ikke tolket som status", () => {
  assert.equal(readNote("ferdig, i bruk, blokkert"), null);
  assert.equal(
    readNote('<!-- utviklingskart {"stage":"I bruk","now":42} -->'),
    null,
  );
  assert.equal(
    readNote('<!-- utviklingskart {"stage":"Ferdig","now":"x"} -->'),
    null,
  );
  assert.equal(
    readNote('<!-- utviklingskart {"stage":"Klar","now":"x","waiting":{}} -->'),
    null,
  );
  assert.equal(readNote("<!-- utviklingskart {broken} -->"), null);
});

test("PR-label gir en synlig avhengighet; gamle notater gjør ikke det", () => {
  assert.match(
    buildTrack(track, [{ ...pull, labels: [{ name: "blocked" }] }]).waiting,
    /blokkert/,
  );
});

test("siste merge bestemmes av merged_at, ikke senere PR-kommentarer", () => {
  const old = {
    ...pull,
    number: 1,
    state: "closed",
    merged_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-12-01T00:00:00Z",
  };
  const newest = {
    ...pull,
    number: 2,
    state: "closed",
    merged_at: pull.updated_at,
  };
  assert.equal(buildTrack(track, [old, newest]).latestMerged.number, 2);
});

test("klassifisering følger hovedspor, med eksplisitte grunnmur-PR-er og uten selvreferanse", () => {
  assert.equal(
    classifyPull(
      {
        ...pull,
        number: 40,
        title: "MCP-kontrollflate: foundation for Handleliste",
      },
      tracks,
    ),
    "chatgpt",
  );
  // Prioritet: MCP skal ikke havne i Kjøkken bare fordi tittelen nevner Handleliste.
  assert.equal(
    classifyPull({ ...pull, number: 21, title: "Mat-UI-grunnmur" }, tracks),
    "grunnmur",
  );
  assert.equal(
    classifyPull(
      { ...pull, title: "Utviklingskart", body: "Issue #34" },
      tracks,
    ),
    null,
  );
  assert.equal(
    classifyPull({ ...pull, title: "R1", body: "Issue #34" }, tracks),
    "forvaltning",
  );
  assert.equal(classifyPull({ ...pull, title: "Ukjent" }, tracks), null);
});

test("korte felt fjerner markdown, men bevarer PR-numre", () => {
  assert.equal(
    shortText("## **Klar** i [#40](https://github.com/example)"),
    "Klar i #40",
  );
  assert.equal(shortText("a".repeat(300)).length, 180);
});

test("GitHub-paginering henter alle sidene og sender aldri credentials", async () => {
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials, "omit");
    return new Response(JSON.stringify([{ number: urls.length }]), {
      headers:
        urls.length === 1
          ? {
              link: '<https://api.github.com/repos/hnasselqvist-netizen/familieapp/pulls?page=2>; rel="next"',
            }
          : {},
    });
  };
  assert.equal((await fetchPages("pulls?state=all", { fetcher })).length, 2);
});

test("rate limit oppgir tidspunkt, feil kaster i stedet for å gi tom status", async () => {
  await assert.rejects(
    fetchPages("pulls", {
      fetcher: async () =>
        new Response("", {
          status: 403,
          headers: { "x-ratelimit-reset": "1800000000" },
        }),
    }),
    (error) => error.retryAt === 1800000000000,
  );
  await assert.rejects(
    fetchPages("pulls", { fetcher: async () => new Response("{}") }),
    /Uventet svar/,
  );
});

test("overdrevet eller fremmed paginering gir ikke en delvis oversikt", async () => {
  const fetcher = async () =>
    new Response("[]", {
      headers: {
        link: '<https://api.github.com/repos/hnasselqvist-netizen/familieapp/pulls?page=2>; rel="next"',
      },
    });
  await assert.rejects(fetchPages("pulls", { fetcher }), /for stort/);
  await assert.rejects(
    fetchPages("pulls", {
      fetcher: async () =>
        new Response("[]", {
          headers: {
            link: '<https://example.com/pulls>; rel="next"',
          },
        }),
    }),
    /Uventet paginering/,
  );
});

test("snapshot henter delt handoff én gang og feiler samlet ved delvis feil", async () => {
  const urls = [];
  await loadSnapshot(tracks, {
    fetcher: async (url) => {
      urls.push(url);
      return new Response("[]");
    },
  });
  assert.equal(urls.length, 5);
  assert.equal(
    urls.filter((url) => url.includes("issues/20/comments")).length,
    1,
  );
  await assert.rejects(
    loadSnapshot(tracks, {
      fetcher: async (url) =>
        new Response("[]", {
          status: url.includes("issues/34/comments") ? 500 : 200,
        }),
    }),
    /500/,
  );
});
