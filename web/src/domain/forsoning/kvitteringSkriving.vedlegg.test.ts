/**
 * Review 5725857964 (#98, B1): en kvitteringsredigering som er forberedt fra
 * et eldre øyeblikksbilde, skal ikke fjerne filmetadata som er lagret i
 * mellomtiden. Testen bruker appens egne `oppdaterKvittering` og
 * `medKvitteringsfil`: redigeringen forberedes først, opplastingen skrives
 * imellom, så committes (og retries) redigeringen mot fersk verdi.
 */
import { describe, expect, it } from "vitest";
import type { HendelseRecord, KvitteringFil, KvitteringRecord } from "@app-types/forsoning";
import { oppdaterKvittering } from "./kvitteringSkriving";
import { medKvitteringsfil } from "./kvitteringsfil";

const NAA = "2026-11-01T01:00:00.000Z";
const fil = (c: string): KvitteringFil => ({
  sha256: c.repeat(64),
  type: "application/pdf",
  storrelse: 9,
  filnavn: `${c}.pdf`,
  lastetOpp: "2026-11-01T00:30:00Z",
  av: "Helen",
});
const splits = [{ targetType: "budget", targetId: "mat", targetName: "Mat", amount: 100 }];
const k1 = (o: Partial<KvitteringRecord> = {}) =>
  ({ id: "k1", merchant: "Old", total: 100, splits, ...o }) as unknown as KvitteringRecord;
const k2 = { id: "k2", merchant: "Kiwi", total: 50 } as unknown as KvitteringRecord;

/** Redigering forberedt fra `snap`, så opplasting av `filer` imellom, så commit. */
const redigerMedOpplastingImellom = (
  start: KvitteringRecord[],
  felter: Partial<KvitteringRecord>,
  filer: KvitteringFil[],
  hendelser: HendelseRecord[] = [],
) => {
  const utfall = oppdaterKvittering({ receipts: start, hendelser }, "k1", felter, NAA)!;
  expect(utfall.feil).toBeNull();
  const fersk = filer.reduce((prev, f) => medKvitteringsfil(prev, "k1", f).neste, start);
  return { utfall, fersk, etter: utfall.endring!.receipts!(fersk) };
};

describe("oppdaterKvittering bevarer samtidig lagrede vedlegg", () => {
  it("reviewens repro: vedlegg lagret etter at redigeringen ble forberedt, beholdes", () => {
    const { etter } = redigerMedOpplastingImellom([k1()], { merchant: "New" }, [fil("a")]);
    expect(etter).toEqual([{ ...k1(), merchant: "New", updatedAt: NAA, vedlegg: [fil("a")] }]);
  });

  it("gamle OG nye vedlegg består; andre felt og kvitteringer er uendret", () => {
    const start = [k2, k1({ vedlegg: [fil("a")] })];
    const { etter } = redigerMedOpplastingImellom(start, { merchant: "New", total: 120 }, [
      fil("b"),
    ]);
    expect(etter[0]).toBe(k2);
    expect(etter[1]).toEqual({
      ...k1(),
      merchant: "New",
      total: 120,
      updatedAt: NAA,
      vedlegg: [fil("a"), fil("b")],
    });
  });

  it("retry mot ny fersk verdi (RTDB-transaksjon kjøres på nytt) beholder alle vedlegg", () => {
    const start = [k1({ vedlegg: [fil("a")] })];
    const utfall = oppdaterKvittering(
      { receipts: start, hendelser: [] },
      "k1",
      { merchant: "New" },
      NAA,
    )!;
    const oppdater = utfall.endring!.receipts!;
    // Første forsøk mot lokal (foreldet) verdi, så mot server med ny fil.
    expect(oppdater(start)[0]!.vedlegg).toEqual([fil("a")]);
    const server = medKvitteringsfil(start, "k1", fil("b")).neste;
    const andreForsok = oppdater(server);
    expect(andreForsok[0]).toMatchObject({ merchant: "New", vedlegg: [fil("a"), fil("b")] });
    // Idempotent: samme updater på eget resultat endrer ingenting.
    expect(oppdater(andreForsok)).toEqual(andreForsok);
  });

  it("forkasting bevarer også vedlegg lagret imellom", () => {
    const { etter } = redigerMedOpplastingImellom(
      [k1()],
      { forkastet: true } as Partial<KvitteringRecord>,
      [fil("a")],
    );
    expect(etter[0]).toMatchObject({ forkastet: true, vedlegg: [fil("a")] });
  });

  it("koblet kvittering: hendelsens økonomi er den samme med og uten opplasting imellom", () => {
    const hendelser = [
      { id: "h1", status: "ferdig", receiptId: "k1", transaksjonId: "t1", fordelinger: [] },
    ] as unknown as HendelseRecord[];
    const start = [k1({ hendelseId: "h1" })];
    const felter = {
      splits: [
        { ...splits[0], amount: 80 },
        { ...splits[0], targetId: "x", amount: 20 },
      ],
    } as Partial<KvitteringRecord>;
    const uten = oppdaterKvittering({ receipts: start, hendelser }, "k1", felter, NAA)!;
    const { utfall, etter } = redigerMedOpplastingImellom(start, felter, [fil("a")], hendelser);
    expect(utfall.endring!.hendelser!(hendelser)).toEqual(uten.endring!.hendelser!(hendelser));
    expect(etter[0]).toEqual({ ...uten.endring!.receipts!(start)[0], vedlegg: [fil("a")] });
  });

  it("uten vedlegg noe sted legges ingen vedlegg-nøkkel til", () => {
    const utfall = oppdaterKvittering(
      { receipts: [k1()], hendelser: [] },
      "k1",
      { merchant: "New" },
      NAA,
    )!;
    expect(utfall.endring!.receipts!([k1()])[0]).not.toHaveProperty("vedlegg");
  });
});
