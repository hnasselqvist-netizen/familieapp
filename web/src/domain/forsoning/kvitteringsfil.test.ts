import { describe, expect, it } from "vitest";
import type { KvitteringFil, KvitteringRecord } from "@app-types/forsoning";
import { MAKS_FILBYTES, gjenkjennFiltype, medKvitteringsfil, validerFil } from "./kvitteringsfil";

const PDF = new TextEncoder().encode("%PDF-1.7\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const SVG = new TextEncoder().encode("<svg ");

const fil = (sha = "a"): KvitteringFil => ({
  sha256: sha.repeat(64),
  type: "application/pdf",
  storrelse: 9,
  filnavn: "k.pdf",
  lastetOpp: "2026-10-31T12:00:00Z",
  av: "Helen",
});

describe("klientvalidering (samme regel som tjenesten)", () => {
  it("godtar JPEG/PNG/WebP/PDF fra bytene, avviser SVG/HTML, tomt og for stort", () => {
    expect(gjenkjennFiltype(JPEG)).toBe("image/jpeg");
    expect(gjenkjennFiltype(PNG)).toBe("image/png");
    expect(gjenkjennFiltype(WEBP)).toBe("image/webp");
    expect(gjenkjennFiltype(PDF)).toBe("application/pdf");
    expect(validerFil(SVG, 5)).toEqual({ ok: false, feil: "ikke_stottet" });
    expect(validerFil(new TextEncoder().encode("<html>"), 6)).toEqual({
      ok: false,
      feil: "ikke_stottet",
    });
    expect(validerFil(PDF, 0)).toEqual({ ok: false, feil: "tom" });
    expect(validerFil(PDF, MAKS_FILBYTES + 1)).toEqual({ ok: false, feil: "for_stor" });
    expect(validerFil(PDF, MAKS_FILBYTES)).toEqual({ ok: true, type: "application/pdf" });
  });
});

describe("medKvitteringsfil: stabil id, idempotent, bevarer alt annet", () => {
  const receipts = (): KvitteringRecord[] => [
    { id: "k0", merchant: "Kiwi", total: 50 },
    {
      id: "k1",
      merchant: "Rema",
      total: 100,
      splits: [{ targetType: "budget", targetId: "mat", targetName: "Mat", amount: 100 }],
      hendelseId: "h1",
      imageUrl: "data:image/png;base64,AAAA",
      vedlegg: [fil("a")],
    },
  ];

  it("legger til på riktig kvittering uansett posisjon, og bevarer øvrige felt og kvitteringer", () => {
    const prev = receipts().reverse();
    const r = medKvitteringsfil(prev, "k1", fil("b"));
    expect(r.utfall).toBe("lagt_til");
    const k1 = r.neste.find((x) => x.id === "k1")!;
    expect(k1.vedlegg!.map((f) => f.sha256[0])).toEqual(["a", "b"]);
    expect(k1).toMatchObject({
      merchant: "Rema",
      total: 100,
      hendelseId: "h1",
      imageUrl: "data:image/png;base64,AAAA",
      splits: prev.find((x) => x.id === "k1")!.splits,
    });
    expect(r.neste.find((x) => x.id === "k0")).toBe(prev.find((x) => x.id === "k0"));
  });

  it("samme fil igjen (retry) endrer ingenting; manglende kvittering rapporteres", () => {
    const prev = receipts();
    const igjen = medKvitteringsfil(prev, "k1", { ...fil("a"), lastetOpp: "senere" });
    expect(igjen.utfall).toBe("fantes");
    expect(igjen.neste).toEqual(prev);
    expect(medKvitteringsfil(prev, "borte", fil("c"))).toEqual({
      neste: prev,
      utfall: "kvittering_mangler",
    });
  });
});
