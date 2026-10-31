/**
 * Kvitteringsfiler (#59, B1) mot falskt datalag: tjenesten er AV som
 * standard; med den PÅ lastes filen opp, metadata skrives med stabil id og
 * `applyLocally: false`, feil vises med bevart valg, og filer hentes først
 * på brukerens klikk — som object-URL-er som frigis ved unmount.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KvitteringFil, KvitteringRecord } from "@app-types/forsoning";

const tilstand = { aktiv: true };
const lastOpp = vi.fn();
const hent = vi.fn();
const transact = vi.fn();
let receipts: KvitteringRecord[] = [];

vi.mock("@data/kvitteringsfil.repository", () => ({
  vedleggTjenesteAktiv: () => tilstand.aktiv,
  lastOppKvitteringsfil: (...a: unknown[]) => lastOpp(...a),
  hentKvitteringsfil: (...a: unknown[]) => hent(...a),
}));
vi.mock("@data/forsoningSkriving.repository", () => ({
  transactForsoningNode: (...a: unknown[]) => transact(...a),
}));
vi.mock("@hooks/forsoningAktivering", async (orig) => ({
  ...(await orig<typeof import("@hooks/forsoningAktivering")>()),
  forsoningSkrivingAktiv: () => true,
}));
vi.mock("@hooks/useFamilyId", () => ({ useFamilyId: () => "familie1" }));
vi.mock("@hooks/useAuthUser", () => ({
  useAuthUser: () => ({ uid: "u", displayName: "Helen", email: null }),
}));

const { KvitteringVedlegg } = await import("./KvitteringVedlegg");

const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF");
const SHA = "a".repeat(64);
const r = (o: Partial<KvitteringRecord> = {}): KvitteringRecord => ({
  id: "k1",
  merchant: "Rema",
  total: 100,
  ...o,
});
const meta: KvitteringFil = {
  sha256: SHA,
  type: "image/png",
  storrelse: 2048,
  filnavn: "kvittering.png",
  lastetOpp: "2026-10-31T12:00:00Z",
  av: "Helen",
};

const opprettet: string[] = [];
const frigitt: string[] = [];
beforeEach(() => {
  tilstand.aktiv = true;
  lastOpp.mockReset();
  hent.mockReset();
  transact.mockReset();
  receipts = [r(), r({ id: "k2", merchant: "Kiwi" })];
  transact.mockImplementation(
    async (
      _f: string,
      node: string,
      upd: (p: KvitteringRecord[]) => KvitteringRecord[],
      valg: unknown,
    ) => {
      expect(node).toBe("receipts");
      expect(valg).toEqual({ applyLocally: false });
      receipts = upd(receipts);
      return receipts;
    },
  );
  opprettet.length = 0;
  frigitt.length = 0;
  let n = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => {
      const u = `blob:test/${++n}`;
      opprettet.push(u);
      return u;
    },
    revokeObjectURL: (u: string) => frigitt.push(u),
  });
});
afterEach(() => vi.unstubAllGlobals());

const velg = async (bytes: Uint8Array, navn: string, type = "application/pdf") => {
  const fil = new File([bytes as BlobPart], navn, { type });
  await userEvent.upload(screen.getByLabelText("Velg kvitteringsfil"), fil);
  return fil;
};

describe("KvitteringFiler", () => {
  it("tjenesten AV: ingen filkontroller vises, og ingenting hentes", () => {
    tilstand.aktiv = false;
    render(<KvitteringVedlegg r={r({ vedlegg: [meta] })} />);
    expect(screen.queryByLabelText("Kvitteringsfiler")).toBeNull();
    expect(hent).not.toHaveBeenCalled();
  });

  it("opplasting: originalfil til tjenesten, metadata på riktig kvittering med stabil id", async () => {
    lastOpp.mockResolvedValue({
      sha256: SHA,
      type: "application/pdf",
      storrelse: PDF.length,
      status: "opprettet",
    });
    render(<KvitteringVedlegg r={r()} />);
    const fil = await velg(PDF, "kvittering.pdf");
    await userEvent.click(screen.getByRole("button", { name: "Last opp fil" }));
    expect(lastOpp).toHaveBeenCalledWith("familie1", "k1", fil);
    expect(receipts.find((x) => x.id === "k1")!.vedlegg).toEqual([
      expect.objectContaining({
        sha256: SHA,
        type: "application/pdf",
        filnavn: "kvittering.pdf",
        av: "Helen",
      }),
    ]);
    expect(receipts.find((x) => x.id === "k2")!.vedlegg).toBeUndefined();
  });

  it("ikke-støttet innhold avvises i klienten uten opplasting, også med falsk MIME", async () => {
    render(<KvitteringVedlegg r={r()} />);
    await velg(new TextEncoder().encode("<svg></svg>"), "x.png", "image/png");
    await userEvent.click(screen.getByRole("button", { name: "Last opp fil" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bare bilder");
    expect(lastOpp).not.toHaveBeenCalled();
  });

  it("feil ved opplasting vises; valgt fil beholdes og kan prøves igjen", async () => {
    lastOpp.mockRejectedValueOnce(new Error("nett")).mockResolvedValueOnce({
      sha256: SHA,
      type: "application/pdf",
      storrelse: PDF.length,
      status: "fantes",
    });
    render(<KvitteringVedlegg r={r()} />);
    await velg(PDF, "kvittering.pdf");
    await userEvent.click(screen.getByRole("button", { name: "Last opp fil" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("filen er fortsatt valgt");
    expect(transact).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Last opp fil" }));
    expect(lastOpp).toHaveBeenCalledTimes(2);
    expect(receipts.find((x) => x.id === "k1")!.vedlegg).toHaveLength(1);
  });

  it("filer hentes først ved klikk; object-URL-er frigis ved unmount", async () => {
    hent.mockResolvedValue(new Blob([new Uint8Array([1, 2])]));
    const { unmount } = render(<KvitteringVedlegg r={r({ vedlegg: [meta] })} />);
    expect(screen.getByText(/Bilde · kvittering\.png · 2 kB/)).toBeInTheDocument();
    expect(hent).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Vis" }));
    expect(hent).toHaveBeenCalledWith("familie1", "k1", SHA);
    expect(screen.getByRole("img", { name: "Kvittering kvittering.png" })).toHaveAttribute(
      "src",
      opprettet[0],
    );
    act(() => unmount());
    expect(frigitt).toEqual(opprettet);
  });

  // ── Review 5725492565: levetid og nyere valg ─────────────────────
  const utsatt = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const meta2: KvitteringFil = { ...meta, sha256: "b".repeat(64), filnavn: "andre.png" };
  const lagretSvar = { sha256: SHA, type: "application/pdf", storrelse: PDF.length };
  /** Bytter valgt fil via change-hendelsen, også om input er sperret. */
  const byttValg = (fil: File) => {
    const input = screen.getByLabelText("Velg kvitteringsfil");
    Object.defineProperty(input, "files", { value: [fil], configurable: true });
    fireEvent.change(input);
  };

  it("nyere filvalg bevares når en tidligere opplasting fullføres; velgeren er sperret under lagring", async () => {
    lastOpp.mockResolvedValue({ ...lagretSvar, status: "opprettet" });
    const metadata = utsatt<void>();
    const ekte = transact.getMockImplementation()!;
    transact.mockImplementationOnce(async (...a: Parameters<typeof ekte>) => {
      await metadata.promise;
      return ekte(...a);
    });
    render(<KvitteringVedlegg r={r()} />);
    await velg(PDF, "first.pdf");
    await userEvent.click(screen.getByRole("button", { name: "Last opp fil" }));
    expect(screen.getByRole("button", { name: "Lagrer…" })).toBeDisabled();
    expect(screen.getByLabelText("Velg kvitteringsfil")).toBeDisabled();
    const andre = new File([PDF as BlobPart], "second.pdf", { type: "application/pdf" });
    byttValg(andre);
    await act(async () => metadata.resolve());
    expect(await screen.findByRole("status")).toHaveTextContent("«first.pdf» er lagret.");
    const knapp = screen.getByRole("button", { name: "Last opp fil" });
    expect(knapp).toBeEnabled();
    await userEvent.click(knapp);
    expect(lastOpp).toHaveBeenLastCalledWith("familie1", "k1", andre);
  });

  it("feil på tidligere opplasting navngir filen som feilet og bevarer det nyere valget", async () => {
    const svar = utsatt<unknown>();
    lastOpp.mockImplementationOnce(() => svar.promise);
    render(<KvitteringVedlegg r={r()} />);
    await velg(PDF, "first.pdf");
    await userEvent.click(screen.getByRole("button", { name: "Last opp fil" }));
    const andre = new File([PDF as BlobPart], "second.pdf", { type: "application/pdf" });
    byttValg(andre);
    await act(async () => svar.reject(new Error("nett")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunne ikke lagre «first.pdf»");
    expect(screen.queryByRole("status")).toBeNull();
    lastOpp.mockResolvedValueOnce({ ...lagretSvar, status: "opprettet" });
    await userEvent.click(screen.getByRole("button", { name: "Last opp fil" }));
    expect(lastOpp).toHaveBeenLastCalledWith("familie1", "k1", andre);
    expect(await screen.findByRole("status")).toHaveTextContent("«second.pdf» er lagret.");
  });

  it("ventende «Vis» etter unmount: ingen object-URL opprettes", async () => {
    const svar = utsatt<Blob>();
    hent.mockReturnValue(svar.promise);
    const { unmount } = render(<KvitteringVedlegg r={r({ vedlegg: [meta] })} />);
    await userEvent.click(screen.getByRole("button", { name: "Vis" }));
    act(() => unmount());
    await act(async () => svar.resolve(new Blob([new Uint8Array([1])])));
    expect(opprettet).toEqual([]);
    expect(frigitt).toEqual([]);
  });

  it("ventende «Last ned» etter unmount: ingen URL og ingen nedlasting", async () => {
    const svar = utsatt<Blob>();
    hent.mockReturnValue(svar.promise);
    const klikk = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { unmount } = render(<KvitteringVedlegg r={r({ vedlegg: [meta] })} />);
    await userEvent.click(screen.getByRole("button", { name: "Last ned" }));
    act(() => unmount());
    await act(async () => svar.resolve(new Blob([new Uint8Array([1])])));
    expect(opprettet).toEqual([]);
    expect(klikk).not.toHaveBeenCalled();
    klikk.mockRestore();
  });

  it("ventende «Vis» ved bytte av kvittering: gammelt svar vises ikke og lager ingen URL", async () => {
    const svar = utsatt<Blob>();
    hent.mockReturnValue(svar.promise);
    const { rerender } = render(<KvitteringVedlegg r={r({ vedlegg: [meta] })} />);
    await userEvent.click(screen.getByRole("button", { name: "Vis" }));
    rerender(<KvitteringVedlegg r={r({ id: "k2", vedlegg: [meta] })} />);
    await act(async () => svar.resolve(new Blob([new Uint8Array([1])])));
    expect(opprettet).toEqual([]);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("bare siste «Vis» vises; et utdatert svar lager ingen URL, og erstattet visning frigis", async () => {
    const a = utsatt<Blob>();
    const b = utsatt<Blob>();
    hent.mockImplementation((_f: string, _r: string, sha: string) =>
      sha === SHA ? a.promise : b.promise,
    );
    render(<KvitteringVedlegg r={r({ vedlegg: [meta, meta2] })} />);
    const [visA, visB] = screen.getAllByRole("button", { name: "Vis" });
    await userEvent.click(visA!);
    await userEvent.click(visB!);
    await act(async () => b.resolve(new Blob([new Uint8Array([2])])));
    await act(async () => a.resolve(new Blob([new Uint8Array([1])])));
    expect(opprettet).toEqual(["blob:test/1"]);
    expect(screen.getByRole("img", { name: "Kvittering andre.png" })).toHaveAttribute(
      "src",
      "blob:test/1",
    );
    expect(screen.queryByRole("img", { name: "Kvittering kvittering.png" })).toBeNull();

    // Ny «Vis» på A erstatter B; B frigis med en gang.
    hent.mockResolvedValue(new Blob([new Uint8Array([1])]));
    await userEvent.click(screen.getAllByRole("button", { name: "Vis" })[0]!);
    expect(opprettet).toEqual(["blob:test/1", "blob:test/2"]);
    expect(frigitt).toEqual(["blob:test/1"]);
  });
});
