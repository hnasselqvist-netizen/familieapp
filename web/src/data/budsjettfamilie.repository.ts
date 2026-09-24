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
          return {
            id: itemId,
            name: (fields.name as string) ?? "",
            months,
            meta: fields.meta as PostMeta | null | undefined,
            legacyIds: fields.legacyIds as string[] | undefined,
            budgetDetails: fields.budgetDetails as unknown[] | undefined,
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
