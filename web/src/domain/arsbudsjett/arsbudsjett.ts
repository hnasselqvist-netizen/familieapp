/**
 * Årsbudsjett-motoren. Rene funksjoner — ingen React, ingen Firebase.
 * 1:1-karakterisert mot dagens faktiske oppførsel i `index.html`
 * (`ArsbudsjettScreen`/`HelhetVisning`, linje 13210–14477, delte
 * hjelpefunksjoner linje 528–765, 2192–2209) — se arsbudsjett.test.ts
 * for karakteriseringstestene skrevet FØR denne porteringen, per ADR
 * 0001 sin Fase 1-prosess.
 *
 * **Én bevisst avgrensning fra legacy** (§Kontrolltårn-beslutning,
 * Issue #34, kommentar 5819881461): `bootstrapAarsplan2026` (§index.html
 * linje 16090–16121) — en engangs, hardkodet årstall-literal snapshot
 * av inneværende års live-data til `annualBudgetPlans/2026` — porteres
 * IKKE. Bekreftet vestigial ved lesing: `hentGroups`/`hentDetaljkilde` i
 * legacy leser ALDRI `annualPlans[CURRENT_BUDGET_YEAR]` tilbake —
 * inneværende år bruker alltid live `budgetGroups`/`incomeGroups`/
 * `sparingGroups` direkte, uansett om snapshotten finnes. Denne porten
 * skriver derfor aldri til `annualBudgetPlans/{currentBudgetYear}`.
 *
 * **Bevisst utenfor denne sliven**: årsskiftegapet (`CURRENT_BUDGET_YEAR`
 * er en ren `new Date().getFullYear()`-lesning uten migreringssteg —
 * planlagt neste-års-data blir foreldreløs når kalenderåret skifter,
 * siden UI-et da bytter til å vise live-data for det nye inneværende
 * året i stedet for den forhåndsplanlagte årsplanen). Dette er et reelt,
 * trolig utilsiktet gap i legacy — dokumentert her, ikke løst skjult i
 * denne migreringen (§Kontrolltårn-beslutning).
 */
import type {
  BudgetDetail,
  BudsjettGruppe,
  BudsjettPost,
  PostMeta,
} from "@app-types/budsjettfamilie";
import type { AnnualPlanGroup, AnnualPlanSlice } from "@app-types/arsbudsjett";

/**
 * Nivå-rekkefølgen delt med Generator/Regelsenter i legacy (ikke migrert
 * ennå) — §index.html linje 2192–2199. Første web/-konsument er
 * Årsbudsjett sin Helhet-visning; flyttes til et delt sted den dagen
 * Generator/Regelsenter faktisk migreres, ikke før (YAGNI).
 */
export const NIVA_REKKEFOLGE = [
  { key: "beskytte", label: "🛡️ Beskytte" },
  { key: "opprettholde-nodvendig", label: "🌱 Opprettholde – nødvendig" },
  { key: "opprettholde-valgfri", label: "🌱 Opprettholde – valgfri" },
  { key: "bygge", label: "🌳 Bygge (legacy — skal være tom)" },
  { key: "velge", label: "✨ Velge" },
  { key: "ukjent", label: "❓ Uten nivå" },
];

/** §index.html linje 2203–2209. */
export function nivaKeyForMeta(meta: PostMeta | null | undefined): string {
  if (!meta?.niva) return "ukjent";
  if (meta.niva === "opprettholde") {
    return meta.opprettholdType === "valgfritt" ? "opprettholde-valgfri" : "opprettholde-nodvendig";
  }
  return meta.niva;
}

const tolvTommeMaaneder = (): { budget: number }[] =>
  Array.from({ length: 12 }, () => ({ budget: 0 }));

/**
 * Eneste sted som summerer `budgetDetails` til en foreldreposts 12
 * `months` — §index.html linje 528–540. Returnerer alltid en fersk
 * 12-elements struktur (kun `budget` — budgetDetails er en ren
 * planleggingsmekanisme, aldri en del av Actual).
 */
export function summerBudgetDetails(
  budgetDetails: BudgetDetail[] | undefined,
): { budget: number }[] {
  return Array.from({ length: 12 }, (_, mi) => ({
    budget: (budgetDetails ?? []).reduce((s, d) => s + (d.months[mi]?.budget ?? 0), 0),
  }));
}

/**
 * Bygger en TOM årsplan (0 i alle 12 måneder) direkte fra dagens
 * aktive struktur — brukes når et nytt år åpnes første gang og ingen
 * plan finnes ennå. §index.html linje 578–609. `detaljkilde` (samme
 * flate form som denne funksjonen selv returnerer) kopierer KUN
 * detalj-STRUKTUREN (id+navn) inn, aldri beløp.
 */
export function byggTomAarsplanFraStruktur(
  groups: BudsjettGruppe[],
  detaljkilde?: AnnualPlanSlice,
): AnnualPlanSlice {
  const plan: AnnualPlanSlice = {};
  groups.forEach((g) => {
    const gruppe: AnnualPlanGroup = {};
    g.items.forEach((it) => {
      const kildeDetaljer = detaljkilde?.[g.id]?.[it.id]?.budgetDetails;
      gruppe[it.id] = {
        months: tolvTommeMaaneder(),
        ...(kildeDetaljer && kildeDetaljer.length > 0
          ? {
              budgetDetails: kildeDetaljer.map((d) => ({
                id: d.id,
                name: d.name,
                months: tolvTommeMaaneder(),
              })),
            }
          : {}),
      };
    });
    plan[g.id] = gruppe;
  });
  return plan;
}

/**
 * Konverterer "groups"-formen (samme form som `budgetGroups`/
 * `incomeGroups`/`sparingGroups` selv) TILBAKE til den flate
 * årsplan-formen — inversen av `flettAarsplanMedStruktur`. Brukes når
 * inneværende år (som lever direkte i groups, ikke i annualPlans) skal
 * fungere som detaljkilde. §index.html linje 611–629.
 */
export function konverterGroupsTilFlatPlan(groups: BudsjettGruppe[]): AnnualPlanSlice {
  const plan: AnnualPlanSlice = {};
  groups.forEach((g) => {
    const gruppe: AnnualPlanGroup = {};
    g.items.forEach((it) => {
      gruppe[it.id] = {
        months: it.months.map((mo) => ({ budget: mo.budget })),
        ...(it.budgetDetails && it.budgetDetails.length > 0
          ? { budgetDetails: it.budgetDetails }
          : {}),
      };
    });
    plan[g.id] = gruppe;
  });
  return plan;
}

/**
 * Finner ÅRET til den nærmeste EKSISTERENDE, faktisk FOREGÅENDE
 * årsplanen for et målår — blant årene som allerede finnes i
 * `annualPlans`, PLUSS `currentBudgetYear` selv (alltid regnet som
 * tilgjengelig, levende kilde selv om det ikke er lagret i
 * `annualPlans`). Ikke hardkodet — fungerer likt uansett hvilke år som
 * mangler. §index.html linje 631–649.
 */
export function finnNaermesteForegaaendeAar(
  maalAar: number,
  annualPlanAar: number[],
  currentBudgetYear: number,
): number | null {
  const kandidatAar = new Set<number>([currentBudgetYear, ...annualPlanAar]);
  let naermeste: number | null = null;
  kandidatAar.forEach((aar) => {
    if (aar < maalAar && (naermeste === null || aar > naermeste)) naermeste = aar;
  });
  return naermeste;
}

/**
 * Den guardede "Hent manglende detaljer"-handlingen for en årsplan SOM
 * ALLEREDE FINNES: legger KUN til detalj-STRUKTUR (0×12, samme
 * id/navn) på poster som IKKE allerede har `budgetDetails`, men HAR det
 * i kilden. Rører ALDRI en post som allerede har `budgetDetails`
 * (uansett innhold), og rører ALDRI en eksisterende posts `months`.
 * §index.html linje 651–680.
 */
export function hentManglendeDetaljerFraKilde(
  eksisterendePlan: AnnualPlanSlice | undefined,
  groups: BudsjettGruppe[],
  detaljkilde: AnnualPlanSlice | undefined,
): AnnualPlanSlice {
  const nyPlan: AnnualPlanSlice = {};
  groups.forEach((g) => {
    const nyGruppe: AnnualPlanGroup = {};
    g.items.forEach((it) => {
      const eksisterendePost = eksisterendePlan?.[g.id]?.[it.id];
      if (eksisterendePost?.budgetDetails && eksisterendePost.budgetDetails.length > 0) {
        nyGruppe[it.id] = eksisterendePost;
        return;
      }
      const kildePost = detaljkilde?.[g.id]?.[it.id];
      if (kildePost?.budgetDetails && kildePost.budgetDetails.length > 0) {
        nyGruppe[it.id] = {
          months: eksisterendePost?.months ?? tolvTommeMaaneder(),
          budgetDetails: kildePost.budgetDetails.map((d) => ({
            id: d.id,
            name: d.name,
            months: tolvTommeMaaneder(),
          })),
        };
        return;
      }
      nyGruppe[it.id] = eksisterendePost ?? { months: tolvTommeMaaneder() };
    });
    nyPlan[g.id] = nyGruppe;
  });
  return nyPlan;
}

/**
 * Slår sammen ÅRSUAVHENGIG struktur (id/navn/meta/legacyIds fra groups)
 * med en gitt årsplan (months/budgetDetails) — returnerer SAMME form
 * som groups selv. Post uten plan-data i årsplanen får 0×12 (ingen
 * gjetting, aldri lånt fra et annet år). §index.html linje 682–700.
 */
export function flettAarsplanMedStruktur(
  groups: BudsjettGruppe[],
  arsplan: AnnualPlanSlice | undefined,
): BudsjettGruppe[] {
  return groups.map((g) => ({
    ...g,
    items: g.items.map((it): BudsjettPost => {
      const planPost = arsplan?.[g.id]?.[it.id];
      const oppdatert: BudsjettPost = {
        ...it,
        // `spent` finnes ikke i årsplan-lagringen (§index.html linje
        // 528–540: budgetDetails/months der er en ren planleggings-
        // mekanisme, aldri en del av Actual) — fylt med 0 kun for å
        // matche `BudsjettPost`/`MaanedTall` sin form. Årsbudsjett viser
        // aldri Faktisk (§index.html linje 13793–13794, "ingen
        // oversikt over faktisk forbruk"), så feltet leses aldri.
        months: planPost
          ? planPost.months.map((mo) => ({ budget: mo.budget, spent: 0 }))
          : Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 })),
      };
      if (planPost?.budgetDetails && planPost.budgetDetails.length > 0) {
        oppdatert.budgetDetails = planPost.budgetDetails;
      } else {
        delete oppdatert.budgetDetails;
      }
      return oppdatert;
    }),
  }));
}

/** Summerer én post sitt årsbeløp — kun `months`, aldri `budgetDetails`. §index.html linje 708–716. */
export function summerPostAar(item: Pick<BudsjettPost, "months">): number {
  return item.months.reduce((s, mo) => s + (mo.budget || 0), 0);
}

/** Summerer én gruppe sitt årsbeløp. §index.html linje 718–720. */
export function summerGruppeAar(gruppe: Pick<BudsjettGruppe, "items">): number {
  return gruppe.items.reduce((s, it) => s + summerPostAar(it), 0);
}

/** Summerer alle grupper sitt samlede årsbeløp. §index.html linje 723–725. */
export function summerAlleGrupperAar(groups: Pick<BudsjettGruppe, "items">[]): number {
  return groups.reduce((s, g) => s + summerGruppeAar(g), 0);
}

/** Summerer ÉN kalendermåned på tvers av alle grupper/poster. §index.html linje 727–731. */
export function summerGrupperManed(
  groups: Pick<BudsjettGruppe, "items">[],
  monthIndex: number,
): number {
  return groups.reduce(
    (s, g) => s + g.items.reduce((s2, it) => s2 + (it.months[monthIndex]?.budget ?? 0), 0),
    0,
  );
}

/**
 * Klassifiserer kostnadsplanen etter nivå-nøkkel. Post uten meta/niva
 * havner under "ukjent" — aldri gjettet. §index.html linje 732–747.
 */
export function summerKostnaderEtterNiva(
  budgetGroupsForAar: Pick<BudsjettGruppe, "items">[],
): Record<string, number> {
  const sum: Record<string, number> = {};
  NIVA_REKKEFOLGE.forEach((n) => {
    sum[n.key] = 0;
  });
  budgetGroupsForAar.forEach((g) => {
    g.items.forEach((it) => {
      const key = nivaKeyForMeta(it.meta);
      sum[key] = (sum[key] ?? 0) + summerPostAar(it);
    });
  });
  return sum;
}

/**
 * Summerer etter `meta.eier` (Felles/Helen/Eivind). Post uten gyldig
 * eier-verdi havner under "Uklassifisert", aldri gjettet. §index.html
 * linje 748–765.
 */
export function summerEtterEier(
  groups: Pick<BudsjettGruppe, "items">[],
  budsjettEier: string[],
): Record<string, number> {
  const sum: Record<string, number> = {};
  budsjettEier.forEach((e) => {
    sum[e] = 0;
  });
  let uklassifisert = 0;
  groups.forEach((g) => {
    g.items.forEach((it) => {
      const eier = it.meta?.eier;
      const belop = summerPostAar(it);
      if (eier && Object.prototype.hasOwnProperty.call(sum, eier))
        sum[eier] = (sum[eier] ?? 0) + belop;
      else uklassifisert += belop;
    });
  });
  return { ...sum, Uklassifisert: uklassifisert };
}

/**
 * Fordeler et totalbeløp jevnt på 12 måneder, med avrundingsdifferanse
 * lagt på desember. Kun for poster UTEN `budgetDetails` — knappen er
 * skjult i legacy når en post har detaljer. §index.html linje
 * 13768–13779 (`fordelArskostnad`).
 */
export function fordelArskostnadMåneder(totalBelop: number): { budget: number }[] {
  const total = totalBelop || 0;
  const perManed = Math.floor(total / 12);
  const diff = total - perManed * 12;
  return Array.from({ length: 12 }, (_, mi) => ({
    budget: mi === 11 ? perManed + diff : perManed,
  }));
}

/**
 * Setter samme verdi for alle måneder fra og med `fraMonthIndex` — den
 * rene delen av "Bruk samme beløp resten av året". §index.html linje
 * 13563–13591 (`anvendResten`).
 */
export function anvendRestenMåneder(
  months: { budget: number }[],
  fraMonthIndex: number,
  verdi: number,
): { budget: number }[] {
  return months.map((mo, mi) => (mi < fraMonthIndex ? mo : { budget: verdi }));
}
