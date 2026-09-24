import { useRef, useState } from "react";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { summerPostAar } from "@domain/arsbudsjett/arsbudsjett";
import type { BudsjettGruppe, BudsjettPost } from "@app-types/budsjettfamilie";
import type { ArsbudsjettPostType, UseArsbudsjettResult } from "@hooks/useArsbudsjett";
import styles from "./PostTable.module.css";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n || 0);

export interface VarselRestenPayload {
  type: ArsbudsjettPostType;
  groupId: string;
  itemId: string;
  monthIndex: number;
  value: number;
  postName: string;
  detailId?: string;
}

export interface PostTableProps {
  type: ArsbudsjettPostType;
  grupper: BudsjettGruppe[];
  /** Kostnad+inntekt: `true`. Sparing støtter aldri detaljer (§11). */
  visDetaljer: boolean;
  arsbudsjett: UseArsbudsjettResult;
  onApneFordelModal: (groupId: string, item: BudsjettPost) => void;
  onApneAktiverDetaljerModal: (groupId: string, item: BudsjettPost) => void;
  onApneFjernDetaljModal: (groupId: string, item: BudsjettPost) => void;
  /** Kalles etter en faktisk endret verdi på en FAST post, ikke siste måned — samme varsel-trigger som legacy. */
  onVisAnvendRestenVarsel: (payload: VarselRestenPayload) => void;
}

/**
 * Delt måned-for-måned-tabell for Kostnader/Inntekter/Sparing — 1:1-port
 * av de tre nesten identiske tabellene i `ArsbudsjettScreen` (§index.html
 * linje 13886–14343). Cellene er ALLTID synlige/redigerbare tall
 * (uncontrolled `<input>`, `defaultValue`+`onBlur`-commit) — bevisst IKKE
 * `InlineNumber` (klikk-for-å-redigere), siden Årsbudsjett er en
 * regnearkflate der alle 12 måneder skal være redigerbare samtidig,
 * en annen interaksjon enn Budsjett-familien sin Faktisk/budsjett-kolonne.
 */
export function PostTable({
  type,
  grupper,
  visDetaljer,
  arsbudsjett,
  onApneFordelModal,
  onApneAktiverDetaljerModal,
  onApneFjernDetaljModal,
  onVisAnvendRestenVarsel,
}: PostTableProps) {
  const [ekspandertGruppe, setEkspandertGruppe] = useState<string | null>(null);
  const [ekspandertDetalj, setEkspandertDetalj] = useState<Set<string>>(new Set());
  const origVerdiRef = useRef<Record<string, number>>({});

  const toggleDetalj = (noekkel: string) => {
    setEkspandertDetalj((prev) => {
      const nytt = new Set(prev);
      if (nytt.has(noekkel)) nytt.delete(noekkel);
      else nytt.add(noekkel);
      return nytt;
    });
  };

  const erFastOppforsel = (item: BudsjettPost) =>
    !item.meta || item.meta.oppforsel === "fast" || !item.meta.oppforsel;

  return (
    <div className={styles.scroll}>
      {grupper.map((g) => {
        const apen = ekspandertGruppe === g.id;
        const gruppeSum = g.items.reduce((s, it) => s + summerPostAar(it), 0);
        return (
          <div key={g.id} className={styles.gruppeWrapper}>
            <Card
              onClick={() => setEkspandertGruppe(apen ? null : g.id)}
              style={{ cursor: "pointer" }}
            >
              <div className={styles.gruppeHeader}>
                <span className={styles.gruppeLabel}>{g.label}</span>
                <span className={styles.gruppeSum}>{fmt(gruppeSum)} / år</span>
                <Icon name={apen ? "chevron-up" : "chevron-down"} size={16} />
              </div>
            </Card>

            {apen && (
              <div className={styles.tabellWrapper}>
                <table className={styles.tabell}>
                  <thead>
                    <tr>
                      <th className={styles.thPost}>Post</th>
                      {MONTHS_SHORT.map((m) => (
                        <th key={m} className={styles.thTall}>
                          {m}
                        </th>
                      ))}
                      <th className={styles.thTall}>Sum år</th>
                      <th className={styles.thAksjon}></th>
                      {type === "kostnad" && <th className={styles.thAksjon}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((it) => {
                      const harDetaljer =
                        visDetaljer && it.budgetDetails && it.budgetDetails.length > 0;
                      const detaljNoekkel = `${g.id}|${it.id}`;
                      const detaljApen = ekspandertDetalj.has(detaljNoekkel);
                      return (
                        <PostRad
                          key={it.id}
                          type={type}
                          groupId={g.id}
                          item={it}
                          visDetaljer={visDetaljer}
                          harDetaljer={!!harDetaljer}
                          detaljApen={detaljApen}
                          erFastOppforsel={erFastOppforsel(it)}
                          origVerdiRef={origVerdiRef}
                          arsbudsjett={arsbudsjett}
                          onToggleDetalj={() => toggleDetalj(detaljNoekkel)}
                          onApneFordelModal={() => onApneFordelModal(g.id, it)}
                          onApneAktiverDetaljerModal={() => onApneAktiverDetaljerModal(g.id, it)}
                          onApneFjernDetaljModal={() => onApneFjernDetaljModal(g.id, it)}
                          onVisAnvendRestenVarsel={onVisAnvendRestenVarsel}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface PostRadProps {
  type: ArsbudsjettPostType;
  groupId: string;
  item: BudsjettPost;
  visDetaljer: boolean;
  harDetaljer: boolean;
  detaljApen: boolean;
  erFastOppforsel: boolean;
  origVerdiRef: React.RefObject<Record<string, number>>;
  arsbudsjett: UseArsbudsjettResult;
  onToggleDetalj: () => void;
  onApneFordelModal: () => void;
  onApneAktiverDetaljerModal: () => void;
  onApneFjernDetaljModal: () => void;
  onVisAnvendRestenVarsel: (payload: VarselRestenPayload) => void;
}

function PostRad({
  type,
  groupId,
  item,
  visDetaljer,
  harDetaljer,
  detaljApen,
  erFastOppforsel,
  origVerdiRef,
  arsbudsjett,
  onToggleDetalj,
  onApneFordelModal,
  onApneAktiverDetaljerModal,
  onApneFjernDetaljModal,
  onVisAnvendRestenVarsel,
}: PostRadProps) {
  const arsSum = summerPostAar(item);
  const pattern = item.meta?.paymentPattern ?? "monthly";

  return (
    <>
      <tr>
        <td className={styles.tdPost}>
          {harDetaljer && (
            <button type="button" className={styles.detaljToggle} onClick={onToggleDetalj}>
              <Icon name={detaljApen ? "chevron-down" : "chevron-right"} size={11} />
            </button>
          )}
          {item.name}
        </td>
        {item.months.map((mo, mi) => (
          <td key={mi} className={styles.tdTall}>
            {harDetaljer ? (
              <div className={styles.readOnlyCelle}>{fmt(mo.budget)}</div>
            ) : (
              <input
                type="number"
                defaultValue={mo.budget}
                aria-label={`${item.name} — ${MONTHS_SHORT[mi]}`}
                onFocus={(e) => {
                  e.target.select();
                  origVerdiRef.current[`${groupId}|${item.id}|${mi}`] = mo.budget;
                }}
                onBlur={(e) => {
                  const nyVerdi = Number.parseFloat(e.target.value) || 0;
                  void arsbudsjett.updateMonth(type, groupId, item.id, mi, nyVerdi);
                  const opprinnelig = origVerdiRef.current[`${groupId}|${item.id}|${mi}`];
                  const faktiskEndret = opprinnelig === undefined || nyVerdi !== opprinnelig;
                  if (faktiskEndret && erFastOppforsel && mi < 11) {
                    onVisAnvendRestenVarsel({
                      type,
                      groupId,
                      itemId: item.id,
                      monthIndex: mi,
                      value: nyVerdi,
                      postName: item.name,
                    });
                  }
                }}
                className={styles.input}
              />
            )}
          </td>
        ))}
        <td className={`${styles.tdTall} ${styles.tdSum}`}>{fmt(arsSum)}</td>
        <td className={styles.tdAksjon}>
          {!harDetaljer && (
            <button type="button" className={styles.fordelKnapp} onClick={onApneFordelModal}>
              Fordel år
            </button>
          )}
        </td>
        {type === "kostnad" && (
          <td className={styles.tdAksjon}>
            {!harDetaljer && (
              <select
                value={pattern}
                onChange={(e) =>
                  void arsbudsjett.updatePaymentPattern(groupId, item.id, e.target.value)
                }
                className={styles.select}
              >
                <option value="monthly">Månedlig</option>
                <option value="quarterly">Kvartalsvis</option>
                <option value="yearly">Årlig</option>
              </select>
            )}
          </td>
        )}
      </tr>

      {visDetaljer && !harDetaljer && (
        <tr>
          <td colSpan={16} className={styles.tdBrukDetaljer}>
            <button
              type="button"
              className={styles.lenkeKnapp}
              onClick={onApneAktiverDetaljerModal}
            >
              Bruk detaljer
            </button>
          </td>
        </tr>
      )}

      {harDetaljer &&
        detaljApen &&
        (item.budgetDetails ?? []).map((d) => (
          <tr key={d.id} className={styles.detaljRad}>
            <td className={styles.tdDetaljNavn}>
              <input
                value={d.name}
                onChange={(e) =>
                  void arsbudsjett.renameDetail(type, groupId, item.id, d.id, e.target.value)
                }
                className={styles.detaljNavnInput}
              />
            </td>
            {d.months.map((mo, mi) => (
              <td key={mi} className={styles.tdTall}>
                <input
                  type="number"
                  defaultValue={mo.budget}
                  aria-label={`${d.name} — ${MONTHS_SHORT[mi]}`}
                  onFocus={(e) => {
                    e.target.select();
                    origVerdiRef.current[`detalj|${groupId}|${item.id}|${d.id}|${mi}`] = mo.budget;
                  }}
                  onBlur={(e) => {
                    const nyVerdi = Number.parseFloat(e.target.value) || 0;
                    void arsbudsjett.updateDetailMonth(type, groupId, item.id, d.id, mi, nyVerdi);
                    const opprinnelig =
                      origVerdiRef.current[`detalj|${groupId}|${item.id}|${d.id}|${mi}`];
                    const faktiskEndret = opprinnelig === undefined || nyVerdi !== opprinnelig;
                    if (faktiskEndret && mi < 11) {
                      onVisAnvendRestenVarsel({
                        type,
                        groupId,
                        itemId: item.id,
                        monthIndex: mi,
                        value: nyVerdi,
                        postName: d.name,
                        detailId: d.id,
                      });
                    }
                  }}
                  className={styles.detaljInput}
                />
              </td>
            ))}
            <td className={styles.tdDetaljSum}>
              {fmt(d.months.reduce((s, mo) => s + (mo.budget || 0), 0))}
            </td>
            <td className={styles.tdAksjon}>
              <button
                type="button"
                aria-label={`Fjern ${d.name}`}
                className={styles.fjernDetaljKnapp}
                onClick={() => {
                  if ((item.budgetDetails ?? []).length === 1) onApneFjernDetaljModal();
                  else void arsbudsjett.removeDetail(type, groupId, item.id, d.id);
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </td>
          </tr>
        ))}

      {harDetaljer && detaljApen && (
        <tr>
          <td colSpan={16} className={styles.tdLeggTilDetalj}>
            <button
              type="button"
              className={styles.lenkeKnapp}
              onClick={() => void arsbudsjett.addDetail(type, groupId, item.id)}
            >
              + Legg til detalj
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
