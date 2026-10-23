/**
 * Overgangsverktøy for handlelisten (ADR 0003, FORSLAG — #77 review
 * 6356624432 pkt. 3). To operasjoner på `families/{f}/shopping`:
 *
 *  - `kontrollerHandleliste`: skrivefri kontroll. Bare tellinger, ja/nei og
 *    en digest — aldri navn, mengder eller andre verdier fra listen.
 *  - `planMarkor` + `kjorMarkor`: idempotent markørsteg (`sett`/`fjern`) i én
 *    transaksjon på hele noden. Alle andre rådata bevares byte-likt.
 *
 * Sikkerhetsegenskaper (alle testet, også mot emulatoren):
 *  - Tørrkjøring er standard; bare `apply` skriver.
 *  - En eksisterende markør som avviker fra det avtalte formatet overskrives
 *    eller fjernes ALDRI. Ugyldig form (primitiv verdi) gir avslag.
 *  - Med `forventetDigest` (fra en kontroll) skrives ingenting hvis listen
 *    er endret siden: avvik betyr «undersøk», aldri automatisk gjenoppretting.
 *  - Transaksjonen returnerer alltid en konkret verdi (aldri `undefined`),
 *    så en kald cache aldri gir en beslutning tatt mot feil tilstand.
 *  - Etter skriving leses noden på nytt; avvik rapporteres, rettes aldri.
 *
 * Ingen produksjonskjøring er besluttet. CLI-en (`handlelisteOvergangCli.ts`)
 * har samme produksjonsvern som `add-member`.
 */
import {
  type Handlelistekontroll,
  HANDLELISTE_MARKOR,
  MARKOR_NOKKEL,
  kontrollerHandleliste,
  oppforinger,
} from "../handleliste/overgangKontroll";
import { assertSafeFamilyId, shoppingPath } from "../store/paths";

// Den rene kontrollen bor i handleliste/ (delt med MCP-verktøyet).
export {
  type Handlelistekontroll,
  HANDLELISTE_MARKOR,
  MARKOR_NOKKEL,
  erMarkor,
  kanonisk,
  kontrollerHandleliste,
} from "../handleliste/overgangKontroll";

export type MarkorModus = "sett" | "fjern";
export type MarkorPlan =
  { utfall: "skriv"; neste: unknown } | { utfall: "allerede" } | { utfall: "nekt"; grunn: string };

/** Ren beslutning mot DENNE verdien av noden. */
export function planMarkor(raw: unknown, modus: MarkorModus, forventetDigest?: string): MarkorPlan {
  const k = kontrollerHandleliste(raw);
  if (!k.strukturOk) {
    return { utfall: "nekt", grunn: "Handlelisten har ugyldig form. Ingenting skrives." };
  }
  if (forventetDigest !== undefined && k.digestUtenMarkor !== forventetDigest) {
    return {
      utfall: "nekt",
      grunn:
        "Handlelisten er endret siden kontrollen (digest avviker). Undersøk; ingenting skrives eller gjenopprettes.",
    };
  }
  if (k.markor === "feil") {
    return {
      utfall: "nekt",
      grunn: "Det finnes en avvikende markør. Den overskrives eller fjernes ikke.",
    };
  }
  const rest = Object.fromEntries(oppforinger(raw).filter(([key]) => key !== MARKOR_NOKKEL));
  if (modus === "sett") {
    if (k.markor === "ok") return { utfall: "allerede" };
    return { utfall: "skriv", neste: { ...rest, [MARKOR_NOKKEL]: { ...HANDLELISTE_MARKOR } } };
  }
  if (k.markor === "mangler") return { utfall: "allerede" };
  // Uten markør kan legacy igjen skrive hele noden; det skal aldri skje mens
  // sammenslåingshistorikk finnes eller er uavklart (vurdert i SAMME
  // transaksjon, så et gammelt kontrollresultat aldri åpner for fjerning).
  if (k.antallSammenslatt > 0 || k.antallHistorikkUavklart > 0) {
    return {
      utfall: "nekt",
      grunn: `Handlelisten har sammenslåingshistorikk (${k.antallSammenslatt} sammenslåtte, ${k.antallHistorikkUavklart} uavklarte). Markøren fjernes ikke.`,
    };
  }
  return { utfall: "skriv", neste: Object.keys(rest).length > 0 ? rest : null };
}

/** Kun det utføreren trenger av databasen (admin-SDK i produksjon/emulator). */
export interface OvergangDb {
  read(path: string): Promise<unknown>;
  /** Transaksjon på `path`. `update` returnerer alltid en konkret verdi. */
  transact(path: string, update: (current: unknown) => unknown): Promise<void>;
}

export async function kjorKontroll(db: OvergangDb, familyId: string) {
  const path = shoppingPath(assertSafeFamilyId(familyId));
  return { familyId, path, kontroll: kontrollerHandleliste(await db.read(path)) };
}

export interface MarkorResultat {
  familyId: string;
  modus: MarkorModus;
  dryRun: boolean;
  utfall: MarkorPlan["utfall"];
  grunn?: string;
  foer: Handlelistekontroll;
  etter?: Handlelistekontroll;
  /** Tomt når alt stemmer. Avvik betyr «stopp og undersøk» — aldri gjenopprett. */
  avvik: string[];
}

export async function kjorMarkor(
  db: OvergangDb,
  req: { familyId: string; modus: MarkorModus; apply: boolean; forventetDigest?: string },
): Promise<MarkorResultat> {
  const path = shoppingPath(assertSafeFamilyId(req.familyId));
  const raw = await db.read(path);
  const foer = kontrollerHandleliste(raw);
  const plan = planMarkor(raw, req.modus, req.forventetDigest);
  const base = {
    familyId: req.familyId,
    modus: req.modus,
    foer,
    ...(plan.utfall === "nekt" ? { grunn: plan.grunn } : {}),
  };
  if (!req.apply || plan.utfall !== "skriv") {
    return { ...base, dryRun: !req.apply, utfall: plan.utfall, avvik: [] };
  }

  let siste: { plan: MarkorPlan; digest: string } | undefined;
  await db.transact(path, (current) => {
    const p = planMarkor(current, req.modus, req.forventetDigest);
    siste = { plan: p, digest: kontrollerHandleliste(current).digestUtenMarkor };
    return p.utfall === "skriv" ? p.neste : (current ?? null);
  });
  const etter = kontrollerHandleliste(await db.read(path));
  const avvik: string[] = [];
  const endelig = siste!.plan;
  if (endelig.utfall === "skriv") {
    const forventetMarkor = req.modus === "sett" ? "ok" : "mangler";
    if (etter.markor !== forventetMarkor) avvik.push(`Markør er «${etter.markor}» etter skriving.`);
    if (etter.digestUtenMarkor !== siste!.digest) {
      avvik.push("Resten av handlelisten avviker fra grunnlaget for skrivingen. Undersøk.");
    }
  }
  return {
    familyId: req.familyId,
    modus: req.modus,
    dryRun: false,
    utfall: endelig.utfall,
    ...(endelig.utfall === "nekt" ? { grunn: endelig.grunn } : {}),
    foer,
    etter,
    avvik,
  };
}
