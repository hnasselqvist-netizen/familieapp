import { useState } from "react";
import { RoomHeader } from "@components/RoomHeader";
import { DrilldownModal } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/DrilldownModal";
import { GroupAccordion } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/GroupAccordion";
import { MonthNav } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/MonthNav";
import { PostMetaModal } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/PostMetaModal";
import { finnHendelserForPost } from "@domain/budsjettfamilie/budsjettfamilie";
import { useBudsjettfamilie } from "@hooks/useBudsjettfamilie";
import type { BudsjettPost } from "@app-types/budsjettfamilie";
import styles from "../budsjettfamilie/BudsjettfamilieScreen.module.css";

/**
 * Sparing — del av Budsjett-familien (§Issue #34, samme mønster som
 * `BudsjettScreen`, porterer §index.html linje 12299–12506). Se
 * `BudsjettScreen.tsx` for hva som bevisst er utenfor denne sliven.
 *
 * Ingen av de fem eksisterende sparepostene (spar_helen, spar_eivind,
 * pensjon, aksjer under `budget/sparing`, aksjer_barn under `budget/barn`)
 * flyttes hit i denne sliven — de forblir der til `SparePostFlyttingScreen`
 * sin engangsflytting kjøres (uendret, utenfor scope, §index.html linje
 * 1074–1080, 14697). Sparegruppene starter derfor tomme, med samme
 * "Ingen poster i «X» ennå"-tilstand som legacy (§index.html linje
 * 12384–12389).
 */
export function SparingScreen() {
  const bf = useBudsjettfamilie("sparingGroups");
  const [metaTarget, setMetaTarget] = useState<{ groupId: string; item: BudsjettPost } | null>(
    null,
  );
  const [drilldownItem, setDrilldownItem] = useState<BudsjettPost | null>(null);

  if (bf.grupper.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  return (
    <div>
      <RoomHeader eyebrow="FORVALTNING" title="Sparing" description="Sparing per måned" />
      <MonthNav month={bf.month} onChange={bf.setMonth} />

      {bf.grupper.data.map((gruppe) => (
        <GroupAccordion
          key={gruppe.id}
          gruppe={gruppe}
          month={bf.month}
          actualTotals={bf.actualTotals}
          emptyMessage={`Ingen poster i «${gruppe.label}» ennå. Legg til under.`}
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
          node="sparingGroups"
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
        <DrilldownModal
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
    </div>
  );
}
