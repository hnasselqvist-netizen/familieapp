/**
 * Fryser-motoren — rene funksjoner, ingen React, ingen Firebase.
 *
 * Portert 1:1 fra oppførselen til FreezerScreen i dagens index.html
 * (linje ~5077–5121: add/adjustBatch/batchLabel/totalGrams). Eneste
 * bevisste endring: id-generering er flyttet UT av disse funksjonene
 * og inn til kalleren (se src/hooks/useFreezer.ts) — funksjonene her
 * er dermed fullt deterministiske og krever ingen mocking i tester.
 * Selve regelen ("samme enhet + samme gram-per-enhet slås sammen,
 * ellers ny batch") er ikke endret.
 *
 * §Kontrolltårn-review (Fase 0, runde 2): de to `...ItemFields`-
 * funksjonene er kjernen i fiksen for stale-state/lost-update-risikoen
 * som ble påpekt i useFreezer. De opererer på verdien til ÉN
 * fryserpost-node (samme form som faktisk lagres i Firebase — uten
 * `id`, siden id-en er stien, ikke et felt), og er designet for å kalles
 * inne i en RTDB-transaksjon (§data/freezer.repository.ts sin
 * `transactFreezerItem`), der Firebase selv garanterer at `current`
 * alltid er den ferskeste server-verdien — aldri en potensielt utdatert
 * React-tilstand. `addBatch`/`adjustBatchCount` (liste-scoped) er bevart
 * med uendret oppførsel for karakteriseringstestene, men bygger nå på
 * de samme feltfunksjonene i stedet for å duplisere regelen.
 */
import type {
  FreezerBatch,
  FreezerItem,
  FreezerItemFields,
  FreezerSamling,
} from "@app-types/freezer";

/** Menneskelesbar etikett for én batch — f.eks. "2 pk à 500 g" eller "3 stk". */
export function batchLabel(batch: FreezerBatch): string {
  if (batch.gramsPerUnit) return `${batch.count} ${batch.unit} à ${batch.gramsPerUnit} g`;
  if (batch.unit !== "stk") return `${batch.count} ${batch.unit}`;
  return `${batch.count} stk`;
}

/**
 * Mengdevisning (#20, ordre 6693886984; docs/arkitektur/matlager-kjoleskap-
 * torrvarer.md avsnitt 3). Ren og skrivefri: lagrede batcher leses, aldri
 * normaliseres eller skrives om. Hver batch er én av fire typer:
 *
 * - direkte masse (`g`, `kg` uten `gramsPerUnit`) og dokumentert
 *   pakningsvekt (annen enhet med `gramsPerUnit`) — summeres i gram;
 * - direkte volum (`ml`, `dl`, `l` uten `gramsPerUnit`) — summeres i ml.
 *   Masse og volum regnes aldri om til hverandre;
 * - antall uten vekt (`stk`, `pk`, `boks`, …) — summeres bare per enhet,
 *   så «2 pk + 3 stk» aldri blir «5 pk»;
 * - tvetydig gammel verdi (`g`/`kg`/volum MED `gramsPerUnit`, f.eks.
 *   «2 kg à 500 g») — vises som lagret via `batchLabel` og bidrar ikke til
 *   noen sum.
 */
const MASSE_FAKTOR: Readonly<Record<string, number>> = { g: 1, kg: 1000 };
const VOLUM_FAKTOR: Readonly<Record<string, number>> = { ml: 1, dl: 100, l: 1000 };

const tallFormat = new Intl.NumberFormat("nb-NO", {
  maximumFractionDigits: 2,
  useGrouping: false,
});
const tall = (n: number) => tallFormat.format(n);

function formaterVolum(ml: number): string {
  const avrundet = Math.round(ml * 1e6) / 1e6;
  if (avrundet >= 1000) return `${tall(avrundet / 1000)} l`;
  if (Number.isInteger(Math.round((avrundet / 100) * 1e6) / 1e6))
    return `${tall(avrundet / 100)} dl`;
  return `${tall(avrundet)} ml`;
}

export interface Beholdning {
  /** Summert masse i gram (direkte masse + dokumentert pakningsvekt), `null` hvis ingen. */
  gram: number | null;
  /** Summert direkte volum i ml, `null` hvis ingen. */
  ml: number | null;
  /** Antall uten vekt, per enhet, i rekkefølgen enhetene først opptrer. */
  antall: { enhet: string; antall: number }[];
  /** Tvetydige gamle batcher, vist som lagret. Bidrar ikke til noen sum. */
  tvetydige: FreezerBatch[];
}

export function beregnBeholdning(batches: readonly FreezerBatch[]): Beholdning {
  let gram = 0;
  let harGram = false;
  let ml = 0;
  let harMl = false;
  const antall: { enhet: string; antall: number }[] = [];
  const tvetydige: FreezerBatch[] = [];
  for (const b of batches) {
    if (!Number.isFinite(b.count) || b.count <= 0) continue;
    const enhet = b.unit.toLowerCase();
    const medVekt = !!b.gramsPerUnit && Number.isFinite(b.gramsPerUnit) && b.gramsPerUnit > 0;
    if (enhet in MASSE_FAKTOR || enhet in VOLUM_FAKTOR) {
      if (b.gramsPerUnit) {
        tvetydige.push(b);
      } else if (enhet in MASSE_FAKTOR) {
        gram += b.count * MASSE_FAKTOR[enhet]!;
        harGram = true;
      } else {
        ml += b.count * VOLUM_FAKTOR[enhet]!;
        harMl = true;
      }
    } else if (medVekt) {
      gram += b.count * b.gramsPerUnit!;
      harGram = true;
    } else {
      const rad = antall.find((a) => a.enhet === b.unit);
      if (rad) rad.antall += b.count;
      else antall.push({ enhet: b.unit, antall: b.count });
    }
  }
  return { gram: harGram ? gram : null, ml: harMl ? ml : null, antall, tvetydige };
}

/** Lesbare ledd for en beholdning, f.eks. `["1300 g", "2 boks"]`. Tom liste når ingenting gjenstår. */
export function beholdningsledd(batches: readonly FreezerBatch[]): string[] {
  const b = beregnBeholdning(batches);
  return [
    ...(b.gram !== null ? [`${tall(b.gram)} g`] : []),
    ...(b.ml !== null ? [formaterVolum(b.ml)] : []),
    ...b.antall.map((a) => `${tall(a.antall)} ${a.enhet}`),
    ...b.tvetydige.map(batchLabel),
  ];
}

/** Hele beholdningen som én tekst («1300 g · 2 boks»), eller `null` når ingenting gjenstår. */
export function beholdningstekst(batches: readonly FreezerBatch[]): string | null {
  const ledd = beholdningsledd(batches);
  return ledd.length > 0 ? ledd.join(" · ") : null;
}

/**
 * Summert masse i gram: direkte `g`/`kg` og dokumentert pakningsvekt. Tvetydige
 * gamle verdier og antall uten vekt teller ikke. `null` når ingen masse er kjent.
 */
export function totalGrams(item: FreezerItem): number | null {
  return beregnBeholdning(item.batches).gram;
}

export interface ResolvedVare {
  id: string;
  name: string;
}

/**
 * Slår en ny batch sammen med en eksisterende batch-liste: samme
 * enhet+gramsPerUnit øker antallet på den eksisterende batchen, ellers
 * legges `newBatch` til som en ny batch. Den ene, delte kjernen bak både
 * liste- og ett-post-variantene under.
 */
function mergeBatchIntoBatches(batches: FreezerBatch[], newBatch: FreezerBatch): FreezerBatch[] {
  const sameSize = batches.find(
    (b) => b.unit === newBatch.unit && b.gramsPerUnit === newBatch.gramsPerUnit,
  );
  if (!sameSize) return [...batches, newBatch];
  return batches.map((b) => (b.id === sameSize.id ? { ...b, count: b.count + newBatch.count } : b));
}

/**
 * Ett-post-variant av "legg til batch" — opererer på gjeldende verdi for
 * ÉN fryserpost-node (eller `null` hvis posten ikke finnes ennå), ikke på
 * hele listen. Kalleren har allerede avgjort HVILKEN post (id/sti) dette
 * gjelder (typisk ved å slå opp på varenavn før transaksjonen startes) —
 * denne funksjonen tar ingen beslutning om hvilken post det er, kun hva
 * den nye verdien for akkurat den posten skal være.
 */
export function applyNewBatchToItemFields(
  current: FreezerItemFields | null,
  vare: ResolvedVare,
  newBatch: FreezerBatch,
): FreezerItemFields {
  if (!current) {
    return { itemId: vare.id, name: vare.name, batches: [newBatch] };
  }
  return { ...current, itemId: vare.id, batches: mergeBatchIntoBatches(current.batches, newBatch) };
}

/**
 * Ett-post-variant av "juster batch-antall". Returnerer `null` når posten
 * skal fjernes helt (siste batch nådde 0) — matcher `adjustBatchCount`
 * sin liste-oppførsel, uttrykt som "denne noden skal ikke lenger finnes"
 * i stedet for "filtrert bort fra en liste".
 */
export function applyBatchAdjustmentToItemFields(
  current: FreezerItemFields,
  batchId: string,
  delta: number,
): FreezerItemFields | null {
  const batches = current.batches
    .map((b) => (b.id !== batchId ? b : { ...b, count: Math.max(0, b.count + delta) }))
    .filter((b) => b.count > 0);
  return batches.length > 0 ? { ...current, batches } : null;
}

/** Hvorfor «Legg til» ble avvist ved commit. Ingenting er skrevet. */
export type MaalvalgAvvisning =
  | { type: "flere-treff"; navn: string; antall: number }
  | { type: "observert-slettet"; navn: string }
  | { type: "observert-omdopt"; navn: string; nyttNavn: string }
  | { type: "id-kollisjon"; navn: string };

export type MaalvalgResultat =
  { samling: FreezerSamling; maalId: string; ny: boolean } | { avvisning: MaalvalgAvvisning };

const sammeNavn = (a: unknown, b: string): boolean =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * «Legg til» med målpost valgt ved commit (#20, ordre 6698904630).
 * Kalles inne i en RTDB-transaksjon på HELE `freezer`-samlingen, med
 * fersk serververdi som `samling`. Navneregelen er dagens:
 * case-insensitiv lik `name` (ingen ny fuzzy-, alias- eller
 * identitetsregel).
 *
 * - `observertId` er posten brukeren faktisk så som mål (eneste lokale
 *   navnetreff), ellers `null`. Er den satt, brukes den og ingen annen
 *   navnelik post: er den slettet eller omdøpt → avvisning, aldri
 *   gjenoppliving eller tillegg under feil vare.
 * - Uten observert mål: ett ferskt treff → det (også en legacy-post den
 *   lokale listen ikke hadde sett); ingen treff → ny node `nyNodeId`.
 * - Flere ferske treff → avvisning, ingen automatisk sammenslåing.
 *
 * Eksisterende post beholder id, ukjente felt og `itemId` (settes bare
 * hvis den mangler — en konkurrerende varebase-id for samme navn bytter
 * ikke postens kobling). Batchen slås sammen etter dagens regel på fersk
 * verdi. Alle andre poster returneres urørt.
 */
export function leggTilVedCommit(
  samling: FreezerSamling | null,
  vare: ResolvedVare,
  newBatch: FreezerBatch,
  observertId: string | null,
  nyNodeId: string,
): MaalvalgResultat {
  const s: FreezerSamling = samling ?? {};
  const treff = Object.keys(s).filter((k) => sammeNavn(s[k]?.name, vare.name));
  let maalId: string;
  if (observertId !== null) {
    const observert = s[observertId];
    if (!observert) return { avvisning: { type: "observert-slettet", navn: vare.name } };
    if (!sammeNavn(observert.name, vare.name)) {
      return {
        avvisning: {
          type: "observert-omdopt",
          navn: vare.name,
          nyttNavn: String(observert.name ?? ""),
        },
      };
    }
    if (treff.length > 1) {
      return { avvisning: { type: "flere-treff", navn: vare.name, antall: treff.length } };
    }
    maalId = observertId;
  } else if (treff.length > 1) {
    return { avvisning: { type: "flere-treff", navn: vare.name, antall: treff.length } };
  } else if (treff.length === 1) {
    maalId = treff[0]!;
  } else {
    if (s[nyNodeId] !== undefined) {
      return { avvisning: { type: "id-kollisjon", navn: vare.name } };
    }
    return {
      samling: {
        ...s,
        [nyNodeId]: { itemId: vare.id, name: vare.name, batches: [newBatch] },
      },
      maalId: nyNodeId,
      ny: true,
    };
  }
  const post = s[maalId]!;
  const batches = Array.isArray(post.batches) ? post.batches : [];
  return {
    samling: {
      ...s,
      [maalId]: {
        ...post,
        itemId: post.itemId || vare.id,
        batches: mergeBatchIntoBatches(batches, newBatch),
      },
    },
    maalId,
    ny: false,
  };
}

/** Velger observert mål fra lokal liste: eneste navnetreff, ellers `null`. */
export function observertMaal(items: readonly FreezerItem[], navn: string): string | null {
  const treff = items.filter((i) => sammeNavn(i.name, navn));
  return treff.length === 1 ? treff[0]!.id : null;
}

/** Brukertekst for en avvisning ved commit. Ingenting er lagret i noen av tilfellene. */
export function maalvalgTekst(a: MaalvalgAvvisning): string {
  switch (a.type) {
    case "flere-treff":
      return `Det finnes ${a.antall} varer som heter «${a.navn}». Ingenting er lagret — slå sammen eller fjern duplikatene først.`;
    case "observert-slettet":
      return `«${a.navn}» finnes ikke lenger (fjernet på en annen enhet). Ingenting er lagret — legg den til på nytt om du vil.`;
    case "observert-omdopt":
      return `«${a.navn}» har fått nytt navn («${a.nyttNavn}») på en annen enhet. Ingenting er lagret — se over og prøv igjen.`;
    case "id-kollisjon":
      return `Kunne ikke opprette «${a.navn}» (id-kollisjon). Ingenting er lagret — prøv igjen.`;
  }
}

/** Hvorfor «Fjern» ble avvist ved commit. Ingenting er endret. */
export type SletteAvvisning = { type: "endret"; navn: string } | { type: "mangler"; navn: string };

/** Stabil JSON (sorterte objektnøkler, arrays i rekkefølge) for grunnlagssammenligning. */
function stabilJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.keys(x)
          .sort()
          .reduce<Record<string, unknown>>((o, k) => {
            o[k] = (x as Record<string, unknown>)[k];
            return o;
          }, {})
      : x,
  );
}

/**
 * Postens innhold slik den lagres, uten et `id`-felt som bare gjentar
 * nodenøkkelen (legacy skriver det, React ikke). Et `id`-felt som avviker
 * fra nøkkelen beholdes, så en reell identitetsendring ikke skjules.
 * RTDB lagrer ikke `null`, og både observert og fersk verdi kommer fra
 * serveren, så fravær av felt sammenlignes likt på begge sider.
 */
function grunnlag(nodeId: string, felt: Record<string, unknown>): string {
  const { id, ...rest } = felt;
  return stabilJson(id === undefined || id === nodeId ? rest : { id, ...rest });
}

/**
 * «Fjern varen» med grunnlagsvern (#20, ordre 6700834307). Kalles inne i
 * en RTDB-transaksjon på akkurat noden `observert.id`, med fersk
 * serververdi som `current`. `observert` er posten slik brukeren så den
 * da hen trykket (fra abonnementet; `id` = nodenøkkelen). Fersk post lik
 * grunnlaget → slett (`null`); endret (batch, antall, navn, itemId, ukjent
 * felt) eller manglende post → avvisning uten verdiendring og uten
 * gjenoppretting.
 */
export function fjernHvisUendret(
  current: FreezerItemFields | null,
  observert: FreezerItem,
): { verdi: null } | { avvisning: SletteAvvisning } {
  const { id: nodeId, ...observertFelt } = observert;
  if (!current) return { avvisning: { type: "mangler", navn: observert.name } };
  const fersk = grunnlag(nodeId, current as unknown as Record<string, unknown>);
  if (fersk !== grunnlag(nodeId, observertFelt as unknown as Record<string, unknown>)) {
    return { avvisning: { type: "endret", navn: observert.name } };
  }
  return { verdi: null };
}

/** Brukertekst for en avvist sletting. Ingenting er endret i noen av tilfellene. */
export function sletteTekst(a: SletteAvvisning): string {
  switch (a.type) {
    case "endret":
      return `«${a.navn}» er endret på en annen enhet siden du så den. Ingenting er fjernet — se over og prøv igjen.`;
    case "mangler":
      return `«${a.navn}» var allerede fjernet på en annen enhet. Ingenting er gjenopprettet.`;
  }
}

/**
 * Legger en ny batch til fryseren for en gitt (allerede funnet-eller-
 * opprettet) vare. Matcher eksisterende fryserpost på navn
 * (case-insensitivt — som i dag). Finnes posten fra før OG finnes en
 * batch med samme enhet+gramsPerUnit, økes antallet på den eksisterende
 * batchen. Ellers legges en ny batch til, eller en helt ny fryserpost
 * opprettes.
 *
 * `newBatch` og `newItemId` er ferdig genererte id-er fra kalleren —
 * denne funksjonen tar ingen beslutning om ID-er selv.
 *
 * Liste-scoped variant, bevart for karakteriseringstestene — selve
 * skrivingen til Firebase bruker `applyNewBatchToItemFields` via en
 * transaksjon (§data/freezer.repository.ts), ikke denne.
 */
export function addBatch(
  items: FreezerItem[],
  vare: ResolvedVare,
  newBatch: FreezerBatch,
  newItemId: string,
): FreezerItem[] {
  const existing = items.find((i) => i.name.toLowerCase() === vare.name.toLowerCase());
  const fields = applyNewBatchToItemFields(existing ?? null, vare, newBatch);
  if (!existing) return [...items, { id: newItemId, ...fields }];
  return items.map((i) => (i.id === existing.id ? { id: i.id, ...fields } : i));
}

/**
 * Justerer antallet på én batch med `delta` (kan være negativ). En
 * batch som når 0 fjernes; en fryserpost uten gjenværende batcher
 * fjernes helt — nøyaktig dagens oppførsel (§adjustBatch/removeItem).
 *
 * Liste-scoped variant, bevart for karakteriseringstestene — selve
 * skrivingen til Firebase bruker `applyBatchAdjustmentToItemFields` via
 * en transaksjon (§data/freezer.repository.ts), ikke denne.
 */
export function adjustBatchCount(
  items: FreezerItem[],
  itemId: string,
  batchId: string,
  delta: number,
): FreezerItem[] {
  return items.flatMap((i) => {
    if (i.id !== itemId) return [i];
    const next = applyBatchAdjustmentToItemFields(i, batchId, delta);
    return next ? [{ id: i.id, ...next }] : [];
  });
}

/** Fjerner en fryserpost i sin helhet, uavhengig av batch-innhold. */
export function removeFreezerItem(items: FreezerItem[], itemId: string): FreezerItem[] {
  return items.filter((i) => i.id !== itemId);
}

/**
 * Menneskelesbar "du har dette i Matlager"-etikett for ÉN vare, matchet
 * på navn (case-insensitivt) mot fryserbeholdningen — ren informasjon,
 * ALDRI en automatisk mengde-/behovsjustering (§Kontrolltårn-handoff,
 * Issue #20, "Kjøkken v1": "Ikke bygg avansert lagerstyring, automatisk
 * forbruk"). Opprinnelig en lokal, ueksportert funksjon i
 * `RecipeIngredients.tsx` — flyttet hit og gjenbrukt av
 * `ShoppingGeneratorModal.tsx` sitt gjennomgangs-steg, samme prinsipp,
 * to bruksteder, ÉN kilde til sannhet.
 */
export function freezerLabel(name: string, freezer: FreezerItem[]): string | null {
  // Kjent grense (uendret): første navnetreff vinner. Finnes flere poster med
  // samme navn, vises bare den første (se kartleggingsnotatet, svakhet 2).
  const match = freezer.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (!match) return null;
  const tekst = beholdningstekst(match.batches);
  return tekst ? `❄️ ${tekst} i Matlager` : "❄️ har i Matlager";
}
