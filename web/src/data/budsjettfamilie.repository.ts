/**
 * Datalag for Budsjett-familien (`families/{familyId}/budget|
 * incomeGroups|sparingGroups`) — de tre nodene deler nøyaktig samme
 * lagrede form (§types/budsjettfamilie.ts, §domain/budsjettfamilie/
 * budsjettfamilie.ts sin toppkommentar), derfor ett datalag parametrisert
 * på `BudsjettfamilieNode` fremfor tre nesten identiske filer.
 *
 * Skrivemønster: MÅLRETTEDE skrivinger per felt/post (§Kontrolltårn-
 * beslutning, Issue #34, kommentar 5815438614: "bruk målrettede
 * skrivinger") — bevisst forskjellig fra legacy sin egen mekanikk, som
 * flater HELE den lokale gruppe-arrayen og skriver hele noden på hver
 * eneste redigering (§index.html linje 16485–16702, `setBudgetGroups`/
 * `setIncomeGroups`/`setSparingGroups`). Samme LAGREDE dataform, kun
 * annen skrivevei — ingen datamodellendring.
 *
 * `_gruppeplassholder` (§index.html linje 16512): Firebase Realtime
 * Database lagrer aldri en tom objekt-node, så en gruppe uten poster
 * ville forsvinne helt fra Firebase (og dermed fra parseren under, som
 * kun viser grupper `raw` faktisk har en nøkkel for). Denne
 * plassholderen skrives/fjernes eksplisitt her ved hvert målrettet
 * `addItem`/`removeItem`-kall — legacy sin whole-node-skriving fikk dette
 * "gratis" ved å regne det på nytt for hele gruppen hver gang.
 */
import { onValue, ref, runTransaction, set, update } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import { GROUP_TEMPLATES } from "@app-types/budsjettfamilie";
import type { FamilyId } from "@app-types/family";
import type {
  BudgetDetail,
  BudsjettfamilieNode,
  BudsjettGruppe,
  BudsjettPost,
  PostMeta,
} from "@app-types/budsjettfamilie";

const GRUPPEPLASSHOLDER_KEY = "_gruppeplassholder";

function nodePath(familyId: FamilyId, node: BudsjettfamilieNode): string {
  return `families/${familyId}/${node}`;
}

function groupPath(familyId: FamilyId, node: BudsjettfamilieNode, groupId: string): string {
  return `${nodePath(familyId, node)}/${groupId}`;
}

function itemPath(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
): string {
  return `${groupPath(familyId, node, groupId)}/${itemId}`;
}

/**
 * Parser rå Firebase-form ({groupId: {itemId: {name, months, meta,
 * legacyIds?, budgetDetails?}}}) til `BudsjettGruppe[]`, i rekkefølgen
 * og med etikettene fra `GROUP_TEMPLATES` (Firebase lagrer aldri et
 * gruppenavn — se domenefilens toppkommentar). En gruppe vises kun når
 * `raw` faktisk har en nøkkel for den (samme "gruppe fjernet fra
 * Firebase -> fjern lokalt"-prinsipp som legacy sin lytter,
 * §index.html linje 15969) — UNNTATT når HELE noden aldri er skrevet
 * (`raw` er `null`), da vises alle malgruppene tomme som et scaffold
 * for en helt ny familie, samme rolle legacy sin lokale
 * `useState(BUDGET_TEMPLATE)` har før noe er skrevet.
 */
export function parseBudsjettGrupper(raw: unknown, node: BudsjettfamilieNode): BudsjettGruppe[] {
  const rawObj =
    raw && typeof raw === "object" ? (raw as Record<string, Record<string, unknown>>) : null;
  return GROUP_TEMPLATES[node]
    .filter(
      (template) => rawObj === null || Object.prototype.hasOwnProperty.call(rawObj, template.id),
    )
    .map((template) => {
      const itemsRaw = (rawObj?.[template.id] ?? {}) as Record<string, unknown>;
      const items: BudsjettPost[] = Object.entries(itemsRaw)
        .filter(([itemId]) => itemId !== GRUPPEPLASSHOLDER_KEY)
        .map(([itemId, item]) => {
          const fields = item as Record<string, unknown>;
          const monthsRaw = (fields.months ?? {}) as Record<
            number,
            { budget?: number; spent?: number }
          >;
          const months = Array.from({ length: 12 }, (_, i) => ({
            budget: monthsRaw[i]?.budget ?? 0,
            spent: monthsRaw[i]?.spent ?? 0,
          }));
          const budgetDetailsRaw = fields.budgetDetails as
            | { id: string; name: string; months?: Record<number, { budget?: number }> }[]
            | undefined;
          const budgetDetails: BudgetDetail[] | undefined = budgetDetailsRaw?.map((d) => ({
            id: d.id,
            name: d.name,
            months: Array.from({ length: 12 }, (_, i) => ({ budget: d.months?.[i]?.budget ?? 0 })),
          }));
          return {
            id: itemId,
            name: (fields.name as string) ?? "",
            months,
            meta: fields.meta as PostMeta | null | undefined,
            legacyIds: fields.legacyIds as string[] | undefined,
            ...(budgetDetails && budgetDetails.length > 0 ? { budgetDetails } : {}),
          };
        });
      return { id: template.id, label: template.label, items };
    });
}

/** Abonnerer på én av de tre nodene. Returnerer en avmeldingsfunksjon. */
export function subscribeBudsjettGrupper(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  onChange: (grupper: BudsjettGruppe[]) => void,
): () => void {
  const nodeRef = ref(getFirebaseDatabase(), nodePath(familyId, node));
  return onValue(nodeRef, (snapshot) => {
    onChange(parseBudsjettGrupper(snapshot.exists() ? snapshot.val() : null, node));
  });
}

export function subscribeBudgetGroups(
  familyId: FamilyId,
  onChange: (grupper: BudsjettGruppe[]) => void,
): () => void {
  return subscribeBudsjettGrupper(familyId, "budget", onChange);
}

export function subscribeIncomeGroups(
  familyId: FamilyId,
  onChange: (grupper: BudsjettGruppe[]) => void,
): () => void {
  return subscribeBudsjettGrupper(familyId, "incomeGroups", onChange);
}

export function subscribeSparingGroups(
  familyId: FamilyId,
  onChange: (grupper: BudsjettGruppe[]) => void,
): () => void {
  return subscribeBudsjettGrupper(familyId, "sparingGroups", onChange);
}

/**
 * Redigerer ett felt (`budget`/`spent`) for én måned på én post.
 * Speiler `updItem` (§index.html linje 11517–11521 m.fl.) — målrettet
 * skriving til nøyaktig `.../months/{monthIndex}/{field}`, ikke hele
 * posten/gruppen/noden.
 */
export async function updateItemMonth(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
  monthIndex: number,
  field: "budget" | "spent",
  value: number,
): Promise<void> {
  await set(
    ref(
      getFirebaseDatabase(),
      `${itemPath(familyId, node, groupId, itemId)}/months/${monthIndex}/${field}`,
    ),
    value,
  );
}

/**
 * Oppretter en ny post i en gruppe. Speiler `addItem` (§index.html linje
 * 11522–11529 m.fl.) — nytt 12-måneders array, beløp satt kun for
 * `monthIndex`, resten 0. `meta` sendes inn av kalleren (se
 * `nyPostMeta` i domenelaget for den dokumenterte forskjellen mellom
 * Budsjett/Inntekter/Sparing). Fjerner samtidig en eventuell
 * `_gruppeplassholder` på gruppen — se filens toppkommentar.
 */
export async function addItem(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  fields: {
    name: string;
    budget: number;
    spent: number;
    monthIndex: number;
    meta?: PostMeta | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const months = Array.from({ length: 12 }, (_, i) => ({
    budget: i === fields.monthIndex ? fields.budget : 0,
    spent: i === fields.monthIndex ? fields.spent : 0,
  }));
  const post: Record<string, unknown> = { name: fields.name, months };
  if (fields.meta !== undefined) post.meta = fields.meta;
  await update(ref(getFirebaseDatabase(), groupPath(familyId, node, groupId)), {
    [id]: post,
    [GRUPPEPLASSHOLDER_KEY]: null,
  });
  return id;
}

/**
 * Fjerner én post. Speiler `delItem` (§index.html linje 11531–11533
 * m.fl.). Kjøres som en transaksjon PÅ GRUPPEN (ikke ut fra kallerens
 * lokale abonnementsstate, §Kontrolltårn-review, PR #36 kommentar
 * 5818773212): om `_gruppeplassholder` må skrives avgjøres av hva som
 * faktisk står igjen i gruppen når transaksjonen committer, ikke hva
 * klienten trodde da kallet startet. To faner som fjerner ulike poster
 * samtidig, eller en `addItem` som løper parallelt med den siste
 * `removeItem`, blir dermed korrekt håndtert — Firebase kjører
 * update-funksjonen på nytt med fersk serverstate ved konflikt.
 */
export async function removeItem(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), groupPath(familyId, node, groupId)),
    (current: Record<string, unknown> | null) => {
      if (!current) return current;
      const rest = { ...current };
      delete rest[itemId];
      const harAndrePoster = Object.keys(rest).some((key) => key !== GRUPPEPLASSHOLDER_KEY);
      return harAndrePoster ? rest : { [GRUPPEPLASSHOLDER_KEY]: true };
    },
  );
}

/**
 * Redigerer meta og (valgfritt) navn på en post. Speiler `saveMeta`
 * (§index.html linje 11537–11539 m.fl.) — navn endres KUN når eksplisitt
 * sendt inn, rører aldri id/legacyIds/months/budgetDetails/gruppe.
 * Transaksjon fordi meta erstattes helt (ikke slås sammen felt for
 * felt), og posten må faktisk finnes nå — samme begrunnelse som
 * `setLiquidityPostFulfilled`/`updateLiquidityPost`.
 */
export async function saveItemMeta(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
  meta: PostMeta,
  name?: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), itemPath(familyId, node, groupId, itemId)),
    (current) => {
      if (!current) return null;
      return { ...current, meta, ...(name !== undefined ? { name } : {}) };
    },
  );
}

const tolvTommeDetaljMaaneder = (): { budget: number }[] =>
  Array.from({ length: 12 }, () => ({ budget: 0 }));

/**
 * Samme invariant som domenelagets `summerBudgetDetails` (§domain/
 * arsbudsjett/arsbudsjett.ts) — duplisert her, ikke importert, siden
 * `data/` ikke har lov til å importere fra `domain/`
 * (§web/eslint.config.js sin `import/no-restricted-paths`). Tre linjer
 * er billigere enn å flytte en ren regnefunksjon til et delt nøytralt
 * sted for én konsument på hver side.
 */
function summerDetaljerTilMaaneder(
  budgetDetails: BudgetDetail[] | undefined,
): { budget: number }[] {
  return Array.from({ length: 12 }, (_, mi) => ({
    budget: (budgetDetails ?? []).reduce((s, d) => s + (d.months[mi]?.budget ?? 0), 0),
  }));
}

/**
 * Aktiverer detaljnivå for en post — bygger budsjettet på nytt fra én
 * ny, tom detalj (0 kr). Foreldrepostens `months` blir dermed 0×12 med
 * det samme. No-op om posten allerede har detaljer (samme guard som
 * legacy). Kalles KUN etter eksplisitt brukerbekreftelse (i UI-laget),
 * aldri automatisk. Speiler `aktiverDetaljer` (§index.html linje
 * 13623–13634). Kostnad OG inntekt — aldri Sparing (§index.html linje
 * 13751–13753, håndheves av kalleren, ikke her).
 */
export async function activateBudgetDetails(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), itemPath(familyId, node, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      if (!current) return current;
      const eksisterende = current.budgetDetails as BudgetDetail[] | undefined;
      if (eksisterende && eksisterende.length > 0) return current;
      const nyDetalj: BudgetDetail = {
        id: crypto.randomUUID(),
        name: "Ny detalj",
        months: tolvTommeDetaljMaaneder(),
      };
      return {
        ...current,
        budgetDetails: [nyDetalj],
        months: summerDetaljerTilMaaneder([nyDetalj]),
      };
    },
  );
}

/**
 * Fjerner detaljnivå fra en post — beholder dagens summerte `months`
 * uendret, fjerner kun `budgetDetails`-feltet. Speiler `fjernDetaljniva`
 * (§index.html linje 13695–13706, §10: "eksplisitt overgang tilbake til
 * enkel post"). Målrettet feltsletting — ingen transaksjon nødvendig
 * siden operasjonen ikke avhenger av gjeldende `budgetDetails`-innhold.
 */
export async function removeBudgetDetailLevel(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
): Promise<void> {
  await update(ref(getFirebaseDatabase(), itemPath(familyId, node, groupId, itemId)), {
    budgetDetails: null,
  });
}

/**
 * Legger til en ny, tom detalj (0 kr i alle 12 måneder) — foreldresummen
 * er uendret ved tillegg. Speiler `leggTilDetalj` (§index.html linje
 * 13636–13648).
 */
export async function addBudgetDetail(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), itemPath(familyId, node, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      if (!current) return current;
      const eksisterende = (current.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyDetalj: BudgetDetail = {
        id: crypto.randomUUID(),
        name: "Ny detalj",
        months: tolvTommeDetaljMaaneder(),
      };
      const nyeDetaljer = [...eksisterende, nyDetalj];
      return {
        ...current,
        budgetDetails: nyeDetaljer,
        months: summerDetaljerTilMaaneder(nyeDetaljer),
      };
    },
  );
}

/**
 * Endrer navnet på én detalj — påvirker aldri beløp. Speiler
 * `endreDetaljNavn` (§index.html linje 13669–13677).
 */
export async function renameBudgetDetail(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
  detailId: string,
  name: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), itemPath(familyId, node, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      if (!current) return current;
      const eksisterende = (current.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyeDetaljer = eksisterende.map((d) => (d.id !== detailId ? d : { ...d, name }));
      return { ...current, budgetDetails: nyeDetaljer };
    },
  );
}

/**
 * Fjerner én detalj (ikke den siste — det er en egen, eksplisitt
 * overgang, se `removeBudgetDetailLevel`), summerer foreldrepostens
 * `months` på nytt. Speiler `slettDetalj` (§index.html linje
 * 13679–13689).
 */
export async function removeBudgetDetail(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
  detailId: string,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), itemPath(familyId, node, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      if (!current) return current;
      const eksisterende = (current.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyeDetaljer = eksisterende.filter((d) => d.id !== detailId);
      return {
        ...current,
        budgetDetails: nyeDetaljer,
        months: summerDetaljerTilMaaneder(nyeDetaljer),
      };
    },
  );
}

/**
 * Redigerer én måned på én detalj, summerer foreldrepostens `months` på
 * nytt. Speiler `updDetaljMonth` (§index.html linje 13650–13666).
 */
export async function updateBudgetDetailMonth(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
  detailId: string,
  monthIndex: number,
  value: number,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), itemPath(familyId, node, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      if (!current) return current;
      const eksisterende = (current.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyeDetaljer = eksisterende.map((d) =>
        d.id !== detailId
          ? d
          : {
              ...d,
              months: d.months.map((mo, mi) => (mi !== monthIndex ? mo : { budget: value })),
            },
      );
      return {
        ...current,
        budgetDetails: nyeDetaljer,
        months: summerDetaljerTilMaaneder(nyeDetaljer),
      };
    },
  );
}

/**
 * Fordeler et totalbeløp jevnt på 12 måneder (avrundingsdifferanse på
 * desember) for en post UTEN detaljer. Speiler `fordelArskostnad`
 * (§index.html linje 13768–13779) — målrettet flerfelts-skriving (ett
 * `update`-kall, ett felt per måned), ikke en transaksjon, siden
 * resultatet ikke avhenger av gjeldende `months`-innhold.
 */
export async function spreadYearlyAmount(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
  totalAmount: number,
): Promise<void> {
  const total = totalAmount || 0;
  const perManed = Math.floor(total / 12);
  const diff = total - perManed * 12;
  const base = itemPath(familyId, node, groupId, itemId);
  const updates: Record<string, number> = {};
  for (let mi = 0; mi < 12; mi += 1) {
    updates[`${base}/months/${mi}/budget`] = mi === 11 ? perManed + diff : perManed;
  }
  await update(ref(getFirebaseDatabase()), updates);
}

/**
 * "Bruk samme beløp resten av året" for en post UTEN detaljer —
 * målrettet flerfelts-skriving fra og med `fromMonthIndex`, samme
 * mønster som `spreadYearlyAmount`. Speiler grenen av `anvendResten`
 * uten `detaljId` (§index.html linje 13586–13590).
 */
export async function applyRestOfYear(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
  fromMonthIndex: number,
  value: number,
): Promise<void> {
  const base = itemPath(familyId, node, groupId, itemId);
  const updates: Record<string, number> = {};
  for (let mi = fromMonthIndex; mi < 12; mi += 1) {
    updates[`${base}/months/${mi}/budget`] = value;
  }
  await update(ref(getFirebaseDatabase()), updates);
}

/**
 * "Bruk samme beløp resten av året" for ÉN detalj — oppdaterer kun den
 * detaljen, summerer foreldrepostens `months` på nytt. Speiler grenen av
 * `anvendResten` MED `detaljId` (§index.html linje 13574–13584), som
 * samtidig retter en eksisterende bug i legacy der denne grenen var
 * hardkodet til `setBudgetGroups` uansett `type` (§index.html linje
 * 13568–13572-kommentaren) — her går skrivingen alltid til riktig
 * node/post via `itemPath`, ingen tilsvarende bug mulig.
 */
export async function applyRestOfYearToDetail(
  familyId: FamilyId,
  node: BudsjettfamilieNode,
  groupId: string,
  itemId: string,
  detailId: string,
  fromMonthIndex: number,
  value: number,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), itemPath(familyId, node, groupId, itemId)),
    (current: Record<string, unknown> | null) => {
      if (!current) return current;
      const eksisterende = (current.budgetDetails as BudgetDetail[] | undefined) ?? [];
      const nyeDetaljer = eksisterende.map((d) =>
        d.id !== detailId
          ? d
          : {
              ...d,
              months: d.months.map((mo, mi) => (mi < fromMonthIndex ? mo : { budget: value })),
            },
      );
      return {
        ...current,
        budgetDetails: nyeDetaljer,
        months: summerDetaljerTilMaaneder(nyeDetaljer),
      };
    },
  );
}
