import { useState } from "react";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { InlineNumber } from "@components/InlineNumber";
import {
  hentFaktiskForPost,
  isOver,
  summerGruppeBudsjett,
  summerGruppeFaktisk,
} from "@domain/budsjettfamilie/budsjettfamilie";
import type { BudsjettGruppe, BudsjettPost } from "@app-types/budsjettfamilie";
import styles from "./GroupAccordion.module.css";

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);

export interface GroupAccordionProps {
  gruppe: BudsjettGruppe;
  month: number;
  actualTotals: Record<string, number>;
  emptyMessage?: string;
  onUpdateBudget: (groupId: string, itemId: string, value: number) => void;
  onUpdateSpent: (groupId: string, itemId: string, value: number) => void;
  onRemoveItem: (groupId: string, itemId: string) => void;
  onAddItem: (groupId: string, fields: { name: string; budget: number; spent: number }) => void;
  onOpenMeta: (groupId: string, item: BudsjettPost) => void;
  onOpenDrilldown: (item: BudsjettPost) => void;
}

/**
 * Delt gruppe-/postliste for Budsjett/Inntekter/Sparing — porterer
 * `GRow`/`AddItemRow` (§index.html linje 11463, 11541 m.fl., identisk
 * mønster i alle tre skjermer per §Issue #34-kartlegging) som ÉN
 * komponent. Alltid i redigeringsmodus (legacy sin `edit=false`-gren i
 * `BudsjettScreen.GRow` er aldri faktisk nådd — `edit={true}` alltid,
 * §index.html linje 11652 — derfor ikke portert som eget valg her).
 */
export function GroupAccordion({
  gruppe,
  month,
  actualTotals,
  emptyMessage,
  onUpdateBudget,
  onUpdateSpent,
  onRemoveItem,
  onAddItem,
  onOpenMeta,
  onOpenDrilldown,
}: GroupAccordionProps) {
  const [open, setOpen] = useState(false);
  const [nyttNavn, setNyttNavn] = useState("");
  const [nyttBudsjett, setNyttBudsjett] = useState("");
  const [nyttFaktisk, setNyttFaktisk] = useState("");

  const gruppeBudsjett = summerGruppeBudsjett(gruppe, month);
  const gruppeFaktisk = summerGruppeFaktisk(gruppe, month, actualTotals);
  const over = isOver(gruppeFaktisk, gruppeBudsjett);

  const leggTil = () => {
    if (!nyttNavn.trim()) return;
    onAddItem(gruppe.id, {
      name: nyttNavn.trim(),
      budget: Number.parseFloat(nyttBudsjett) || 0,
      spent: Number.parseFloat(nyttFaktisk) || 0,
    });
    setNyttNavn("");
    setNyttBudsjett("");
    setNyttFaktisk("");
  };

  return (
    <div className={styles.group}>
      <Card
        onClick={() => setOpen((v) => !v)}
        accent={over ? "var(--color-clay)" : "var(--g-green)"}
        style={{ cursor: "pointer" }}
      >
        <div className={styles.header}>
          <span className={styles.label}>{gruppe.label}</span>
          <div className={styles.headerRight}>
            <span className={over ? styles.amountWarn : styles.amount}>{fmt(gruppeFaktisk)}</span>
            <span className={styles.amountMax}> / {fmt(gruppeBudsjett)}</span>
          </div>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
        </div>
      </Card>

      {open && (
        <div className={styles.body}>
          {gruppe.items.length === 0 && emptyMessage && (
            <div className={styles.empty}>{emptyMessage}</div>
          )}

          {gruppe.items.length > 0 && (
            <div className={styles.columnHeader}>
              <span>Post</span>
              <span className={styles.colRight}>Budsjett</span>
              <span className={styles.colRight}>Faktisk</span>
              <span />
            </div>
          )}

          {gruppe.items.map((it) => {
            const mo = it.months[month] ?? { budget: 0, spent: 0 };
            const faktisk = hentFaktiskForPost(actualTotals, it);
            const faktiskBelop = faktisk !== undefined ? Math.round(faktisk) : mo.spent;
            const overPost = isOver(faktiskBelop, mo.budget);
            return (
              <div key={it.id} className={styles.itemRow}>
                <div className={styles.itemGrid}>
                  <button
                    type="button"
                    className={styles.itemName}
                    onClick={() => onOpenMeta(gruppe.id, it)}
                  >
                    <span className={styles.itemNameText}>{it.name}</span>
                    {it.meta?.arkivert && <Icon name="folder-open" size={12} />}
                    {it.meta?.automatisk && <Icon name="sparkles" size={12} />}
                    <span className={styles.metaBadge}>{it.meta ? "✓" : "+"}</span>
                  </button>
                  <InlineNumber
                    value={mo.budget}
                    onChange={(v) => onUpdateBudget(gruppe.id, it.id, v)}
                    ariaLabel={`Budsjett for ${it.name}`}
                  />
                  <InlineNumber
                    value={faktiskBelop}
                    onChange={(v) => onUpdateSpent(gruppe.id, it.id, v)}
                    warn={overPost}
                    ariaLabel={`Faktisk for ${it.name}`}
                  />
                  <button
                    type="button"
                    className={styles.removeButton}
                    aria-label={`Fjern ${it.name}`}
                    onClick={() => onRemoveItem(gruppe.id, it.id)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                {faktisk !== undefined && (
                  <button
                    type="button"
                    className={styles.drilldownLink}
                    onClick={() => onOpenDrilldown(it)}
                  >
                    Vis hendelser bak dette tallet
                  </button>
                )}
              </div>
            );
          })}

          <div className={styles.addRow}>
            <input
              value={nyttNavn}
              onChange={(e) => setNyttNavn(e.target.value)}
              placeholder="Ny post…"
              className={styles.addInput}
            />
            <input
              type="number"
              value={nyttBudsjett}
              onChange={(e) => setNyttBudsjett(e.target.value)}
              placeholder="Budsjett"
              className={styles.addInputNum}
            />
            <input
              type="number"
              value={nyttFaktisk}
              onChange={(e) => setNyttFaktisk(e.target.value)}
              placeholder="Faktisk"
              className={styles.addInputNum}
            />
            <button
              type="button"
              className={styles.addButton}
              onClick={leggTil}
              aria-label="Legg til post"
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
