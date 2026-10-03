/**
 * Differensiell test: `klassifiserFortegn` mot legacy
 * `kjorFortegnsRecoveryDrivstoffRabatt`, trukket ORDRETT ut av `index.html`
 * (kun lesing) og kjørt side om side på samme hendelser. Legacy-raden
 * oversettes til klassifiseringen (korrigert → trenger_retting), og
 * legacy sin nye hendelsesliste brukes til å bekrefte at «trenger_retting»
 * er nøyaktig de radene recovery ville endret.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORTEGN_RECOVERY_MAAL,
  FORTEGN_RECOVERY_PLASSERING_ID,
  FORTEGN_RECOVERY_REGEL_ID,
  type FortegnStatus,
  klassifiserFortegn,
} from "./fortegn";

const SRC = readFileSync(path.resolve(import.meta.dirname, "../../../index.html"), "utf8");
const BLOKK = (() => {
  const start = SRC.indexOf("const FORTEGN_RECOVERY_MAAL = [");
  const slutt = SRC.indexOf("const INIT_INCOME_MONTHS", start);
  if (start < 0 || slutt < 0) throw new Error("Fant ikke fortegns-recovery i legacy");
  return SRC.slice(start, slutt);
})();

interface LegacyRad {
  id: string;
  handling: "korrigert" | "allerede_korrekt" | "hoppet_over";
  grunn?: string;
  belop?: number;
  fra?: number;
  til?: number;
}
const legacy = new Function(
  `"use strict";\n${BLOKK}\nreturn { kjorFortegnsRecoveryDrivstoffRabatt, FORTEGN_RECOVERY_MAAL, FORTEGN_RECOVERY_REGEL_ID, FORTEGN_RECOVERY_PLASSERING_ID };`,
)() as {
  kjorFortegnsRecoveryDrivstoffRabatt: (h: unknown[]) => {
    nyeHendelser: unknown[];
    resultat: LegacyRad[];
  };
  FORTEGN_RECOVERY_MAAL: unknown;
  FORTEGN_RECOVERY_REGEL_ID: string;
  FORTEGN_RECOVERY_PLASSERING_ID: string;
};

function somKlassifisering(rader: LegacyRad[]): FortegnStatus[] {
  const ut: FortegnStatus[] = rader.map((r) => {
    if (r.handling === "korrigert") {
      return { id: r.id, resultat: "trenger_retting", belop: r.fra, rettetBelop: r.til };
    }
    if (r.handling === "allerede_korrekt")
      return { id: r.id, resultat: "allerede_korrekt", belop: r.belop };
    return { id: r.id, resultat: "hoppet_over", grunn: r.grunn };
  });
  for (const m of FORTEGN_RECOVERY_MAAL) {
    if (!ut.some((r) => r.id === m.id)) ut.push({ id: m.id, resultat: "finnes_ikke" });
  }
  return ut;
}

const feil = (
  m: (typeof FORTEGN_RECOVERY_MAAL)[number],
  o: Record<string, unknown> = {},
  f: Record<string, unknown> = {},
) => ({
  id: m.id,
  status: "ferdig",
  transaksjonId: m.transaksjonId,
  regelId: FORTEGN_RECOVERY_REGEL_ID,
  receiptId: null,
  fordelinger: [
    {
      plasseringId: FORTEGN_RECOVERY_PLASSERING_ID,
      plasseringType: "budget",
      plasseringNavn: "Drivstoff og lading",
      belop: m.forventetBelop,
      eiere: [{ person: "Helen", prosent: 100 }],
      ...f,
    },
  ],
  ...o,
});
const [A, B] = FORTEGN_RECOVERY_MAAL;
const annen = { id: "annen", status: "ferdig", transaksjonId: "x", regelId: null, fordelinger: [] };
const fordeling = (m: typeof A) => feil(m).fordelinger[0]!;

const scenarier: [string, unknown[]][] = [
  ["begge feil-signert (trenger retting)", [annen, feil(A), feil(B)]],
  [
    "begge allerede korrekt",
    [feil(A, {}, { belop: -A.forventetBelop }), feil(B, {}, { belop: -B.forventetBelop })],
  ],
  ["én korrekt, én feil", [feil(A, {}, { belop: -A.forventetBelop }), feil(B)]],
  ["ingen av dem finnes", [annen]],
  ["tom liste", []],
  ["bare B finnes", [feil(B)]],
  ["feil transaksjonId", [feil(A, { transaksjonId: "noe-annet" }), feil(B)]],
  ["regelId fjernet (korrigert manuelt)", [feil(A, { regelId: null }), feil(B)]],
  ["to fordelinger", [feil(A, { fordelinger: [fordeling(A), fordeling(A)] }), feil(B)]],
  ["ingen fordelinger", [feil(A, { fordelinger: [] }), feil(B, { fordelinger: undefined })]],
  ["annen post", [feil(A, {}, { plasseringId: "drivstoff_eivind" }), feil(B)]],
  ["income-plassering", [feil(A, {}, { plasseringType: "income" }), feil(B)]],
  ["annet beløp", [feil(A, {}, { belop: 12 }), feil(B, {}, { belop: "1" })]],
  ["duplikat av samme id", [feil(A), feil(A, {}, { belop: -A.forventetBelop }), feil(B)]],
];

describe("klassifiserFortegn ≡ legacy kjorFortegnsRecoveryDrivstoffRabatt", () => {
  it("konstantene er de samme som i legacy", () => {
    expect(legacy.FORTEGN_RECOVERY_MAAL).toEqual(FORTEGN_RECOVERY_MAAL);
    expect(legacy.FORTEGN_RECOVERY_REGEL_ID).toBe(FORTEGN_RECOVERY_REGEL_ID);
    expect(legacy.FORTEGN_RECOVERY_PLASSERING_ID).toBe(FORTEGN_RECOVERY_PLASSERING_ID);
  });

  it.each(scenarier)("%s", (_navn, hendelser) => {
    const foer = JSON.stringify(hendelser);
    const L = legacy.kjorFortegnsRecoveryDrivstoffRabatt(structuredClone(hendelser));
    const vaar = klassifiserFortegn(hendelser);
    expect(vaar).toEqual(somKlassifisering(L.resultat));
    // «trenger_retting» er nøyaktig de hendelsene legacy-recovery ville endret.
    const endret = (L.nyeHendelser as Record<string, unknown>[]).filter(
      (h, i) => JSON.stringify(h) !== JSON.stringify(hendelser[i]),
    );
    expect(endret.length).toBe(vaar.filter((r) => r.resultat === "trenger_retting").length);
    // Klassifiseringen skriver ingenting.
    expect(JSON.stringify(hendelser)).toBe(foer);
  });

  it("dekker alle fire utfall", () => {
    const utfall = new Set(
      scenarier.flatMap(([, h]) => klassifiserFortegn(h).map((r) => r.resultat)),
    );
    expect([...utfall].sort()).toEqual([
      "allerede_korrekt",
      "finnes_ikke",
      "hoppet_over",
      "trenger_retting",
    ]);
  });
});
