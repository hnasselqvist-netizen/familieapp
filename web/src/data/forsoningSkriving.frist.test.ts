/**
 * Review 5971652993 (P2): hele den versjonerte forsoningsoperasjonen —
 * tokenhenting, forespørsel og JSON-lesing — har ÉN frist. Et token eller et
 * svar som kommer etter fristen, starter aldri en ny forespørsel, og ingenting
 * skrives. Falsk klokke; Firebase Auth og `fetch` er erstattet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  currentUser: null as { getIdToken: () => Promise<string> } | null,
}));
vi.mock("./firebase", () => ({
  getFirebaseAuth: () => auth,
  getFirebaseDatabase: () => ({}),
  databaseRestUrl: (sti: string) => new URL(`https://db.test/${sti}.json`),
}));

const { kjorNodeVersjonert, lesForsoningNodeFersk } =
  await import("./forsoningSkriving.repository");

function utsatt<T>() {
  let svar!: (v: T) => void;
  const promise = new Promise<T>((r) => (svar = r));
  return { promise, svar };
}
const svar = (body: unknown, etag = "e1", status = 200) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h: string) => (h === "ETag" ? etag : null) },
    json: () => Promise.resolve(body),
  }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  auth.currentUser = { getIdToken: () => Promise.resolve("t") };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FRIST = 1_000;

describe("frist for hele operasjonen", () => {
  it("token som henger: kontrollen gir `ikkeLest` ved fristen; et sent token starter ingen GET", async () => {
    const token = utsatt<string>();
    auth.currentUser = { getIdToken: () => token.promise };
    const r = lesForsoningNodeFersk("familie1", "hendelser", { fristMs: FRIST });
    await vi.advanceTimersByTimeAsync(FRIST);
    await expect(r).resolves.toEqual({ type: "ikkeLest" });
    token.svar("sent");
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token som henger ved skriving: `ikkeLest` ved fristen; ingen GET eller PUT etterpå", async () => {
    const token = utsatt<string>();
    auth.currentUser = { getIdToken: () => token.promise };
    const beslutt = vi.fn(() => ({ type: "skriv" as const, eksport: [] }));
    const r = kjorNodeVersjonert("familie1", "hendelser", beslutt, { fristMs: FRIST });
    await vi.advanceTimersByTimeAsync(FRIST);
    await expect(r).resolves.toEqual({ type: "ikkeLest" });
    token.svar("sent");
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beslutt).not.toHaveBeenCalled();
  });

  it("body som henger: `ikkeLest` ved fristen; en sen body fører ikke til beslutning eller PUT", async () => {
    const body = utsatt<unknown>();
    fetchMock.mockResolvedValueOnce({ ...svar(null), json: () => body.promise });
    const beslutt = vi.fn(() => ({ type: "skriv" as const, eksport: [] }));
    const r = kjorNodeVersjonert("familie1", "hendelser", beslutt, { fristMs: FRIST });
    await vi.advanceTimersByTimeAsync(FRIST);
    await expect(r).resolves.toEqual({ type: "ikkeLest" });
    body.svar([{ id: "h1" }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(beslutt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "GET" });
  });

  it("body som henger i kontrollen: `ikkeLest` ved fristen", async () => {
    fetchMock.mockResolvedValueOnce({ ...svar(null), json: () => new Promise(() => {}) });
    const r = lesForsoningNodeFersk("familie1", "hendelser", { fristMs: FRIST });
    await vi.advanceTimersByTimeAsync(FRIST);
    await expect(r).resolves.toEqual({ type: "ikkeLest" });
  });

  it("sent token til PUT etter en vellykket lesing: `ikkeLest`, PUT sendes aldri", async () => {
    const token2 = utsatt<string>();
    let n = 0;
    auth.currentUser = {
      getIdToken: () => (++n === 1 ? Promise.resolve("t") : token2.promise),
    };
    fetchMock.mockResolvedValueOnce(svar([{ id: "h1" }]));
    const r = kjorNodeVersjonert(
      "familie1",
      "hendelser",
      () => ({ type: "skriv", eksport: [{ id: "h1", kommentar: "x" }] }),
      { fristMs: FRIST },
    );
    await vi.advanceTimersByTimeAsync(FRIST);
    await expect(r).resolves.toEqual({ type: "ikkeLest" });
    token2.svar("sent");
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PUT sendt og svaret uteblir: `ukjent` ved fristen", async () => {
    fetchMock
      .mockResolvedValueOnce(svar([{ id: "h1" }]))
      .mockImplementationOnce(() => new Promise(() => {}));
    const r = kjorNodeVersjonert(
      "familie1",
      "hendelser",
      () => ({ type: "skriv", eksport: [{ id: "h1", kommentar: "x" }] }),
      { fristMs: FRIST },
    );
    await vi.advanceTimersByTimeAsync(FRIST);
    await expect(r).resolves.toEqual({ type: "ukjent" });
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: "PUT",
      headers: { "if-match": "e1" },
    });
  });

  it("et stopp sender ingenting etter lesingen", async () => {
    fetchMock.mockResolvedValueOnce(svar([{ id: "h1" }]));
    const r = await kjorNodeVersjonert(
      "familie1",
      "hendelser",
      () => ({ type: "stopp", utfall: "konflikt" }),
      { fristMs: FRIST },
    );
    expect(r).toEqual({ type: "stopp", utfall: "konflikt" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
