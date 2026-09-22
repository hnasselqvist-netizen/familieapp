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
  type: string;
}

interface EditPostForm {
  id: string;
  kilde: LiquidityPost["kilde"];
  name: string;
  amount: string;
  date: string;
  direction: LiquidityPostDirection;
  type: string;
}

function toEditForm(post: LiquidityPost): EditPostForm {
  return {
    id: post.id,
    kilde: post.kilde,
    name: post.name,
    amount: String(post.amount),
    date: post.date,
    direction: post.direction,
    type: post.type,
  };
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
    type: "fast",
  });
  // Arbeidskopi — lagres kun via eksplisitt "Lagre" (§Kontrolltårn-
  // review, PR #35): speiler legacy sin `editPost`-state (§index.html
  // linje 10384, 10865–10926), IKKE per-felt auto-lagring på blur.
  const [editingPost, setEditingPost] = useState<EditPostForm | null>(null);
  // Persistent 5-sekunders "Angre"-varsel, uavhengig av listefiltrering
  // (§index.html linje 10516, 10848–10862) — se `angreOppfylt`/
  // `onMarkFulfilled` under for hvorfor dette MÅ ligge utenfor selve
  // post-raden: en oppfylt post filtreres umiddelbart ut av
  // `periodePostList`, så en "Angre"-knapp inni raden ville forsvunnet
  // sammen med raden før brukeren rakk å trykke den.
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

  const onUndoMarkFulfilled = () => {
    if (!angreVarsel) return;
    void unmarkFulfilled(angreVarsel.id);
    setAngreVarsel(null);
  };

  const submitEditPost = () => {
    if (!editingPost) return;
    void editPost(editingPost.id, {
      name: editingPost.name,
      amount: Number.parseFloat(editingPost.amount) || 0,
      date: editingPost.date,
      direction: editingPost.direction,
      type: editingPost.type,
    });
    setEditingPost(null);
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
          <div className={styles.formGrid}>
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
          </div>
          <div className={styles.formGrid}>
            <select
              value={newPost.direction}
              onChange={(e) =>
                setNewPost((p) => ({
                  ...p,
                  direction: e.target.value as LiquidityPostDirection,
                  type: e.target.value === "in" ? "inn" : "fast",
                }))
              }
              className={styles.modalSelect}
            >
              <option value="out">Utbetaling</option>
              <option value="in">Innbetaling</option>
            </select>
            <select
              value={newPost.type}
              onChange={(e) => setNewPost((p) => ({ ...p, type: e.target.value }))}
              className={styles.modalSelect}
            >
              <option value="fast">Fast</option>
              <option value="variabel">Variabel</option>
              <option value="extra">Ekstra</option>
              <option value="inn">Innbetaling</option>
            </select>
          </div>
          <Button onClick={submitNewPost} disabled={!newPost.name.trim() || !newPost.amount}>
            Legg til
          </Button>
        </Modal>
      )}

      {editingPost && (
        <Modal
          title={editingPost.kilde === "generator" ? "Rediger generert post" : "Rediger post"}
          onClose={() => setEditingPost(null)}
        >
          {editingPost.kilde === "generator" && (
            <div className={styles.generatorNotice}>
              Generert post. Endringer merkes som manuelt overstyrt.
            </div>
          )}
          <input
            value={editingPost.name}
            onChange={(e) => setEditingPost((p) => (p ? { ...p, name: e.target.value } : p))}
            className={styles.modalInput}
            placeholder="Navn"
          />
          <div className={styles.formGrid}>
            <input
              value={editingPost.amount}
              onChange={(e) => setEditingPost((p) => (p ? { ...p, amount: e.target.value } : p))}
              className={styles.modalInput}
              placeholder="Beløp"
            />
            <input
              type="date"
              value={editingPost.date}
              onChange={(e) => setEditingPost((p) => (p ? { ...p, date: e.target.value } : p))}
              className={styles.modalInput}
            />
          </div>
          <div className={styles.formGrid}>
            <select
              value={editingPost.direction}
              onChange={(e) =>
                setEditingPost((p) =>
                  p ? { ...p, direction: e.target.value as LiquidityPostDirection } : p,
                )
              }
              className={styles.modalSelect}
            >
              <option value="out">Utbetaling</option>
              <option value="in">Innbetaling</option>
            </select>
            <select
              value={editingPost.type}
              onChange={(e) => setEditingPost((p) => (p ? { ...p, type: e.target.value } : p))}
              className={styles.modalSelect}
            >
              <option value="fast">Fast</option>
              <option value="variabel">Variabel</option>
              <option value="extra">Ekstra</option>
              <option value="inn">Innbetaling</option>
            </select>
          </div>
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={() => setEditingPost(null)}>
              Avbryt
            </Button>
            <Button onClick={submitEditPost}>Lagre</Button>
          </div>
        </Modal>
      )}

      {trengerAvklaringListe.length > 0 && (
        <div className={styles.avklaringSection}>
          <div className={styles.avklaringHeading}>Trenger avklaring</div>
          {trengerAvklaringListe.map((post) => (
            <Card
              key={post.id}
              accent="var(--color-gold)"
              style={{ padding: "8px 12px", marginBottom: 6 }}
            >
              <div className={styles.postRow}>
                <button
                  type="button"
                  className={styles.postMain}
                  onClick={() => setEditingPost(toEditForm(post))}
                >
                  <span className={styles.postName}>{post.name}</span>
                  <span className={styles.postDate}>{fmtDate(post.date)}</span>
                </button>
                <span className={styles.postAmount}>
                  {post.direction === "in" ? "+" : "-"}
                  {fmt(post.amount)}
                </span>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Marker ${post.name} som oppfylt`}
                  onClick={() => onMarkFulfilled(post)}
                >
                  <Icon name="check" size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
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
                    onClick={() => setEditingPost(toEditForm(post))}
                  >
                    <span className={styles.postName}>{post.name}</span>
                    <span className={styles.postDate}>{fmtDate(post.date)}</span>
                  </button>
                  <span className={styles.postAmount}>{fmt(post.amount)}</span>
                  {post.kilde === "manuell" && (
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Marker ${post.name} som oppfylt`}
                      onClick={() => onMarkFulfilled(post)}
                    >
                      <Icon name="check" size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.removeButton}
                    aria-label={`Fjern ${post.name}`}
                    onClick={() => void removePost(post.id)}
                  >
                    <Icon name="x" size={14} />
                  </button>
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

      {angreVarsel && (
        <div className={styles.toast}>
          <span>{angreVarsel.navn} er markert som oppfylt</span>
          <button type="button" className={styles.toastButton} onClick={onUndoMarkFulfilled}>
            Angre
          </button>
        </div>
      )}
    </div>
  );
}
