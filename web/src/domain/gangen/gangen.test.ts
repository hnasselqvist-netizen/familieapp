import { describe, expect, it } from "vitest";
import { arbeidsko } from "@domain/forsoning/transaksjonsoversikt";
import type { HendelseRecord, TransaksjonRecord } from "@app-types/forsoning";
import type { BankHendelse, BankTransaksjon, Kvittering } from "@app-types/gangen";
import {
  erKvitteringKlarForKobling,
  finnHendelseForTransaksjon,
  tellForslagTilMatch,
  tellKvitteringerKlareForKobling,
  tellTrengerVurdering,
} from "./gangen";

function transaksjon(overrides: Partial<BankTransaksjon> = {}): BankTransaksjon {
  return { id: "t1", status: "ubehandlet", ...overrides };
}

function hendelse(overrides: Partial<BankHendelse> = {}): BankHendelse {
  return { id: "h1", transaksjonId: null, receiptId: null, ...overrides };
}

function kvittering(overrides: Partial<Kvittering> = {}): Kvittering {
  return { id: "r1", matchingStatus: "unmatched", suggestedTransactionId: null, ...overrides };
}

describe("finnHendelseForTransaksjon", () => {
  it("returnerer null uten transaksjonId", () => {
    expect(finnHendelseForTransaksjon([hendelse({ transaksjonId: "t1" })], null)).toBeNull();
  });

  it("finner hendelsen koblet til transaksjonen", () => {
    const h = hendelse({ transaksjonId: "t1" });
    expect(finnHendelseForTransaksjon([h], "t1")).toBe(h);
  });

  it("returnerer null uten treff", () => {
    expect(finnHendelseForTransaksjon([hendelse({ transaksjonId: "t2" })], "t1")).toBeNull();
  });
});

describe("tellTrengerVurdering — legacy-grunnlaget (§index.html linje 2480-2485)", () => {
  it("teller en ubehandlet transaksjon uten hendelse", () => {
    expect(tellTrengerVurdering([transaksjon()], [])).toBe(1);
  });

  it("ekskluderer ignorerte transaksjoner", () => {
    expect(tellTrengerVurdering([transaksjon({ status: "ignorert" })], [])).toBe(0);
  });

  it("ekskluderer interne overføringer", () => {
    expect(tellTrengerVurdering([transaksjon({ behandlingstype: "intern_overforing" })], [])).toBe(
      0,
    );
  });

  it("ekskluderer transaksjoner med en ferdig plassert hendelse", () => {
    const t = transaksjon({ id: "t1" });
    const h = hendelse({ transaksjonId: "t1", status: "ferdig" });
    expect(tellTrengerVurdering([t], [h])).toBe(0);
  });

  it('ekskluderer status "matchet" (propagert treff, ikke uvurdert)', () => {
    expect(tellTrengerVurdering([transaksjon({ status: "matchet" })], [])).toBe(0);
  });

  it("teller flere kvalifiserende transaksjoner", () => {
    expect(tellTrengerVurdering([transaksjon({ id: "t1" }), transaksjon({ id: "t2" })], [])).toBe(
      2,
    );
  });

  it("teller et forslag til match én gang", () => {
    expect(tellTrengerVurdering([transaksjon({ status: "foresoatt_match" })], [])).toBe(1);
  });
});

describe("tellTrengerVurdering — samme tall som Forvaltning-forsiden (#59)", () => {
  it("bevisst avvik: en uplassert hendelse venter fortsatt på vurdering", () => {
    const t = transaksjon({ id: "t1" });
    const h = hendelse({ transaksjonId: "t1", status: "uplassert" });
    expect(tellTrengerVurdering([t], [h])).toBe(1);
  });

  it("«på vent» er brukerens egen beslutning og telles ikke", () => {
    const t = transaksjon({ id: "t1" });
    const h = hendelse({ transaksjonId: "t1", status: "pa_vent" });
    expect(tellTrengerVurdering([t], [h])).toBe(0);
  });

  it("er lik «Krever vurdering» + «Forslag til match» i arbeidskøen", () => {
    const statuser = ["ubehandlet", "krever_vurdering", "foresoatt_match", "matchet", "ignorert"];
    const hendelsesstatuser = [undefined, "ferdig", "pa_vent", "uplassert"] as const;
    const transaksjoner: BankTransaksjon[] = [];
    const hendelser: BankHendelse[] = [];
    let n = 0;
    for (const status of statuser) {
      for (const intern of [false, true]) {
        for (const hs of hendelsesstatuser) {
          const id = `t${n++}`;
          transaksjoner.push(
            transaksjon({
              id,
              status,
              ...(intern ? { behandlingstype: "intern_overforing" } : {}),
            }),
          );
          if (hs) hendelser.push(hendelse({ id: `h${id}`, transaksjonId: id, status: hs }));
        }
      }
    }
    const ko = arbeidsko(
      transaksjoner as unknown as TransaksjonRecord[],
      hendelser as unknown as HendelseRecord[],
      [],
    );
    expect(ko.vurdering.length + ko.forslag.length).toBeGreaterThan(0);
    expect(tellTrengerVurdering(transaksjoner, hendelser)).toBe(
      ko.vurdering.length + ko.forslag.length,
    );
  });
});

describe("erKvitteringKlarForKobling — låst korrigering (§Kontrolltårn-handoff, Issue #20)", () => {
  it('er klar når matchingStatus er "suggested" med et konkret forslag', () => {
    expect(
      erKvitteringKlarForKobling(
        kvittering({ matchingStatus: "suggested", suggestedTransactionId: "t1" }),
      ),
    ).toBe(true);
  });

  it('er IKKE klar når matchingStatus fortsatt er "unmatched" — ingen konkret beslutning å ta ennå', () => {
    expect(erKvitteringKlarForKobling(kvittering({ matchingStatus: "unmatched" }))).toBe(false);
  });

  it('er IKKE klar når kvitteringen allerede er "matched" — koblingen er allerede gjort', () => {
    expect(
      erKvitteringKlarForKobling(
        kvittering({ matchingStatus: "matched", suggestedTransactionId: "t1" }),
      ),
    ).toBe(false);
  });

  it("er IKKE klar når kvitteringen er forkastet, selv med et forslag liggende", () => {
    expect(
      erKvitteringKlarForKobling(
        kvittering({ matchingStatus: "suggested", suggestedTransactionId: "t1", forkastet: true }),
      ),
    ).toBe(false);
  });

  it('er IKKE klar hvis "suggested" mangler en faktisk suggestedTransactionId (forsvarlig mot uventet data)', () => {
    expect(
      erKvitteringKlarForKobling(
        kvittering({ matchingStatus: "suggested", suggestedTransactionId: null }),
      ),
    ).toBe(false);
  });
});

describe("tellKvitteringerKlareForKobling", () => {
  it("teller kun kvitteringer som faktisk er klare for kobling", () => {
    const klar = kvittering({
      id: "r1",
      matchingStatus: "suggested",
      suggestedTransactionId: "t1",
    });
    const ikkeKlar = kvittering({ id: "r2", matchingStatus: "unmatched" });
    const forkastetKlar = kvittering({
      id: "r3",
      matchingStatus: "suggested",
      suggestedTransactionId: "t2",
      forkastet: true,
    });
    expect(tellKvitteringerKlareForKobling([klar, ikkeKlar, forkastetKlar])).toBe(1);
  });
});

describe("tellForslagTilMatch", () => {
  it("teller det samme som arbeidskøens «Forslag til match»", () => {
    const transaksjoner = [
      transaksjon({ id: "a", status: "foresoatt_match" }),
      transaksjon({ id: "b", status: "ubehandlet" }),
      transaksjon({ id: "c", status: "foresoatt_match" }),
      transaksjon({ id: "d", status: "ignorert" }),
    ];
    const ko = arbeidsko(transaksjoner as unknown as TransaksjonRecord[], [], []);
    expect(tellForslagTilMatch(transaksjoner, [])).toBe(ko.forslag.length);
    expect(tellForslagTilMatch(transaksjoner, [])).toBe(2);
  });

  it("et godkjent (plassert) eller ventende forslag teller ikke (#66)", () => {
    const transaksjoner = [
      transaksjon({ id: "a", status: "foresoatt_match" }),
      transaksjon({ id: "b", status: "foresoatt_match" }),
      transaksjon({ id: "c", status: "foresoatt_match" }),
    ];
    const hendelser = [
      hendelse({ id: "hb", transaksjonId: "b", status: "ferdig" }),
      hendelse({ id: "hc", transaksjonId: "c", status: "pa_vent" }),
    ];
    const ko = arbeidsko(
      transaksjoner as unknown as TransaksjonRecord[],
      hendelser as unknown as HendelseRecord[],
      [],
    );
    expect(tellForslagTilMatch(transaksjoner, hendelser)).toBe(ko.forslag.length);
    expect(tellForslagTilMatch(transaksjoner, hendelser)).toBe(1);
    expect(tellTrengerVurdering(transaksjoner, hendelser)).toBe(1);
  });
});
