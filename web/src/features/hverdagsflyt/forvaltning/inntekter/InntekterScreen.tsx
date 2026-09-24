import { useState } from "react";
import { Card } from "@components/Card";
import { RoomHeader } from "@components/RoomHeader";
import { DrilldownModal } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/DrilldownModal";
import { GroupAccordion } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/GroupAccordion";
import { MonthNav } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/MonthNav";
import { PostMetaModal } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/PostMetaModal";
import {
  finnHendelserForPost,
  summerGruppeBudsjett,
  summerGruppeFaktisk,
} from "@domain/budsjettfamilie/budsjettfamilie";
import { useBudsjettfamilie } from "@hooks/useBudsjettfamilie";
import type { BudsjettPost } from "@app-types/budsjettfamilie";
import styles from "../budsjettfamilie/BudsjettfamilieScreen.module.css";

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Inntekter — del av Budsjett-familien (§Issue #34, samme mønster som
 * `BudsjettScreen`, porterer §index.html linje 11930–12160). Se
 * `BudsjettScreen.tsx` for hva som bevisst er utenfor denne sliven
 * (korrigering av hendelser/kvitteringer).
 */
export function InntekterScreen() {
  const bf = useBudsjettfamilie("incomeGroups");
  const [metaTarget, setMetaTarget] = useState<{ groupId: string; item: BudsjettPost } | null>(
    null,
  );
  const [drilldownItem, setDrilldownItem] = useState<BudsjettPost | null>(null);

  if (bf.grupper.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const totalBudget = bf.grupper.data.reduce((s, g) => s + summerGruppeBudsjett(g, bf.month), 0);
  const totalFaktisk = bf.grupper.data.reduce(
    (s, g) => s + summerGruppeFaktisk(g, bf.month, bf.actualTotals),
    0,
  );

  return (
    <div>
      <RoomHeader eyebrow="FORVALTNING" title="Inntekter" description="Inntekter per måned" />
      <MonthNav month={bf.month} onChange={bf.setMonth} />

      <div className={styles.summaryRow}>
        <Card style={{ padding: 12 }}>
          <div className={styles.summaryLabel}>Budsjettert</div>
          <div className={styles.summaryValue}>{fmt(totalBudget)}</div>
        </Card>
        <Card style={{ padding: 12 }}>
          <div className={styles.summaryLabel}>Faktisk</div>
          <div className={styles.summaryValue}>{fmt(totalFaktisk)}</div>
        </Card>
      </div>

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
          node="incomeGroups"
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
