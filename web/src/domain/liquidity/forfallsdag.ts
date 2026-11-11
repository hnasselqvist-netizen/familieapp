/**
 * Forfallsdag for automatiske prognosekilder (#59, funn F, ordre
 * 6665182330). Ren domenelogikk, ingen skriving.
 *
 * To ulike spørsmål, bevisst holdt fra hverandre:
 *
 * - `tolkForfallsdag`: er verdien en entydig heltallsdag 1–31? Dette er
 *   kravet ved lagring når automatikk er på (`forfallsdagFeil`).
 * - `generatorForfallsdag`: hvilken dag bruker generatoren i dag for en
 *   lagret verdi? Uendret oppførsel fra før F, og samme oppførsel som
 *   legacy (`index.html` `generateForecastPosts`). Brukes av generatoren
 *   selv og av diagnostikken, slik at Spillerom beskriver det standard-
 *   genereringen faktisk gjør. Diagnostikken påstår aldri at en kilde er
 *   med eller ikke med i prognosen: manuelt overstyrte poster bevares
 *   uansett dag (#114), og beløp og periode avgjør resten.
 *
 * Forskjellen gjelder bare eldre, ugyldige verdier som generatoren likevel
 * tolker: f.eks. «15abc» → 15, «1.5» → 1, «32» → siste dag i måneden og
 * «0» for kostnad/sparing → siste dag i forrige måned (inntekt hopper over
 * 0). Slike kilder vises som «generatoren tolker dagen» — ikke som
 * `utelatt` — og ingenting skrives eller rettes automatisk.
 */
import type { ForecastGroup } from "@app-types/liquidity";
import { GROUP_TEMPLATES } from "@app-types/budsjettfamilie";

export type PrognoseKildeType = "kostnader" | "inntekter" | "sparing";

/** Entydig heltallsdag 1–31, ellers `null`. Ingen standarddag, ingen avrunding. */
export function tolkForfallsdag(verdi: unknown): number | null {
  if (typeof verdi === "number") {
    return Number.isInteger(verdi) && verdi >= 1 && verdi <= 31 ? verdi : null;
  }
  if (typeof verdi !== "string") return null;
  const tekst = verdi.trim();
  if (!/^\d{1,2}$/.test(tekst)) return null;
  const dag = Number(tekst);
  return dag >= 1 && dag <= 31 ? dag : null;
}

export const FORFALLSDAG_FEIL =
  "Automatisk til prognosen krever en forfallsdag fra 1 til 31. Skriv inn dagen, eller slå av automatikk.";

/**
 * Lagringsvern for metadataredigering: med automatikk på kreves en entydig
 * dag 1–31. Med automatikk av er tom (eller annen) verdi lov som før.
 */
export function forfallsdagFeil(meta: {
  automatisk?: boolean | null;
  forfallsdag?: unknown;
}): string | null {
  if (!meta.automatisk) return null;
  return tolkForfallsdag(meta.forfallsdag) === null ? FORFALLSDAG_FEIL : null;
}

/**
 * Dagen generatoren bruker for en lagret verdi, eller `null` når kilden
 * utelates. Speiler eksakt oppførselen før F:
 *
 * - kostnad/sparing: tom/falsy verdi utelates; ellers `parseInt` (NaN gir
 *   ugyldig dato og utelates);
 * - inntekt: `parseInt` av verdien; 0 og NaN utelates.
 */
export function generatorForfallsdag(type: PrognoseKildeType, verdi: unknown): number | null {
  if (type === "inntekter") {
    const dag = Number.parseInt(String(verdi ?? ""), 10);
    return dag ? dag : null;
  }
  if (!verdi) return null;
  const dag = Number.parseInt(String(verdi), 10);
  return Number.isNaN(dag) ? null : dag;
}

export interface ForfallsdagMangel {
  type: PrognoseKildeType;
  gruppeId: string;
  /** Visningsnavn for gruppen; gruppe-ID-en når den ikke er en kjent mal. */
  gruppeNavn: string;
  /** Om gruppen er en kjent gruppe som Økonomi viser (og kan redigeres der). */
  iOkonomi: boolean;
  postId: string;
  postNavn: string;
  /** Rå lagret verdi som tekst ("" når den mangler). */
  verdi: string;
  /**
   * `utelatt`: generatoren kan ikke lage standardposter for kilden.
   * `tolket`: den tolker dagen når den lager standardposter. Ingen av dem
   * sier om en faktisk prognosepost finnes: beløp, periode og manuelt
   * overstyrte poster (som alltid bevares) avgjør det.
   */
  status: "utelatt" | "tolket";
}

const NODE: Record<PrognoseKildeType, keyof typeof GROUP_TEMPLATES> = {
  kostnader: "budget",
  inntekter: "incomeGroups",
  sparing: "sparingGroups",
};

/**
 * Automatiske kilder uten gyldig forfallsdag, i stabil rekkefølge (type,
 * gruppe, post). Identitet er type + gruppe-ID + post-ID; like navn eller
 * ID-er i ulike grupper eller domener er egne rader.
 */
export function finnForfallsdagMangler(inputs: {
  budgetGroups: readonly ForecastGroup[];
  incomeGroups: readonly ForecastGroup[];
  sparingGroups: readonly ForecastGroup[];
}): ForfallsdagMangel[] {
  const kilder: [PrognoseKildeType, readonly ForecastGroup[]][] = [
    ["inntekter", inputs.incomeGroups],
    ["kostnader", inputs.budgetGroups],
    ["sparing", inputs.sparingGroups],
  ];
  const ut: ForfallsdagMangel[] = [];
  for (const [type, grupper] of kilder) {
    const maler = GROUP_TEMPLATES[NODE[type]];
    for (const gruppe of grupper) {
      const mal = maler.find((m) => m.id === gruppe.id);
      const gruppeNavn = mal?.label ?? gruppe.id;
      for (const post of gruppe.items ?? []) {
        const meta = post.meta;
        if (!meta || !meta.automatisk) continue;
        if (tolkForfallsdag(meta.forfallsdag) !== null) continue;
        ut.push({
          type,
          gruppeId: gruppe.id,
          gruppeNavn,
          iOkonomi: !!mal,
          postId: post.id,
          postNavn: post.name || post.id,
          verdi: meta.forfallsdag == null ? "" : String(meta.forfallsdag),
          status: generatorForfallsdag(type, meta.forfallsdag) === null ? "utelatt" : "tolket",
        });
      }
    }
  }
  return ut;
}
