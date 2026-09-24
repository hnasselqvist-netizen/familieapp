/**
 * Datamodellen for Budsjett/Inntekter/Sparing (§index.html linje
 * 11477–12506, `families/{familyId}/budget|incomeGroups|sparingGroups`)
 * — karakteriseringstype, ikke et nytt skjema. Samme lagrede form som
 * Spillerom sin `ForecastGroup`/`ForecastItem` allerede karakteriserte
 * (§types/liquidity.ts, §data/liquidity.repository.ts): `{groupId:
 * {itemId: {name, months, meta, ...}}}` direkte, ingen `.items`-wrapper,
 * intet lagret gruppenavn — se `GROUP_TEMPLATES` under for hvor de
 * faktiske norske gruppenavnene kommer fra (samme rolle som legacy sin
 * lokale `BUDGET_TEMPLATE`/`INCOME_GROUP_TEMPLATE`/
 * `SPARING_GROUP_TEMPLATE`). Ligger her (ikke i domenelaget) fordi både
 * `domain/` og `data/` trenger den, og `data` ikke har lov til å
 * importere fra `domain` (§web/eslint.config.js sin
 * `import/no-restricted-paths` — modulgrensene utvides aldri, kun
 * respekteres).
 */

/** Hvilken av de tre Firebase-nodene en gruppe/post hører til. */
export type BudsjettfamilieNode = "budget" | "incomeGroups" | "sparingGroups";

/**
 * De faktiske norske gruppenavnene og gruppeordenen — Firebase lagrer
 * ALDRI et gruppenavn (samme funn som Spillerom sin `parseForecastGroups`,
 * §data/liquidity.repository.ts). Legacy sin kilde er de lokale
 * `BUDGET_TEMPLATE`/`INCOME_GROUP_TEMPLATE`/`SPARING_GROUP_TEMPLATE`
 * (§index.html linje 966, 494, 1059) — kun id+navn+rekkefølge kopiert
 * hit, IKKE fargene/emoji/de forhåndsutfylte historiske beløpene
 * (`makeMonths(...)`), som kun er bootstrap-scaffolding for en helt ny,
 * aldri-brukt familie og derfor bevisst ikke portert (§Issue #34,
 * "bevar funksjonsparitet OG eksisterende data" — denne familien har
 * allerede ekte data).
 */
export const GROUP_TEMPLATES: Record<BudsjettfamilieNode, { id: string; label: string }[]> = {
  budget: [
    { id: "bolig", label: "Bolig" },
    { id: "transport", label: "Transport" },
    { id: "mat", label: "Mat og dagligvarer" },
    { id: "helse", label: "Helse" },
    { id: "barn", label: "Barn" },
    { id: "personlig", label: "Personlig" },
    { id: "hverdagsgleder", label: "Små hverdagsgleder" },
    { id: "fritid", label: "Fritid" },
    { id: "gaver", label: "Gaver" },
    { id: "forsikring", label: "Forsikringer" },
    { id: "ovrige", label: "Øvrige kjøp" },
    { id: "hanggliding", label: "Hanggliding" },
  ],
  incomeGroups: [
    { id: "lonn", label: "Lønn" },
    { id: "offentlig", label: "Offentlige ytelser" },
    { id: "kapital", label: "Kapitalinntekter" },
    { id: "annet", label: "Annet" },
  ],
  sparingGroups: [
    { id: "buffer", label: "Buffer" },
    { id: "generell_sparing", label: "Generell sparing" },
    { id: "feriesparing", label: "Feriesparing" },
    { id: "investering", label: "Investering" },
    { id: "pensjon", label: "Pensjon" },
    { id: "annet", label: "Annet" },
  ],
};

export interface MaanedTall {
  budget: number;
  spent: number;
}

/**
 * Metadatafeltene på tvers av alle tre noder — ikke alle felt brukes av
 * alle tre (§index.html: `niva`/`oppforsel`/`kilde` finnes ikke på
 * Sparing sin `SparingMetaModal`; `disponibelt` finnes KUN på Inntekter
 * sin `InntekterMetaModal`; `likviditet` finnes KUN på Sparing). Feltene
 * som ikke gjelder en gitt node er ganske enkelt aldri satt/lest der —
 * samme "overflødige felt ignoreres" som legacy sin form uten union-typer.
 */
export interface PostMeta {
  eier?: string;
  niva?: string;
  opprettholdType?: string;
  oppforsel?: string;
  konto?: string;
  forfallsdag?: string;
  automatisk?: boolean;
  kilde?: string;
  paymentPattern?: string;
  arkivert?: boolean;
  /** Kun Inntekter — overstyrer faktisk/budsjett i Spillerom-generatoren. */
  disponibelt?: number | null;
  /** Kun Sparing. */
  likviditet?: string;
}

export interface BudsjettPost {
  id: string;
  name: string;
  /** Indeks 0–11 (januar–desember), alltid 12 elementer. */
  months: MaanedTall[];
  /**
   * `undefined` (Budsjett: aldri satt på en ny post), `null` (Inntekter:
   * eksplisitt tomt) eller et faktisk objekt — se `nyPostMeta` for den
   * bevisste, dokumenterte forskjellen mellom nodene (§Issue #34-
   * kartlegging, punkt "addItem sin meta-initialisering").
   */
  meta?: PostMeta | null;
  /** Bevart, aldri tolket av denne sliven — historiske plasseringId-er for hendelse-matching. */
  legacyIds?: string[];
  /** Bevart, aldri tolket av denne sliven — Årsbudsjett sitt konsept, utenfor scope (§Issue #34). */
  budgetDetails?: unknown[];
}

export interface BudsjettGruppe {
  id: string;
  /** Fra `GROUP_LABELS`, ikke fra Firebase — se filens toppkommentar. */
  label: string;
  items: BudsjettPost[];
}
