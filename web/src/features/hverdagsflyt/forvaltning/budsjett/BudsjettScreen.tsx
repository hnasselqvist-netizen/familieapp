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
 * Budsjett — andre Forvaltning-slice migrert fra index.html (§Issue #34,
 * Kontrolltårn-beslutning i kommentar 5815438614). Funksjonelt
 * likeverdig med dagens `BudsjettScreen` (§index.html linje 11477–11727)
 * for gruppe-/postredigering og Faktisk-visning/drilldown.
 *
 * **Bevisst utenfor denne sliven**: korrigering av hendelser/kvitteringer
 * (`KorrigerHendelseModal`/`KvitteringDetalj`/"Lær kobling") — drilldown
 * her er READ-ONLY, ingen skriving til `hendelser`/`receipts`/`rules`.
 * Se `domain/budsjettfamilie/budsjettfamilie.ts` sin toppkommentar.
 *
 * **Ikke koblet til hovednavigasjonen ennå** — reachable direkte via
 * `/forvaltning/budsjett`, `/forvaltning` peker fortsatt til
 * `LegacyBridge` uendret.
 */
export function BudsjettScreen() {
  const bf = useBudsjettfamilie("budget");
  const [metaTarget, setMetaTarget] = useState<{ groupId: string; item: BudsjettPost } | null>(
    null,
  );
  const [drilldownItem, setDrilldownItem] = useState<BudsjettPost | null>(null);

  if (bf.grupper.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  return (
    <div>
      <RoomHeader eyebrow="FORVALTNING" title="Budsjett" description="Kostnader per måned" />
      <MonthNav month={bf.month} onChange={bf.setMonth} />

      {bf.grupper.data.map((gruppe) => (
        <GroupAccordion
          key={gruppe.id}
          gruppe={gruppe}
          month={bf.month}
          actualTotals={bf.actualTotals}
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
          node="budget"
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
