import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { Modal } from "@components/Modal";
import { RoomHeader } from "@components/RoomHeader";
import {
  calcSpillerom,
  erAktivPrognosepost,
  erPrognosepostIPeriode,
} from "@domain/liquidity/liquidity";
import { useLiquidity } from "@hooks/useLiquidity";
import type {
  LiquidityDisplayType,
  LiquidityPost,
  LiquidityPostDirection,
} from "@app-types/liquidity";
import styles from "./SpilleromScreen.module.css";

const TYPE_LABELS: Record<LiquidityDisplayType, string> = {
  inn: "Innbetalinger",
  fast: "Faste poster",
  variabel: "Budsjetterte variable",
  extra: "Ikke budsjettert",
  ukjent: "⚠️ Ukjent type (slett eller oppdater)",
};

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);
const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";

interface NewPostForm {
  name: string;
  amount: string;
  direction: LiquidityPostDirection;
  date: string;
  type: LiquidityDisplayType;
}

/**
 * Spillerom — første Forvaltning-slice migrert fra index.html
 * (§Issue #34). Funksjonelt likeverdig med dagens `SpilleromScreen`
 * (§index.html linje 10381–10935): domenelogikk i @domain/liquidity,
 * Firebase-tilgang i @data/liquidity.repository.ts via @hooks/useLiquidity.
 *
 * **Bevisst utenfor denne sliven** (§Issue #34): Budsjett/Inntekter/
 * Sparing sin egen redigerings-UI, `finnNesteStorreUtbetaling`/
 * `calculateCommittedCashflow` (brukt av `ForvaltningScreen` sitt
 * eget dashbord-kort, ikke av selve SpilleromScreen), og
 * `HendelseDrillDownModal`/`KorrigerHendelseModal` (forsoningslaget —
 * ikke koblet til Spillerom i legacy heller).
 *
 * **Ikke koblet til hovednavigasjonen ennå** — reachable direkte via
 * `/forvaltning/spillerom`, men `/forvaltning` peker fortsatt til
 * `LegacyBridge` uendret, så ingenting i dagens brukerflyt endres før
 * Helen har godkjent faktisk bruk (§Issue #34 sitt ferdigkriterium).
 */
export function SpilleromScreen() {
  const {
    liquidity,
    saveSaldo,
    savePrognosisDate,
    addPost,
    removePost,
    markFulfilled,
    unmarkFulfilled,
    editPost,
    regenerate,
  } = useLiquidity();

  const [editSaldo, setEditSaldo] = useState(false);
  const [saldoInput, setSaldoInput] = useState("");
  const [editDate, setEditDate] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [showAddPost, setShowAddPost] = useState(false);
  const [newPost, setNewPost] = useState<NewPostForm>({
    name: "",
    amount: "",
    direction: "out",
    date: "",
    type: "extra",
  });
  const [editingPost, setEditingPost] = useState<LiquidityPost | null>(null);
  const [angreVarsel, setAngreVarsel] = useState<{ id: string; navn: string } | null>(null);

  if (liquidity.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const { saldo, saldoUpdated, prognosisDate, posts } = liquidity.data;

  const startIdag = new Date();
  startIdag.setHours(0, 0, 0, 0);
  const postList = Object.values(posts).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const periodePostList = postList.filter(
    (p) => erAktivPrognosepost(p) && erPrognosepostIPeriode(p, startIdag, prognosisDate),
  );
  const trengerAvklaringListe = postList.filter((p) => {
    if (p.kilde !== "manuell" || !erAktivPrognosepost(p) || !p.date) return false;
    const d = new Date(p.date);
    if (Number.isNaN(d.getTime())) return false;
    return d < startIdag;
  });
  const result = calcSpillerom(saldo, periodePostList, prognosisDate, startIdag);
  const isPositive = result.spillerom >= 0;
  const saldoAge = saldoUpdated ? Math.round((Date.now() - saldoUpdated) / 60000) : null;

  const groupedPosts: Partial<Record<LiquidityDisplayType, LiquidityPost[]>> = {};
  const KNOWN_TYPES: LiquidityDisplayType[] = ["inn", "fast", "variabel", "extra"];
  periodePostList.forEach((p) => {
    const candidate = p.direction === "in" ? "inn" : p.type;
    const bucket: LiquidityDisplayType = KNOWN_TYPES.includes(candidate as LiquidityDisplayType)
      ? (candidate as LiquidityDisplayType)
      : "ukjent";
    (groupedPosts[bucket] ??= []).push(p);
  });

  const submitSaldo = () => {
    const amt = Number.parseFloat(saldoInput.replace(/\s/g, "").replace(",", ".")) || 0;
    void saveSaldo(amt);
    setEditSaldo(false);
  };

  const submitDate = () => {
    void savePrognosisDate(dateInput);
    setEditDate(false);
  };

  const submitNewPost = () => {
    if (!newPost.name.trim() || !newPost.amount) return;
    void addPost({
      name: newPost.name.trim(),
      amount: Number.parseFloat(newPost.amount) || 0,
      direction: newPost.direction,
      date: newPost.date || prognosisDate,
      type: newPost.type,
    });
    setNewPost({ name: "", amount: "", direction: "out", date: "", type: "extra" });
    setShowAddPost(false);
  };

  const onMarkFulfilled = (post: LiquidityPost) => {
    void markFulfilled(post.id);
    setAngreVarsel({ id: post.id, navn: post.name });
    setTimeout(() => setAngreVarsel((v) => (v?.id === post.id ? null : v)), 5000);
  };

  return (
    <div>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Spillerom"
        description="Prognose frem til valgt dato"
      />

      <div className={styles.summaryRow}>
        <Card style={{ padding: 12 }}>
          <div className={styles.summaryLabel}>Disponibelt</div>
          {editSaldo ? (
            <div className={styles.editRow}>
              <input
                autoFocus
                value={saldoInput}
                onChange={(e) => setSaldoInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSaldo()}
                className={styles.input}
              />
              <button
                type="button"
                onClick={submitSaldo}
                className={styles.iconButton}
                aria-label="Lagre saldo"
              >
                <Icon name="check" size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.summaryValueButton}
              onClick={() => {
                setSaldoInput(String(saldo || ""));
                setEditSaldo(true);
              }}
            >
              {fmt(result.disponibelt)}
              {saldoAge !== null && (
                <span className={styles.saldoAge}>oppdatert for {saldoAge} min siden</span>
              )}
            </button>
          )}
        </Card>
        <Card style={{ padding: 12 }}>
          <div className={styles.summaryLabel}>Bundet</div>
          <div className={styles.summaryValue}>{fmt(result.bundet)}</div>
        </Card>
        <Card style={{ padding: 12 }} accent={isPositive ? "var(--g-green)" : "var(--color-clay)"}>
          <div className={styles.summaryLabel}>Spillerom</div>
          <div className={styles.summaryValue}>{fmt(result.spillerom)}</div>
        </Card>
      </div>

      <div className={styles.prognosisRow}>
        <span className={styles.prognosisLabel}>Prognose frem til</span>
        {editDate ? (
          <div className={styles.editRow}>
            <input
              type="date"
              autoFocus
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className={styles.input}
            />
            <button
              type="button"
              onClick={submitDate}
              className={styles.iconButton}
              aria-label="Lagre dato"
            >
              <Icon name="check" size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.prognosisDateButton}
            onClick={() => {
              setDateInput(prognosisDate);
              setEditDate(true);
            }}
          >
            {fmtDate(prognosisDate)}
          </button>
        )}
        <button type="button" className={styles.regenerateButton} onClick={() => void regenerate()}>
          Oppdater prognose
        </button>
      </div>

      {trengerAvklaringListe.length > 0 && (
        <div className={styles.avklaringBanner}>
          {trengerAvklaringListe.length} tidligere post(er) trenger avklaring (forfalt, ikke markert
          oppfylt)
        </div>
      )}

      <div className={styles.addPostRow}>
        <Button size="compact" onClick={() => setShowAddPost(true)}>
          ＋ Legg til post
        </Button>
      </div>

      {showAddPost && (
        <Modal title="Ny prognosepost" onClose={() => setShowAddPost(false)}>
          <input
            placeholder="Navn"
            value={newPost.name}
            onChange={(e) => setNewPost((p) => ({ ...p, name: e.target.value }))}
            className={styles.modalInput}
          />
          <input
            placeholder="Beløp"
            value={newPost.amount}
            onChange={(e) => setNewPost((p) => ({ ...p, amount: e.target.value }))}
            className={styles.modalInput}
          />
          <input
            type="date"
            value={newPost.date}
            onChange={(e) => setNewPost((p) => ({ ...p, date: e.target.value }))}
            className={styles.modalInput}
          />
          <select
            value={newPost.direction}
            onChange={(e) =>
              setNewPost((p) => ({ ...p, direction: e.target.value as LiquidityPostDirection }))
            }
            className={styles.modalInput}
          >
            <option value="out">Utbetaling</option>
            <option value="in">Innbetaling</option>
          </select>
          <Button onClick={submitNewPost} disabled={!newPost.name.trim() || !newPost.amount}>
            Legg til
          </Button>
        </Modal>
      )}

      {editingPost && (
        <Modal title="Rediger post" onClose={() => setEditingPost(null)}>
          <input
            defaultValue={editingPost.name}
            onBlur={(e) => void editPost(editingPost.id, { name: e.target.value })}
            className={styles.modalInput}
          />
          <input
            defaultValue={String(editingPost.amount)}
            onBlur={(e) =>
              void editPost(editingPost.id, { amount: Number.parseFloat(e.target.value) || 0 })
            }
            className={styles.modalInput}
          />
          <input
            type="date"
            defaultValue={editingPost.date}
            onBlur={(e) => void editPost(editingPost.id, { date: e.target.value })}
            className={styles.modalInput}
          />
          <Button
            variant="destructive"
            onClick={() => {
              void removePost(editingPost.id);
              setEditingPost(null);
            }}
          >
            <Icon name="trash-2" size={14} />
            Fjern post
          </Button>
        </Modal>
      )}

      {([...KNOWN_TYPES, "ukjent"] as LiquidityDisplayType[])
        .filter((t) => groupedPosts[t]?.length)
        .map((type) => (
          <div key={type} className={styles.group}>
            <div className={styles.groupLabel}>{TYPE_LABELS[type]}</div>
            {(groupedPosts[type] ?? []).map((post) => (
              <Card key={post.id} style={{ padding: "8px 12px", marginBottom: 6 }}>
                <div className={styles.postRow}>
                  <button
                    type="button"
                    className={styles.postMain}
                    onClick={() => setEditingPost(post)}
                  >
                    <span className={styles.postName}>{post.name}</span>
                    <span className={styles.postDate}>{fmtDate(post.date)}</span>
                  </button>
                  <span className={styles.postAmount}>{fmt(post.amount)}</span>
                  {post.kilde === "manuell" &&
                    (angreVarsel?.id === post.id ? (
                      <button
                        type="button"
                        className={styles.undoButton}
                        onClick={() => {
                          void unmarkFulfilled(post.id);
                          setAngreVarsel(null);
                        }}
                      >
                        Angre
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Marker ${post.name} som oppfylt`}
                        onClick={() => onMarkFulfilled(post)}
                      >
                        <Icon name="check" size={16} />
                      </button>
                    ))}
                </div>
              </Card>
            ))}
          </div>
        ))}

      {periodePostList.length === 0 && (
        <div className={styles.empty}>
          Ingen poster i perioden frem til {fmtDate(prognosisDate)}
        </div>
      )}
    </div>
  );
}
