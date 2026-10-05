import { useState } from "react";
import { GroupAccordion } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/GroupAccordion";
import { PostMetaModal } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/PostMetaModal";
import { PostDrilldown } from "@features/hverdagsflyt/forvaltning/korrigering/PostDrilldown";
import { finnHendelserForPost } from "@domain/budsjettfamilie/budsjettfamilie";
import type { UseBudsjettfamilieResult } from "@hooks/useBudsjettfamilie";
import type { BudsjettfamilieNode, BudsjettGruppe, BudsjettPost } from "@app-types/budsjettfamilie";

export interface OmradeGrupperProps {
  node: BudsjettfamilieNode;
  grupper: readonly BudsjettGruppe[];
  bf: UseBudsjettfamilieResult;
  /** Tom gruppe: egen tekst for Sparing (§index.html linje 12384–12389). */
  emptyMessage?: (gruppe: BudsjettGruppe) => string;
}

/**
 * Gruppene i ett område (Inntekter, Kostnader eller Sparing) med
 * postredigering, postinnstillinger og drilldown. Samlet fra de tre
 * tidligere skjermene `BudsjettScreen`/`InntekterScreen`/`SparingScreen`
 * (§Issue #34; legacy §index.html linje 11477–11727, 11930–12160,
 * 12299–12506), uendret oppførsel.
 *
 * **Korrigering fra drilldown** (`KorrigerHendelseModal`, kvitterings-
 * redigering, «Lær kobling») ligger i `korrigering/PostDrilldown` og er bak
 * forsoningsporten: med porten av er drilldown ren visning.
 */
export function OmradeGrupper({ node, grupper, bf, emptyMessage }: OmradeGrupperProps) {
  const [metaTarget, setMetaTarget] = useState<{ groupId: string; item: BudsjettPost } | null>(
    null,
  );
  const [drilldownItem, setDrilldownItem] = useState<BudsjettPost | null>(null);

  return (
    <>
      {grupper.map((gruppe) => (
        <GroupAccordion
          key={gruppe.id}
          gruppe={gruppe}
          month={bf.month}
          actualTotals={bf.actualTotals}
          emptyMessage={emptyMessage?.(gruppe)}
          onUpdateBudget={(groupId, itemId, v) => void bf.updateBudget(groupId, itemId, v)}
          onUpdateSpent={(groupId, itemId, v) => void bf.updateSpent(groupId, itemId, v)}
          onRemoveItem={(groupId, itemId) => void bf.removeExistingItem(groupId, itemId)}
          onAddItem={(groupId, fields) => void bf.addNewItem(groupId, fields)}
          onOpenMeta={(groupId, item) => setMetaTarget({ groupId, item })}
          onOpenDrilldown={(item) => setDrilldownItem(item)}
        />
      ))}

      {metaTarget && (
        <PostMetaModal
          node={node}
          groupId={metaTarget.groupId}
          itemName={metaTarget.item.name}
          itemMeta={metaTarget.item.meta}
          onSave={(meta, name) =>
            void bf.saveMeta(metaTarget.groupId, metaTarget.item.id, meta, name)
          }
          onClose={() => setMetaTarget(null)}
        />
      )}

      {drilldownItem && (
        <PostDrilldown
          tittel={`Hendelser — ${drilldownItem.name}`}
          rader={finnHendelserForPost(
            bf.hendelser,
            bf.transaksjoner,
            bf.receipts,
            drilldownItem,
            bf.monthKey,
            bf.gyldigeObservasjonIder,
          )}
          onClose={() => setDrilldownItem(null)}
        />
      )}
    </>
  );
}
