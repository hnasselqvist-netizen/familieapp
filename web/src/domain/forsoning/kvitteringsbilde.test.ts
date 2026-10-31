import { describe, expect, it } from "vitest";
import {
  MAKS_BASE64_LENGDE,
  MAKS_BILDE_BYTES,
  filnavnForKvitteringsbilde,
  tolkKvitteringsbilde,
} from "./kvitteringsbilde";

/** Base64 i biter, så også et stort bilde kodes med nettleserens `btoa`. */
const tilBase64 = (bytes: ArrayLike<number>) => {
  const alle = Array.from(bytes);
  let s = "";
  for (let i = 0; i < alle.length; i += 0x8000) {
    s += String.fromCharCode(...alle.slice(i, i + 0x8000));
  }
  return btoa(s);
};
const asciiBytes = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Syntetiske bytes med riktig signatur, aldri ekte kvitteringer. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0];
const GIF = [...asciiBytes("GIF89a"), 1, 0, 1, 0];
const WEBP = [...asciiBytes("RIFF"), 4, 0, 0, 0, ...asciiBytes("WEBPVP8 ")];

const dataUrl = (type: string, bytes: number[] | Uint8Array) =>
  `data:${type};base64,${tilBase64(bytes)}`;

describe("tolkKvitteringsbilde", () => {
  it.each([
    ["image/png", PNG, "png"],
    ["image/jpeg", JPEG, "jpg"],
    ["image/gif", GIF, "gif"],
    ["image/webp", WEBP, "webp"],
  ])("godtar %s og gir de samme bytene tilbake", (type, bytes, ext) => {
    const t = tolkKvitteringsbilde(dataUrl(type, bytes));
    expect(t).toMatchObject({ status: "ok", type, filendelse: ext });
    if (t.status !== "ok") throw new Error("forventet ok");
    expect([...t.bytes]).toEqual([...bytes]);
  });

  it.each([undefined, null, ""])("mangler når feltet er %p", (v) => {
    expect(tolkKvitteringsbilde(v)).toEqual({ status: "mangler" });
  });

  it.each([
    ["SVG", dataUrl("image/svg+xml", asciiBytes("<svg onload=alert(1)>")), "ikke_tillatt_type"],
    ["HTML", dataUrl("text/html", asciiBytes("<script>x</script>")), "ikke_tillatt_type"],
    ["PDF", dataUrl("application/pdf", asciiBytes("%PDF-1.7")), "ikke_tillatt_type"],
    ["store bokstaver i typen", dataUrl("IMAGE/PNG", PNG), "ikke_tillatt_type"],
    ["typeparametre", `data:image/png;charset=x;base64,${tilBase64(PNG)}`, "ikke_tillatt_type"],
    ["https-URL", "https://example.test/k.png", "ugyldig_format"],
    ["javascript-URI", "javascript:alert(1)", "ugyldig_format"],
    ["blob-URL", "blob:https://example.test/x", "ugyldig_format"],
    ["data-URL uten base64", "data:image/png,%89PNG", "ugyldig_format"],
    ["data-URL uten komma", "data:image/png;base64", "ugyldig_format"],
    ["tall", 42, "ugyldig_format"],
    ["objekt", { src: "x" }, "ugyldig_format"],
    ["tom base64", "data:image/png;base64,", "ugyldig_base64"],
    ["feil lengde", "data:image/png;base64,iVBORw0", "ugyldig_base64"],
    ["ulovlige tegn", "data:image/png;base64,iVBO Rw0K", "ugyldig_base64"],
    ["base64url-alfabet", "data:image/png;base64,iVBO-w0_", "ugyldig_base64"],
    ["utfylling midt i", "data:image/png;base64,iV==Rw0K", "ugyldig_base64"],
    ["falsk PNG (HTML-bytes)", dataUrl("image/png", asciiBytes("<html><body>x")), "signatur_avvik"],
    ["JPEG merket som PNG", dataUrl("image/png", JPEG), "signatur_avvik"],
    ["for kort til signatur", dataUrl("image/png", [0x89, 0x50]), "signatur_avvik"],
  ])("avviser %s", (_navn, verdi, grunn) => {
    expect(tolkKvitteringsbilde(verdi)).toEqual({ status: "avvist", grunn });
  });

  it("dekoder et bilde på grensen, men avviser én base64-blokk over FØR dekoding", () => {
    const paGrensen = new Uint8Array(MAKS_BILDE_BYTES);
    paGrensen.set(PNG);
    const ok = tolkKvitteringsbilde(dataUrl("image/png", paGrensen));
    expect(ok.status).toBe("ok");
    if (ok.status === "ok") expect(ok.bytes.length).toBe(MAKS_BILDE_BYTES);

    // Lengden alene avgjør: innholdet etter prefikset er ikke engang base64.
    const forStor = `data:image/png;base64,${"!".repeat(MAKS_BASE64_LENGDE + 4)}`;
    expect(tolkKvitteringsbilde(forStor)).toEqual({ status: "avvist", grunn: "for_stort" });
  });
});

describe("filnavnForKvitteringsbilde", () => {
  it("lager et generert navn med dato, kort id og filendelse", () => {
    expect(filnavnForKvitteringsbilde({ id: "r-abc123", purchaseDate: "2026-09-12" }, "jpg")).toBe(
      "kvittering-2026-09-12-r-abc123.jpg",
    );
  });

  it("renser id og dato og tåler at de mangler", () => {
    expect(
      filnavnForKvitteringsbilde(
        { id: "../../x<y>/zzzzzzzzzzzzzzzz", purchaseDate: "i går" },
        "png",
      ),
    ).toBe("kvittering-uten-dato-xyzzzzzzzzzz.png");
    expect(filnavnForKvitteringsbilde({}, "gif")).toBe("kvittering-uten-dato.gif");
  });
});
