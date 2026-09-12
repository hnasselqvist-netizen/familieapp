import { describe, expect, it } from "vitest";
import type { BankHendelse, BankTransaksjon, Kvittering } from "@app-types/gangen";
import {
  erKvitteringKlarForKobling,
  finnHendelseForTransaksjon,
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

describe("tellTrengerVurdering — 1:1-karakterisering av index.html", () => {
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

  it("ekskluderer transaksjoner som allerede har en koblet hendelse", () => {
    const t = transaksjon({ id: "t1" });
    const h = hendelse({ transaksjonId: "t1" });
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
