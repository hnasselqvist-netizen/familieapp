import { useEffect, useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { Modal } from "@components/Modal";
import { Retur } from "@components/Retur";
import { RoomHeader } from "@components/RoomHeader";
import {
  calcSpillerom,
  effektivPrognosedato,
  erAktivPrognosepost,
  erPrognosedatoPassert,
  erPrognosepostIPeriode,
  prognoseposterSomTrengerAvklaring,
} from "@domain/liquidity/liquidity";
import { mulighetervedForlop, spilleromOversikt } from "@domain/liquidity/oversikt";
import { saldoforlop } from "@domain/liquidity/saldoforlop";
import { spilleromKlart } from "@domain/lonnsdagsrunde/lonnsdagsrunde";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import { useFamilyId } from "@hooks/useFamilyId";
import { useLiquidity } from "@hooks/useLiquidity";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  LiquidityDisplayType,
  LiquidityPost,
  LiquidityPostDirection,
} from "@app-types/liquidity";
import { ForfallsdagVarsel } from "./ForfallsdagVarsel";
import { HvaHvisKort } from "./HvaHvisKort";
import { type RedigerbareFelt, endredeFelt } from "@domain/liquidity/redigering";
import { PrognoseDato } from "./PrognoseDato";
import { SaldoforlopKort } from "./SaldoforlopKort";
import { SpilleromHode } from "./SpilleromHode";
import { SpilleromMuligheter, SpilleromPlan } from "./SpilleromPlan";
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
  /** Verdiene da redigeringen startet (samtidighetsvern, #59). */
  start: RedigerbareFelt;
  /** Synlig feil fra siste lagringsforsøk; skjemaet står. */
  feil?: string;
  lagrer?: boolean;
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
    start: {
      name: post.name,
      amount: post.amount,
      date: post.date,
      direction: post.direction,
      type: post.type,
    },
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
/** YYYY-MM-DD i lokal tid (ikke UTC — rett etter midnatt ville `toISOString` gi i går). */
function lokalIsoDato(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
    forfallsdagMangler,
    prognosefeil,
  } = useLiquidity();

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
  // Synlig feil fra handlinger utenfor redigeringsdialogen (samtidighet, #59).
  const [handlingsfeil, setHandlingsfeil] = useState<string | null>(null);
  const visFeil = (hva: string) => (e: unknown) =>
    setHandlingsfeil(`${hva}: ${e instanceof Error ? e.message : String(e)}`);
  // Persistent 5-sekunders "Angre"-varsel, uavhengig av listefiltrering
  // (§index.html linje 10516, 10848–10862) — se `angreOppfylt`/
  // `onMarkFulfilled` under for hvorfor dette MÅ ligge utenfor selve
  // post-raden: en oppfylt post filtreres umiddelbart ut av
  // `periodePostList`, så en "Angre"-knapp inni raden ville forsvunnet
  // sammen med raden før brukeren rakk å trykke den.
  const [angreVarsel, setAngreVarsel] = useState<{ id: string; navn: string } | null>(null);
  const familyId = useFamilyId();
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[]>([]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);

  if (liquidity.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const { saldo, saldoUpdated, prognosisDate, posts, lonnDay } = liquidity.data;

  const startIdag = new Date();
  startIdag.setHours(0, 0, 0, 0);
  // Funn H: uten lagret dato vises og beregnes alt mot samme standarddato
  // som generatoren bruker. Ingenting lagres av dette.
  const prognose = effektivPrognosedato(prognosisDate, new Date());
  const tilDato = prognose.dato;
  const postList = Object.values(posts).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const periodePostList = postList.filter(
    (p) => erAktivPrognosepost(p) && erPrognosepostIPeriode(p, startIdag, tilDato),
  );
  const trengerAvklaringListe = prognoseposterSomTrengerAvklaring(postList, startIdag);
  const result = calcSpillerom(saldo, periodePostList, tilDato, startIdag);
  const forlop = saldoforlop(saldo, periodePostList, startIdag, tilDato);
  const oversikt = spilleromOversikt(
    { ...liquidity.data, prognosisDate: tilDato },
    lokalIsoDato(startIdag),
  );
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

  const submitNewPost = () => {
    if (!newPost.name.trim() || !newPost.amount) return;
    addPost({
      name: newPost.name.trim(),
      amount: Number.parseFloat(newPost.amount) || 0,
      direction: newPost.direction,
      date: newPost.date || tilDato,
      type: newPost.type,
    }).catch(visFeil("Posten ble ikke lagt til"));
    setNewPost({ name: "", amount: "", direction: "out", date: "", type: "extra" });
    setShowAddPost(false);
  };

  const onMarkFulfilled = (post: LiquidityPost) => {
    markFulfilled(post.id).catch(visFeil("Posten ble ikke markert som oppfylt"));
    setAngreVarsel({ id: post.id, navn: post.name });
    setTimeout(() => setAngreVarsel((v) => (v?.id === post.id ? null : v)), 5000);
  };

  const onUndoMarkFulfilled = () => {
    if (!angreVarsel) return;
    unmarkFulfilled(angreVarsel.id).catch(visFeil("Angre ble ikke lagret"));
    setAngreVarsel(null);
  };

  // Samtidighet (#59): bare endrede felt, med verdiene fra da
  // redigeringen startet. Endret en annen enhet et av de samme feltene,
  // avvises lagringen synlig og skjemaet står; ingenting skrives.
  const submitEditPost = async () => {
    if (!editingPost || editingPost.lagrer) return;
    const { patch, grunnlag } = endredeFelt(editingPost.start, {
      name: editingPost.name,
      amount: Number.parseFloat(editingPost.amount) || 0,
      date: editingPost.date,
      direction: editingPost.direction,
      type: editingPost.type,
    });
    if (Object.keys(patch).length === 0) {
      setEditingPost(null);
      return;
    }
    setEditingPost((p) => (p ? { ...p, lagrer: true, feil: undefined } : p));
    try {
      await editPost(editingPost.id, patch, grunnlag);
      setEditingPost(null);
    } catch (e) {
      setEditingPost((p) =>
        p ? { ...p, lagrer: false, feil: e instanceof Error ? e.message : String(e) } : p,
      );
    }
  };

  // Fra Lønnsdagsrunden (#59): steget er gjort når saldoen er oppdatert i
  // perioden, prognosedatoen ikke er passert og ingen poster venter.
  const klart = spilleromKlart(
    {
      lonnDay,
      saldoOppdatert: saldoUpdated,
      prognosedatoPassert: erPrognosedatoPassert(prognosisDate, startIdag),
      trengerAvklaring: trengerAvklaringListe.length,
    },
    new Date(),
  );

  return (
    <div>
      <Retur ferdig={klart} ferdigTekst="Spillerommet er oppdatert." />
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Spillerom"
        description="Hvor stort spillerom har vi frem til neste lønn?"
      />

      <SpilleromHode
        saldo={saldo}
        harSaldo={oversikt.harSaldo}
        innbetalinger={result.innbetalinger}
        utbetalinger={result.utbetalinger}
        spillerom={result.spillerom}
        prognosisDate={tilDato}
        saldoAlderMin={saldoAge}
        onSaveSaldo={(belop) => void saveSaldo(belop)}
      />

      <div className={styles.prognosisRow}>
        <span className={styles.prognosisLabel}>Prognose frem til</span>
        <PrognoseDato prognosisDate={prognosisDate} onSave={(d) => void savePrognosisDate(d)} />
        <button
          type="button"
          className={styles.regenerateButton}
          onClick={() => regenerate().catch(() => {})}
        >
          Oppdater prognose
        </button>
      </div>

      {(prognosefeil || handlingsfeil) && (
        <p role="alert" className={styles.feil}>
          {prognosefeil ?? handlingsfeil}
          {handlingsfeil && !prognosefeil && (
            <button
              type="button"
              className={styles.feilLukk}
              onClick={() => setHandlingsfeil(null)}
            >
              Lukk
            </button>
          )}
        </p>
      )}

      {/* Funn F: før forløp og muligheter, så et ufullstendig grunnlag
          aldri leses som «alt dekket». */}
      <ForfallsdagVarsel mangler={forfallsdagMangler} />

      <SaldoforlopKort forlop={forlop} />
      <HvaHvisKort
        saldo={saldo}
        poster={periodePostList}
        idag={lokalIsoDato(startIdag)}
        prognosisDate={tilDato}
        onLeggInn={(post) => addPost(post).catch(visFeil("Posten ble ikke lagt til"))}
      />
      <SpilleromMuligheter
        muligheter={mulighetervedForlop(oversikt.muligheter, forlop.laveste.saldo)}
      />

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
          {editingPost.feil && (
            <p role="alert" className={styles.feil}>
              {editingPost.feil}
            </p>
          )}
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={() => setEditingPost(null)}>
              Avbryt
            </Button>
            <Button onClick={() => void submitEditPost()} disabled={editingPost.lagrer}>
              Lagre
            </Button>
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
                    onClick={() => removePost(post.id).catch(visFeil("Posten ble ikke slettet"))}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {periodePostList.length === 0 && (
        <div className={styles.empty}>Ingen poster i perioden frem til {fmtDate(tilDato)}</div>
      )}

      <SpilleromPlan budgetGroups={budgetGroups} month={startIdag.getMonth()} />

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
