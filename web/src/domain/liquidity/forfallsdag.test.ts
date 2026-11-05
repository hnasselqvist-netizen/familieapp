/**
 * Funn F (#59, ordre 6665182330): streng forfallsdag ved lagring,
 * generatorens uendrede tolkning, og diagnostikk for eksisterende
 * automatiske kilder uten gyldig dag. Syntetiske data. Generatorens
 * tolkning kontrolleres mot legacy `generateForecastPosts` (ordrett fra
 * `index.html`), så diagnostikken aldri påstår noe annet enn det begge
 * klientene faktisk gjør. Kjøres i både UTC og Europe/Oslo.
 */
import { describe, expect, it } from "vitest";
import type { ForecastGroup } from "@app-types/liquidity";
import {
  FORFALLSDAG_FEIL,
  finnForfallsdagMangler,
  forfallsdagFeil,
  tolkForfallsdag,
} from "./forfallsdag";

describe("tolkForfallsdag: entydig heltallsdag 1–31", () => {
  it.each([
    ["1", 1],
    ["31", 31],
    [" 15 ", 15],
    ["01", 1],
    [1, 1],
    [31, 31],
  ])("%j → %d", (verdi, dag) => expect(tolkForfallsdag(verdi)).toBe(dag));

  it.each([
    "",
    " ",
    "0",
    "00",
    "32",
    "1.5",
    "1,5",
    "15abc",
    "abc",
    "-1",
    "+5",
    "1e1",
    "100",
    0,
    32,
    1.5,
    Number.NaN,
    null,
    undefined,
    true,
  ])("%j → null", (verdi) => expect(tolkForfallsdag(verdi)).toBeNull());
});

describe("forfallsdagFeil: kreves bare når automatikk er på", () => {
  it.each(["", "0", "32", "1.5", "15abc", undefined])("automatisk + %j → feil", (dag) =>
    expect(forfallsdagFeil({ automatisk: true, forfallsdag: dag })).toBe(FORFALLSDAG_FEIL),
  );
  it.each(["1", "31"])("automatisk + %j → ok", (dag) =>
    expect(forfallsdagFeil({ automatisk: true, forfallsdag: dag })).toBeNull(),
  );
  it.each(["", undefined, "32"])("automatikk av + %j → ok (ingen påtvunget dag)", (dag) =>
    expect(forfallsdagFeil({ automatisk: false, forfallsdag: dag })).toBeNull(),
  );
});

const tolv = (b: number) => Array.from({ length: 12 }, () => ({ budget: b, spent: 0 }));
const kilde = (id: string, forfallsdag: unknown, automatisk = true) => ({
  id,
  name: `Post ${id}`,
  meta: { automatisk, forfallsdag, oppforsel: "fast" },
  months: tolv(100),
});
const gr = (id: string, ...items: ReturnType<typeof kilde>[]) =>
  ({ id, label: id, items }) as unknown as ForecastGroup;
// ── Diagnostikk ─────────────────────────────────────────────────────────
describe("finnForfallsdagMangler", () => {
  it("bare automatiske kilder uten gyldig dag, for alle tre typer, med type/gruppe/ID", () => {
    const m = finnForfallsdagMangler({
      budgetGroups: [
        gr("bolig", kilde("husleie", ""), kilde("strom", "15"), kilde("tv", "", false)),
      ],
      incomeGroups: [gr("lonn", kilde("lonn", "0"), kilde("bonus", "31"))],
      sparingGroups: [gr("buffer", kilde("buf", "15abc"), kilde("ferie", undefined, false))],
    });
    expect(m).toEqual([
      {
        type: "inntekter",
        gruppeId: "lonn",
        gruppeNavn: "Lønn",
        iOkonomi: true,
        postId: "lonn",
        postNavn: "Post lonn",
        verdi: "0",
        status: "utelatt",
      },
      {
        type: "kostnader",
        gruppeId: "bolig",
        gruppeNavn: "Bolig",
        iOkonomi: true,
        postId: "husleie",
        postNavn: "Post husleie",
        verdi: "",
        status: "utelatt",
      },
      {
        type: "sparing",
        gruppeId: "buffer",
        gruppeNavn: expect.any(String) as string,
        iOkonomi: true,
        postId: "buf",
        postNavn: "Post buf",
        verdi: "15abc",
        status: "tolket",
      },
    ]);
  });

  it("samme ID og navn i ulike grupper og domener er egne rader", () => {
    const m = finnForfallsdagMangler({
      budgetGroups: [gr("bolig", kilde("x", "")), gr("transport", kilde("x", ""))],
      incomeGroups: [gr("lonn", kilde("x", ""))],
      sparingGroups: [gr("buffer", kilde("x", "")), gr("buffer2", kilde("x", "5"))],
    });
    expect(m.map((r) => `${r.type}/${r.gruppeId}/${r.postId}`)).toEqual([
      "inntekter/lonn/x",
      "kostnader/bolig/x",
      "kostnader/transport/x",
      "sparing/buffer/x",
    ]);
  });

  it("ukjent gruppe-ID: vises med ID som navn og markeres som ikke i Økonomi", () => {
    const [m] = finnForfallsdagMangler({
      budgetGroups: [gr("egen_gruppe", kilde("x", ""))],
      incomeGroups: [],
      sparingGroups: [],
    });
    expect(m).toMatchObject({ gruppeNavn: "egen_gruppe", iOkonomi: false });
  });

  it("ingen mangler, tomme grupper og poster uten meta gir tom liste", () => {
    expect(
      finnForfallsdagMangler({
        budgetGroups: [gr("bolig", kilde("a", "1"), kilde("b", "31"))],
        incomeGroups: [{ id: "lonn", label: "lonn", items: [] }],
        sparingGroups: [
          { id: "buffer", label: "buffer", items: [{ id: "u", name: "U", months: [] }] },
        ] as unknown as ForecastGroup[],
      }),
    ).toEqual([]);
  });
});
