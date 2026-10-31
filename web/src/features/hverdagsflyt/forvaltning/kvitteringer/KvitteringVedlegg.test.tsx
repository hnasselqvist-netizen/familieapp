import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aktiveKvitteringer } from "@domain/forsoning/kvitteringsinnboks";
import type { HendelseRecord, KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";
import { KvitteringVedlegg } from "./KvitteringVedlegg";
import { KvitteringsinnboksView } from "./KvitteringsinnboksView";

/**
 * Lagret kvitteringsbilde (#59, skive A): trygg visning og byte-lik
 * nedlasting i både lesedetaljen og redigeringspanelet. Bare syntetiske
 * bytes — aldri ekte kvitteringer.
 */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 7, 7, 7,
]);
const dataUrl = (type: string, bytes: Uint8Array) =>
  `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`;
const DRIVE = "https://drive.google.com/file/d/abc/view";

let blobs: Map<string, Blob>;
let opprettet: string[];
let frigitt: string[];

beforeEach(() => {
  blobs = new Map();
  opprettet = [];
  frigitt = [];
  let n = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((b: Blob) => {
      const u = `blob:test/${++n}`;
      blobs.set(u, b);
      opprettet.push(u);
      return u;
    }),
    revokeObjectURL: vi.fn((u: string) => frigitt.push(u)),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lesBytes = (b: Blob) =>
  new Promise<number[]>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve([...new Uint8Array(fr.result as ArrayBuffer)]);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(b);
  });

const kvittering = (o: Partial<KvitteringRecord> = {}): KvitteringRecord => ({
  id: "k-bilde",
  merchant: "Testbutikk",
  purchaseDate: "2026-09-05",
  total: 99,
  matchingStatus: "unmatched",
  ...o,
});

describe("KvitteringVedlegg", () => {
  it("viser et gyldig bilde og laster ned de samme bytene under et generert navn", async () => {
    render(<KvitteringVedlegg r={kvittering({ imageUrl: dataUrl("image/png", PNG) })} />);
    const bilde = await screen.findByRole("img", { name: "Kvitteringsbilde fra Testbutikk" });
    const lenke = screen.getByRole("link", { name: /Last ned kvitteringsbilde \(PNG, 1 kB\)/ });
    expect(opprettet).toHaveLength(1);
    expect(bilde).toHaveAttribute("src", opprettet[0]);
    expect(lenke).toHaveAttribute("href", opprettet[0]);
    expect(lenke).toHaveAttribute("download", "kvittering-2026-09-05-k-bilde.png");
    const blob = blobs.get(opprettet[0]!)!;
    expect(blob.type).toBe("image/png");
    expect(await lesBytes(blob)).toEqual([...PNG]);
  });

  it.each([
    ["SVG", dataUrl("image/svg+xml", new TextEncoder().encode("<svg onload=alert(1)>"))],
    ["HTML", dataUrl("text/html", new TextEncoder().encode("<b>x</b>"))],
    ["falsk PNG", dataUrl("image/png", new TextEncoder().encode("<html>"))],
    ["ugyldig base64", "data:image/png;base64,@@@@"],
    ["annen URL", "https://example.test/k.png"],
  ])("rendrer ikke %s, og lager ingen object-URL", (_navn, imageUrl) => {
    render(<KvitteringVedlegg r={kvittering({ imageUrl })} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/ikke kan vises|kan ikke vises/)).toBeInTheDocument();
    expect(opprettet).toEqual([]);
  });

  it("for stort bilde gir en rolig melding uten dekoding", () => {
    const imageUrl = `data:image/png;base64,${"A".repeat(14 * 1024 * 1024)}`;
    render(<KvitteringVedlegg r={kvittering({ imageUrl })} />);
    expect(screen.getByText(/for stort til å vises/)).toBeInTheDocument();
    expect(opprettet).toEqual([]);
  });

  it("uten bilde og uten Drive rendres ingenting", () => {
    const { container } = render(<KvitteringVedlegg r={kvittering()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("beholder Drive-lenken, også ved siden av et lagret bilde", async () => {
    render(
      <KvitteringVedlegg
        r={kvittering({ driveWebViewLink: DRIVE, imageUrl: dataUrl("image/png", PNG) })}
      />,
    );
    expect(screen.getByRole("link", { name: "Åpne bilde i Google Drive" })).toHaveAttribute(
      "href",
      DRIVE,
    );
    expect(await screen.findByRole("img")).toBeInTheDocument();
  });

  it("når nettleseren ikke kan dekode bildet, skjules det, og originalen kan fortsatt lastes ned", async () => {
    render(<KvitteringVedlegg r={kvittering({ imageUrl: dataUrl("image/png", PNG) })} />);
    const bilde = await screen.findByRole("img");
    bilde.dispatchEvent(new Event("error"));
    expect(await screen.findByText("Nettleseren kunne ikke vise kvitteringsbildet.")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Last ned kvitteringsbilde/ })).toBeInTheDocument();
  });

  it("frigir object-URL-en ved bytte av kvittering og ved unmount, og åpner/laster ikke ned noe selv", async () => {
    const klikk = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const { rerender, unmount } = render(
      <KvitteringVedlegg r={kvittering({ imageUrl: dataUrl("image/png", PNG) })} />,
    );
    await screen.findByRole("img");
    const forste = opprettet[0];
    rerender(
      <KvitteringVedlegg
        r={kvittering({
          id: "k-annen",
          imageUrl: dataUrl(
            "image/png",
            PNG.map((b, i) => (i === 18 ? 9 : b)),
          ),
        })}
      />,
    );
    await screen.findByRole("img");
    expect(frigitt).toEqual([forste]);
    unmount();
    expect(frigitt).toEqual(opprettet);
    expect(klikk).not.toHaveBeenCalled();
  });

  it("logger aldri bildet", async () => {
    const spioner = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const imageUrl = dataUrl("image/png", PNG);
    const { unmount } = render(<KvitteringVedlegg r={kvittering({ imageUrl })} />);
    (await screen.findByRole("img")).dispatchEvent(new Event("error"));
    unmount();
    render(<KvitteringVedlegg r={kvittering({ imageUrl: "data:image/png;base64,@@@@" })} />);
    for (const s of spioner) {
      for (const kall of s.mock.calls) expect(JSON.stringify(kall)).not.toContain("base64");
    }
  });
});

describe("Kvitteringsinnboksen viser samme vedlegg i begge panelene", () => {
  const transaksjoner: TransaksjonRecord[] = [
    {
      id: "t1",
      dato: "2026-09-05",
      tekst: "TESTBUTIKK",
      belop: 99,
      retning: "ut",
      konto: "felles",
      status: "ny",
    },
  ];
  const hendelser: HendelseRecord[] = [];
  const alle: KvitteringRecord[] = [
    kvittering({
      imageUrl: dataUrl("image/png", PNG),
      transactionId: "t1",
      allocationMode: "single",
      splits: [{ targetType: "budget", targetId: "b1", targetName: "Dagligvarer", amount: 99 }],
    }),
    kvittering({ id: "k-drive", merchant: "Drivebutikk", driveWebViewLink: DRIVE }),
  ];

  function renderInnboks(skrivingAktiv: boolean) {
    const foer = structuredClone({ alle, transaksjoner, hendelser });
    const onUtfor = vi.fn().mockResolvedValue(undefined);
    render(
      <KvitteringsinnboksView
        alle={alle}
        aktive={aktiveKvitteringer(alle, hendelser)}
        transaksjoner={transaksjoner}
        hendelser={hendelser}
        poster={[]}
        skrivingAktiv={skrivingAktiv}
        onUtfor={onUtfor}
      />,
    );
    return { onUtfor, foer };
  }

  it.each([
    ["lesedetaljen", false],
    ["redigeringspanelet", true],
  ])("%s: bilde og nedlasting uten skriving og uten endret økonomi", async (_navn, skriving) => {
    const user = userEvent.setup();
    const { onUtfor, foer } = renderInnboks(skriving);

    await user.click(screen.getByText("Testbutikk"));
    const dialog = screen.getByRole("dialog");
    const bilde = await within(dialog).findByRole("img", { name: /Kvitteringsbilde/ });
    const lenke = within(dialog).getByRole("link", { name: /Last ned kvitteringsbilde/ });
    expect(bilde).toHaveAttribute("src", lenke.getAttribute("href"));
    expect(await lesBytes(blobs.get(lenke.getAttribute("href")!)!)).toEqual([...PNG]);
    // Skrivende panel har skjemaet; lesedetaljen har det ikke.
    expect(!!within(dialog).queryByLabelText("Leverandør")).toBe(skriving);

    // Både modalens lukkeknapp og panelets «Lukk» lukker; bruk panelets.
    await user.click(within(dialog).getAllByRole("button", { name: "Lukk" }).at(-1)!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(frigitt).toEqual(opprettet);

    // Gamle Drive-lenker består.
    await user.click(screen.getByText("Drivebutikk"));
    expect(
      within(screen.getByRole("dialog")).getByRole("link", { name: "Åpne bilde i Google Drive" }),
    ).toHaveAttribute("href", DRIVE);

    expect(onUtfor).not.toHaveBeenCalled();
    expect({ alle, transaksjoner, hendelser }).toEqual(foer);
  });
});
