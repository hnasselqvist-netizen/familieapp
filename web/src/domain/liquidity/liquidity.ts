/**
 * Spillerom-motoren. Rene funksjoner — ingen React, ingen Firebase.
 * 1:1-karakterisert mot dagens faktiske oppførsel i `index.html`
 * (linje 8843–9094, 10381–10935) — se liquidity.test.ts for
 * karakteriseringstestene skrevet FØR denne porteringen, per
 * ADR 0001 sin Fase 1-prosess.
 *
 * `generateForecastPosts` dropper bevisst legacy sin `incomeMonths`-
 * parameter: verifisert ubrukt i funksjonskroppen (kun `incomeMonths`
 * som variabelnavn i signaturen, aldri lest) — se index.html linje
 * 8918 vs. den faktiske inntektsgrenen (linje 9051–9092), som leser
 * `inc.months`, ikke parameteren. Ikke en atferdsendring.
 */
import type {
  ForecastGroup,
  Liquidity,
  LiquidityPost,
  SpilleromResult,
} from "@app-types/liquidity";

/**
 * Om en post skal telles som "aktiv" i Spillerom — brukes overalt poster
 * filtreres (calcSpillerom-input, gruppesummer, aktiv liste), slik at
 * ingen av dem kan komme i utakt med hverandre. Poster uten `status`
 * behandles bakoverkompatibelt som aktive.
 */
export function erAktivPrognosepost(post: LiquidityPost): boolean {
  return post.status !== "oppfylt";
}

/**
 * DEN ene regelen for "ligger denne posten innenfor den aktive
 * Spilleroms-perioden". Krever en gyldig `post.date`
 * (ugyldig/manglende dato → false, aldri inkludert).
 */
export function erPrognosepostIPeriode(
  post: LiquidityPost | undefined | null,
  fraDato: Date | string,
  tilDato: Date | string,
): boolean {
  if (!post || !post.date) return false;
  const d = new Date(post.date);
  if (Number.isNaN(d.getTime())) return false;
  const fra = new Date(fraDato);
  fra.setHours(0, 0, 0, 0);
  const til = new Date(tilDato);
  til.setHours(23, 59, 59, 999);
  return d >= fra && d <= til;
}

/** Prognosens likviditetssammendrag for perioden [fraDato, prognosisDate]. */
export function calcSpillerom(
  saldo: number,
  posts: LiquidityPost[],
  prognosisDate: Date | string,
  fraDato: Date | string,
): SpilleromResult {
  const d = prognosisDate ? new Date(prognosisDate) : new Date();
  d.setHours(23, 59, 59, 999);
  const start = fraDato ? new Date(fraDato) : new Date();
  start.setHours(0, 0, 0, 0);
  const relevant = posts.filter((p) => {
    if (!p.date) return false;
    const pd = new Date(p.date);
    return pd >= start && pd <= d;
  });
  const innbetalinger = relevant
    .filter((p) => p.direction === "in")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const utbetalinger = relevant
    .filter((p) => p.direction === "out")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const disponibelt = Number(saldo) || 0;
  const bundet = utbetalinger - innbetalinger; // netto uttak
  const spillerom = disponibelt + innbetalinger - utbetalinger;
  return { disponibelt, innbetalinger, utbetalinger, bundet, spillerom };
}

/**
 * Standard prognosedato når ingen er lagret ennå: neste lønningsdag
 * (dag 20 i måneden), eller måneden etter dersom dag 20 allerede er
 * passert. Delt med SpilleromScreen sin egen destrukturering, så
 * standarden ikke kan drifte fra seg selv to steder.
 */
export function beregnStandardPrognosisDate(naa: Date): string {
  const lonnDay = 20;
  const candidate = new Date(naa.getFullYear(), naa.getMonth(), lonnDay);
  if (candidate <= naa) candidate.setMonth(candidate.getMonth() + 1);
  return candidate.toISOString().slice(0, 10);
}

/**
 * Lista over {aar, maaned} som overlapper [fraDato, tilDato] — kan
 * spenne over et måneddskifte.
 */
export function maanederIPeriode(fraDato: Date, tilDato: Date): { aar: number; maaned: number }[] {
  const liste: { aar: number; maaned: number }[] = [];
  let cursor = new Date(fraDato.getFullYear(), fraDato.getMonth(), 1);
  const cursorSlutt = new Date(tilDato.getFullYear(), tilDato.getMonth(), 1);
  while (cursor <= cursorSlutt) {
    liste.push({ aar: cursor.getFullYear(), maaned: cursor.getMonth() });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return liste;
}

let genIdCounter = 0;
function genId(): string {
  genIdCounter += 1;
  return `gen-${Date.now()}-${genIdCounter}`;
}

/**
 * Regenererer alle `kilde:"generator"`-poster fra Budsjett/Sparing/
 * Inntekter-metadata for perioden [fraDato, tilDato]. Manuelle poster
 * og manuelt overstyrte genererte poster beholdes uendret. Deterministisk
 * `_genKey` per (post, år, måned, dag) hindrer duplikatgenerering.
 *
 * `idFactory` er injisert (i stedet for legacy sin globale `uid()`) slik
 * at testene kan verifisere eksakt antall/identitet uten å avhenge av en
 * ekte UUID-generator — produksjonskall bruker default (`crypto.randomUUID`
 * der tilgjengelig).
 */
export function generateForecastPosts(
  budgetGroups: ForecastGroup[],
  existingPosts: Record<string, LiquidityPost>,
  fraDato: Date,
  tilDato: Date,
  incomeGroups: ForecastGroup[] | undefined,
  sparingGroups: ForecastGroup[] | undefined,
  idFactory: () => string = () =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : genId(),
): Record<string, LiquidityPost> {
  const posts: Record<string, LiquidityPost> = {};
  Object.entries(existingPosts || {}).forEach(([id, p]) => {
    if (p.kilde !== "generator") {
      posts[id] = p; // behold manuelle
    }
    if (p.kilde === "generator" && p.manueltOverstyrt) {
      posts[id] = p;
    }
  });

  const fra = new Date(fraDato);
  fra.setHours(0, 0, 0, 0);
  const til = new Date(tilDato);
  til.setHours(23, 59, 59, 999);
  const genTs = Date.now();
  const innenforPeriode = (dato: Date) => dato >= fra && dato <= til;
  const maanedsListe = maanederIPeriode(fra, til);

  // ── Kostnadsposter ─────────────────────────────────────────────
  (budgetGroups || []).forEach((gruppe) => {
    gruppe.items.forEach((item) => {
      const meta = item.meta;
      if (!meta || !meta.automatisk) return;
      if (!meta.forfallsdag) return;
      const dag = Number.parseInt(meta.forfallsdag, 10);
      maanedsListe.forEach(({ aar, maaned }) => {
        const monthData = item.months?.[maaned];
        if (!monthData) return;
        const budgetAmount =
          monthData.spent && monthData.spent > 0 ? monthData.spent : monthData.budget;
        if (!budgetAmount || budgetAmount <= 0) return;
        const erFaktisk = !!(monthData.spent && monthData.spent > 0);
        const dato = new Date(aar, maaned, dag);
        if (!innenforPeriode(dato)) return;
        const datoStr = dato.toISOString().slice(0, 10);
        const noekkel = `${item.id}_${aar}_${maaned}_${dag}`;

        const overstyrt = Object.values(posts).find(
          (p) => p._genKey === noekkel && p.manueltOverstyrt,
        );
        if (overstyrt) return;

        const id = idFactory();
        posts[id] = {
          id,
          name: item.name,
          amount: budgetAmount,
          direction: "out",
          date: datoStr,
          type: meta.oppforsel || "fast",
          kilde: "generator",
          sourceBudgetItemId: item.id,
          sourceBudgetGroupId: gruppe.id,
          sourceType: "kostnader",
          sourceGroup: gruppe.label,
          owner: meta.eier || "Felles",
          level: meta.niva || "nodvendig",
          erEstimat: meta.oppforsel === "variabel" && !erFaktisk,
          _genKey: noekkel,
          generatedAt: genTs,
        };
      });
    });
  });

  // ── Spareposter ──────────────────────────────────────────────────
  // Egen prognosekilde: påvirker likviditetsprognosen (direction:"out",
  // samme mekanikk som kostnader), men telles ALDRI som Kostnader.
  // Tillater eksplisitt et negativt budsjettbeløp (planlagt uttak FRA
  // sparing gir motsatt fortegn i likviditetsregnestykket).
  (sparingGroups || []).forEach((gruppe) => {
    gruppe.items.forEach((item) => {
      const meta = item.meta;
      if (!meta || !meta.automatisk) return;
      if (!meta.forfallsdag) return;
      const dag = Number.parseInt(meta.forfallsdag, 10);
      maanedsListe.forEach(({ aar, maaned }) => {
        const monthData = item.months?.[maaned];
        if (!monthData) return;
        const budgetAmount =
          monthData.spent && monthData.spent !== 0 ? monthData.spent : monthData.budget;
        if (!budgetAmount) return; // kun 0/mangler ekskluderes — negativt tillates bevisst
        const erFaktisk = !!(monthData.spent && monthData.spent !== 0);
        const dato = new Date(aar, maaned, dag);
        if (!innenforPeriode(dato)) return;
        const datoStr = dato.toISOString().slice(0, 10);
        const noekkel = `spar_${item.id}_${aar}_${maaned}_${dag}`;

        const overstyrt = Object.values(posts).find(
          (p) => p._genKey === noekkel && p.manueltOverstyrt,
        );
        if (overstyrt) return;

        const id = idFactory();
        posts[id] = {
          id,
          name: item.name,
          amount: budgetAmount,
          direction: "out",
          date: datoStr,
          type: meta.oppforsel || "fast",
          kilde: "generator",
          sourceSparingItemId: item.id,
          sourceSparingGroupId: gruppe.id,
          sourceId: item.id,
          sourceType: "sparing",
          sourceGroup: gruppe.label,
          likviditet: meta.likviditet || "avsatt",
          owner: meta.eier || "Felles",
          konto: meta.konto || "Regninger",
          forfallsdag: meta.forfallsdag,
          erEstimat: meta.oppforsel === "variabel" && !erFaktisk,
          _genKey: noekkel,
          generatedAt: genTs,
        };
      });
    });
  });

  // ── Inntektsposter ─────────────────────────────────────────────
  (incomeGroups || []).forEach((gruppe) => {
    gruppe.items.forEach((inc) => {
      const meta = inc.meta || {};
      if (!meta.automatisk) return;
      const dag = Number.parseInt(meta.forfallsdag || "", 10);
      if (!dag) return;
      maanedsListe.forEach(({ aar, maaned }) => {
        const mo = inc.months?.[maaned];
        const amt =
          meta.disponibelt && meta.disponibelt > 0
            ? meta.disponibelt
            : mo && mo.spent > 0
              ? mo.spent
              : mo && mo.budget > 0
                ? mo.budget
                : 0;
        if (!amt) return;
        const dato = new Date(aar, maaned, dag);
        if (!innenforPeriode(dato)) return;
        const datoStr = dato.toISOString().slice(0, 10);
        const noekkel = `inc_${inc.id}_${aar}_${maaned}_${dag}`;

        const overstyrt = Object.values(posts).find(
          (p) => p._genKey === noekkel && p.manueltOverstyrt,
        );
        if (overstyrt) return;

        const id = idFactory();
        posts[id] = {
          id,
          name: inc.name,
          amount: amt,
          direction: "in",
          date: datoStr,
          type: "inn",
          kilde: "generator",
          sourceType: "inntekter",
          sourceGroup: gruppe.label,
          sourceItemId: inc.id,
          owner: meta.eier || "Felles",
          erEstimat: !(mo && mo.spent > 0) && !meta.disponibelt,
          _genKey: noekkel,
          generatedAt: genTs,
        };
      });
    });
  });

  return posts;
}

/** Aktive poster i den valgte perioden — bygget fra de to delte reglene over. */
export function periodePostListe(liquidity: Liquidity, startIdag: Date): LiquidityPost[] {
  return Object.values(liquidity.posts || {}).filter(
    (p) => erAktivPrognosepost(p) && erPrognosepostIPeriode(p, startIdag, liquidity.prognosisDate),
  );
}
