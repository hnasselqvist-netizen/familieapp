import { useEffect, useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { Modal } from "@components/Modal";
import { RoomHeader } from "@components/RoomHeader";
import {
  filtrerRegler,
  MATCHTYPE_LABEL,
  MODE_LABEL,
  monsterFelt,
  ovrigeRegler,
  type RegelFelt,
  type RegelGrupper,
  type RegelSeksjon,
  regelStatus,
  reglerPerNiva,
  sorterRegler,
  spareReglerGruppert,
  tellTreff,
  velgForSammenslaing,
} from "@domain/forsoning/regelsenter";
import type { MatchType, RegelMode, RegelRecord } from "@app-types/forsoning";
import styles from "./RegelsenterScreen.module.css";

export interface RegelsenterViewProps {
  regler: RegelRecord[];
  grupper: RegelGrupper;
  transaksjoner: readonly { tekst?: string | null }[];
  /** Aktiveringsporten — `false` til R3b-cutover (§hooks/regelsenterAktivering.ts). */
  skrivingAktiv: boolean;
  onOppdater: (id: string, felt: RegelFelt) => void;
  onSlett: (id: string) => void;
  onSlaSammen: (aId: string, bId: string) => void;
}

const MATCHTYPER: MatchType[] = ["er_lik", "inneholder", "starter_med"];
const MODES: RegelMode[] = ["auto", "suggest", "review", "disabled"];

const fmtD = (d?: string) =>
  d
    ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" })
    : "—";
const conf = (r: RegelRecord) => (r.confidence !== undefined ? r.confidence : 100);

/**
 * RegelSenter — presentasjon (§Issue #34 R1), portert fra legacy
 * `RegelSenter` (`index.html` ~12515–13201) med samme søk, sortering,
 * status, nivå-/sparegruppering og redigeringsfelt. All logikk ligger i
 * `domain/forsoning/regelsenter.ts`.
 *
 * Med `skrivingAktiv === false` (dagens tilstand, til R3b) er skjermen
 * ren visning: ingen redigeringskontroller, ingen sletting, ingen
 * sammenslåing. «Kjør regler» hører til R3 og er ikke med.
 */
export function RegelsenterView({
  regler,
  grupper,
  transaksjoner,
  skrivingAktiv,
  onOppdater,
  onSlett,
  onSlaSammen,
}: RegelsenterViewProps) {
  const [sok, setSok] = useState("");
  const [valgtId, setValgtId] = useState<string | null>(null);
  const [sammenslaModus, setSammenslaModus] = useState(false);
  const [valgte, setValgte] = useState<string[]>([]);

  const status = regelStatus(regler);
  const sortert = sorterRegler(filtrerRegler(regler, sok));
  const spare = spareReglerGruppert(sortert, grupper);
  const nivaer = reglerPerNiva(sortert, grupper);
  const ovrige = ovrigeRegler(sortert, grupper);
  const valgt = valgtId ? regler.find((r) => r.id === valgtId) : undefined;

  const klikkRad = (r: RegelRecord) => {
    if (sammenslaModus) setValgte((prev) => velgForSammenslaing(prev, r.id));
    else setValgtId(r.id);
  };

  const seksjon = (s: RegelSeksjon, nivaa: "hoved" | "under" = "hoved") => (
    <section key={s.key} className={nivaa === "under" ? styles.underseksjon : styles.seksjon}>
      <h2 className={nivaa === "under" ? styles.underseksjonTittel : styles.seksjonTittel}>
        {s.label} <span className={styles.antall}>({s.regler.length})</span>
      </h2>
      <Card>
        {s.regler.map((r) => (
          <RegelRad
            key={r.id}
            r={r}
            valgt={valgte.includes(r.id)}
            sammenslaModus={sammenslaModus}
            onKlikk={() => klikkRad(r)}
          />
        ))}
      </Card>
    </section>
  );

  return (
    <div>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Regelsenter"
        description="Oversikt over det Regelmotoren har lært. Endringer påvirker kun fremtidige transaksjoner — historiske transaksjoner endres aldri."
      />

      {!skrivingAktiv && (
        <div className={styles.notis} role="note">
          Kun visning. Regler redigeres, slås sammen og kjøres fortsatt i den gamle appen til
          Bankimport er flyttet.
        </div>
      )}

      <div className={styles.status}>
        {[
          ["Totalt", status.totalt],
          ["Aktive", status.aktive],
          ["Automatiske", status.automatiske],
          ["Krever vurdering", status.kreverVurdering],
        ].map(([label, verdi]) => (
          <div key={label} className={styles.statusFelt}>
            <div className={styles.statusLabel}>{label}</div>
            <div className={styles.statusVerdi}>{verdi}</div>
          </div>
        ))}
      </div>

      <div className={styles.sokRad}>
        <input
          value={sok}
          onChange={(e) => setSok(e.target.value)}
          placeholder="Søk i mønster eller kobling…"
          aria-label="Søk i regler"
          className={styles.sok}
        />
        {sok && (
          <button
            type="button"
            onClick={() => setSok("")}
            aria-label="Tøm søk"
            className={styles.tomSok}
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {skrivingAktiv && (
        <div className={styles.sammenslaRad}>
          <Button
            variant="secondary"
            onClick={() => {
              setSammenslaModus((v) => !v);
              setValgte([]);
            }}
          >
            {sammenslaModus ? "Avbryt sammenslåing" : "Slå sammen regler"}
          </Button>
          {sammenslaModus && valgte.length < 2 && (
            <span className={styles.hint}>
              Velg {2 - valgte.length} regel{2 - valgte.length !== 1 ? "er" : ""} til for samme
              leverandør
            </span>
          )}
          {sammenslaModus && valgte.length === 2 && (
            <Button
              onClick={() => {
                onSlaSammen(valgte[0]!, valgte[1]!);
                setValgte([]);
                setSammenslaModus(false);
              }}
            >
              Slå sammen disse 2
            </Button>
          )}
        </div>
      )}

      {sortert.length === 0 && (
        <div className={styles.tom}>
          {regler.length === 0
            ? "Ingen regler er lært ennå. Regler oppstår i Bankimport når du velger «Koble + lær»."
            : "Ingen regler matcher søket."}
        </div>
      )}

      {spare.length > 0 && (
        <section className={styles.seksjon}>
          <h2 className={styles.seksjonTittel}>
            Sparing{" "}
            <span className={styles.antall}>
              ({spare.reduce((sum, g) => sum + g.regler.length, 0)})
            </span>
          </h2>
          {spare.map((g) => seksjon(g, "under"))}
        </section>
      )}
      {nivaer.map((n) => seksjon(n))}
      {ovrige.length > 0 && seksjon({ key: "ovrige", label: "Øvrige", regler: ovrige })}

      {valgt && (
        <Modal
          title={`Regel — ${valgt.pattern || "(uten mønster)"}`}
          onClose={() => setValgtId(null)}
        >
          <RegelDetalj
            r={valgt}
            treff={tellTreff(valgt, transaksjoner)}
            skrivingAktiv={skrivingAktiv}
            onOppdater={(felt) => onOppdater(valgt.id, felt)}
            onSlett={() => {
              onSlett(valgt.id);
              setValgtId(null);
            }}
            onLukk={() => setValgtId(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function RegelRad({
  r,
  valgt,
  sammenslaModus,
  onKlikk,
}: {
  r: RegelRecord;
  valgt: boolean;
  sammenslaModus: boolean;
  onKlikk: () => void;
}) {
  const inaktiv = r.active === false;
  const klasser = [
    styles.rad,
    inaktiv ? styles.inaktiv : "",
    r.mode === "review" ? styles.uthevet : "",
    valgt ? styles.valgt : "",
  ].join(" ");
  return (
    <button
      type="button"
      className={klasser}
      onClick={onKlikk}
      aria-pressed={sammenslaModus ? valgt : undefined}
    >
      {sammenslaModus && (
        <span className={styles.avkryss} aria-hidden>
          {valgt && <Icon name="check" size={12} />}
        </span>
      )}
      <span className={styles.radTekst}>
        <span className={styles.radTittel}>
          <span className={styles.monster}>{r.pattern || "(uten mønster)"}</span>
          {r.multiUse && <span className={styles.merke}>flerbruk</span>}
          {inaktiv && <span className={styles.merke}>deaktivert</span>}
        </span>
        <span className={styles.radInfo}>
          → {r.targetName || "ukjent"} · {r.timesUsed || 0}x brukt · sist {fmtD(r.lastMatched)}
        </span>
      </span>
      <span className={styles.modus}>
        {MODE_LABEL[r.mode] ?? r.mode} · {conf(r)}%
      </span>
      {!sammenslaModus && <Icon name="chevron-right" size={16} />}
    </button>
  );
}

function RegelDetalj({
  r,
  treff,
  skrivingAktiv,
  onOppdater,
  onSlett,
  onLukk,
}: {
  r: RegelRecord;
  treff: number;
  skrivingAktiv: boolean;
  onOppdater: (felt: RegelFelt) => void;
  onSlett: () => void;
  onLukk: () => void;
}) {
  const matchType = r.matchType || "inneholder";
  return (
    <div>
      <dl className={styles.felter}>
        <div>
          <dt>Mønster</dt>
          <dd>
            {skrivingAktiv ? (
              <MonsterFelt r={r} onLagre={(utkast) => onOppdater(monsterFelt(utkast))} />
            ) : (
              r.normalizedPattern || r.pattern || "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Koblet mot</dt>
          <dd>
            {r.targetName || "—"} <span className={styles.dempet}>({r.targetType || "?"})</span>
          </dd>
        </div>
        <div>
          <dt>Antall ganger brukt</dt>
          <dd>{r.timesUsed || 0}</dd>
        </div>
        <div>
          <dt>Treffer i dag</dt>
          <dd>
            {treff} observasjon{treff !== 1 ? "er" : ""}
          </dd>
        </div>
        {!skrivingAktiv && (
          <>
            <div>
              <dt>Matchtype</dt>
              <dd>{MATCHTYPE_LABEL[matchType]}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>
                {MODE_LABEL[r.mode] ?? r.mode} · {conf(r)}%
              </dd>
            </div>
            <div>
              <dt>Aktiv</dt>
              <dd>{r.active !== false ? "Ja" : "Nei"}</dd>
            </div>
            <div>
              <dt>Flerbruk</dt>
              <dd>{r.multiUse ? "Ja" : "Nei"}</dd>
            </div>
          </>
        )}
      </dl>

      {skrivingAktiv && (
        <>
          <Valg
            tittel="Matchtype"
            valg={MATCHTYPER.map((mt) => [mt, MATCHTYPE_LABEL[mt]])}
            aktiv={matchType}
            onVelg={(mt) => onOppdater({ matchType: mt as MatchType })}
          />
          <Valg
            tittel="Mode"
            valg={MODES.map((m) => [m, MODE_LABEL[m]])}
            aktiv={r.mode}
            onVelg={(m) => onOppdater({ mode: m as RegelMode })}
          />
          <label className={styles.confidence}>
            <span className={styles.feltTittel}>Confidence: {conf(r)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={conf(r)}
              onChange={(e) => onOppdater({ confidence: parseInt(e.target.value) })}
            />
          </label>
          <div className={styles.brytere}>
            <label>
              <input
                type="checkbox"
                checked={r.active !== false}
                onChange={() => onOppdater({ active: r.active === false })}
              />{" "}
              Aktiv
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!r.multiUse}
                onChange={() => onOppdater({ multiUse: !r.multiUse })}
              />{" "}
              Flerbruk
            </label>
          </div>
        </>
      )}

      <div className={styles.handlinger}>
        <Button variant="secondary" onClick={onLukk}>
          Lukk
        </Button>
        {skrivingAktiv && (
          <Button variant="destructive" onClick={onSlett}>
            Slett regel
          </Button>
        )}
      </div>
    </div>
  );
}

function Valg({
  tittel,
  valg,
  aktiv,
  onVelg,
}: {
  tittel: string;
  valg: [string, string][];
  aktiv: string;
  onVelg: (verdi: string) => void;
}) {
  return (
    <div className={styles.valgGruppe}>
      <div className={styles.feltTittel}>{tittel}</div>
      <div className={styles.valg}>
        {valg.map(([verdi, label]) => (
          <button
            key={verdi}
            type="button"
            aria-pressed={verdi === aktiv}
            className={verdi === aktiv ? styles.valgAktiv : styles.valgKnapp}
            onClick={() => onVelg(verdi)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Lokalt utkast, lagres kun ved blur/Enter — samme fiks som legacy `RegelMonsterFelt`. */
function MonsterFelt({ r, onLagre }: { r: RegelRecord; onLagre: (utkast: string) => void }) {
  const lagret = r.normalizedPattern || r.pattern || "";
  const [utkast, setUtkast] = useState(lagret);
  useEffect(() => setUtkast(lagret), [lagret]);
  return (
    <input
      value={utkast}
      aria-label="Mønster"
      className={styles.monsterInput}
      onChange={(e) => setUtkast(e.target.value)}
      onBlur={() => onLagre(utkast)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
