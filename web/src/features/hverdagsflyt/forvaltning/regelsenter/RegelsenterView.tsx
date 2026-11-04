import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { Modal } from "@components/Modal";
import { RoomHeader } from "@components/RoomHeader";
import { BUDGET_EIER } from "@domain/budsjettfamilie/budsjettfamilie";
import { jevnFordelEiere } from "@domain/forsoning/fordeling";
import {
  ansvarTekst,
  filtrerRegler,
  KONTOVILKAR_VALG,
  kontoNavn,
  MATCHTYPE_LABEL,
  MODE_LABEL,
  monsterFelt,
  monsterHjelpetekst,
  ovrigeRegler,
  type RegelFelt,
  type RegelGrupper,
  type RegelSeksjon,
  regelAnsvarTekst,
  regelStatus,
  regelVilkarTekst,
  reglerPerNiva,
  sorterRegler,
  spareReglerGruppert,
  tellTreff,
  velgForSammenslaing,
} from "@domain/forsoning/regelsenter";
import {
  type EndreMalUtfall,
  MALTYPE_LABEL,
  type RegelMal,
  malNokkel,
  regelMalNokkel,
  regelMalValg,
  sokRegelMal,
} from "@domain/forsoning/regelMal";
import type {
  Eierandel,
  MatchType,
  PlasseringType,
  RegelMode,
  RegelRecord,
} from "@app-types/forsoning";
import styles from "./RegelsenterScreen.module.css";

export interface RegelsenterViewProps {
  regler: RegelRecord[];
  grupper: RegelGrupper;
  transaksjoner: readonly { tekst?: string | null; konto?: string | null; importkilde?: string }[];
  /** Aktiveringsporten — `false` til R3b-cutover (§hooks/regelsenterAktivering.ts). */
  skrivingAktiv: boolean;
  onOppdater: (id: string, felt: RegelFelt) => void;
  onSlett: (id: string) => void;
  onSlaSammen: (aId: string, bId: string) => void;
  /**
   * Endre koblet målpost (#59, 6643098967). Utfallet vises i detaljen;
   * avvisning (nett/tilgang) gir feil og «prøv igjen». Uten denne kan målet
   * ikke endres her.
   */
  onEndreMal?: (
    id: string,
    fra: { type: PlasseringType; id: string },
    til: { type: PlasseringType; id: string },
  ) => Promise<EndreMalUtfall>;
  /** «Kjør regler»-forhåndsvisningen (`KjorReglerPanel`), vist under statusfeltene. */
  kjorRegler?: ReactNode;
}

const MATCHTYPER: MatchType[] = ["er_lik", "inneholder", "starter_med"];
const MODES: RegelMode[] = ["auto", "suggest", "review", "disabled"];
const ALLE_KONTOER = "alle";

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
 * sammenslåing. «Kjør regler» vises kun som forhåndsvisning (`kjorRegler`-
 * sporet); «Bruk resultatet» hører til R3b.
 */
export function RegelsenterView({
  regler,
  grupper,
  transaksjoner,
  skrivingAktiv,
  onOppdater,
  onSlett,
  onSlaSammen,
  onEndreMal,
  kjorRegler,
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
  const funnet = valgtId ? regler.find((r) => r.id === valgtId) : undefined;
  // Slettes regelen mens detaljen er åpen (her eller et annet sted), står
  // detaljen med siste kjente innhold og en tydelig melding — et utkast går
  // ikke tapt i stillhet, og ingenting lagres mot en slettet regel.
  const sistSett = useRef<RegelRecord | undefined>(undefined);
  if (funnet) sistSett.current = funnet;
  const valgt = funnet ?? (sistSett.current?.id === valgtId ? sistSett.current : undefined);
  const valgtSlettet = !!valgt && !funnet;

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

      {kjorRegler}

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
            skrivingAktiv={skrivingAktiv && !valgtSlettet}
            slettet={valgtSlettet}
            grupper={grupper}
            onEndreMal={onEndreMal ? (fra, til) => onEndreMal(valgt.id, fra, til) : undefined}
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
          {r.kontoVilkar && (
            <span className={styles.kontoMerke}>+ bare fra {kontoNavn(r.kontoVilkar)}</span>
          )}
          {r.multiUse && <span className={styles.merke}>flerbruk</span>}
          {inaktiv && <span className={styles.merke}>deaktivert</span>}
        </span>
        <span className={styles.radInfo}>
          → {r.targetName || "ukjent"}
          {r.eiere && r.eiere.length > 0 ? ` · ${ansvarTekst(r.eiere)}` : ""} · {r.timesUsed || 0}x
          brukt · sist {fmtD(r.lastMatched)}
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
  slettet = false,
  grupper,
  onEndreMal,
  onOppdater,
  onSlett,
  onLukk,
}: {
  r: RegelRecord;
  treff: number;
  skrivingAktiv: boolean;
  /** Regelen finnes ikke lenger; detaljen viser siste kjente innhold. */
  slettet?: boolean;
  grupper: RegelGrupper;
  onEndreMal?: (
    fra: { type: PlasseringType; id: string },
    til: { type: PlasseringType; id: string },
  ) => Promise<EndreMalUtfall>;
  onOppdater: (felt: RegelFelt) => void;
  onSlett: () => void;
  onLukk: () => void;
}) {
  const matchType = r.matchType || "inneholder";
  const [velgMal, setVelgMal] = useState(false);
  const [bekreftet, setBekreftet] = useState<string | null>(null);
  return (
    <div>
      {slettet && (
        <p className={styles.malFeil} role="alert">
          Regelen er slettet og kan ikke endres her lenger.
        </p>
      )}
      <dl className={styles.felter}>
        <div>
          <dt>Mønster</dt>
          <dd>
            {skrivingAktiv ? (
              <MonsterFelt r={r} onLagre={(utkast) => onOppdater(monsterFelt(utkast))} />
            ) : (
              r.normalizedPattern || r.pattern || "—"
            )}
            {monsterHjelpetekst(r) && <div className={styles.dempet}>{monsterHjelpetekst(r)}</div>}
          </dd>
        </div>
        <div>
          <dt>Treffer når</dt>
          <dd>
            {regelVilkarTekst(r)}
            {r.kontoVilkar && <div className={styles.dempet}>Begge vilkårene må stemme.</div>}
          </dd>
        </div>
        <div>
          <dt>Koblet mot</dt>
          <dd>
            {r.targetName || "—"}{" "}
            <span className={styles.dempet}>
              ({r.targetGruppe ? `${r.targetGruppe} · ` : ""}
              {MALTYPE_LABEL[r.targetType || "budget"] ?? r.targetType})
            </span>
            {skrivingAktiv && onEndreMal && !velgMal && (
              <div>
                <button
                  type="button"
                  className={styles.lenkeKnapp}
                  onClick={() => {
                    setBekreftet(null);
                    setVelgMal(true);
                  }}
                >
                  Endre målpost
                </button>
              </div>
            )}
          </dd>
        </div>
        <div>
          <dt>Ansvar ved treff</dt>
          <dd>{regelAnsvarTekst(r)}</dd>
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
              <dt>Konto</dt>
              <dd>{r.kontoVilkar ? `Bare fra ${kontoNavn(r.kontoVilkar)}` : "Alle kontoer"}</dd>
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

      {bekreftet && !velgMal && (
        <p className={styles.malOk} role="status">
          {bekreftet}
        </p>
      )}
      {velgMal && onEndreMal && (
        <MalVelger
          r={r}
          grupper={grupper}
          slettet={slettet}
          onEndreMal={onEndreMal}
          onFerdig={(melding) => {
            setVelgMal(false);
            setBekreftet(melding);
          }}
          onAvbryt={() => setVelgMal(false)}
        />
      )}

      {skrivingAktiv && (
        <>
          <Valg
            tittel="Matchtype"
            valg={MATCHTYPER.map((mt) => [mt, MATCHTYPE_LABEL[mt]])}
            aktiv={matchType}
            onVelg={(mt) => onOppdater({ matchType: mt as MatchType })}
          />
          <Valg
            tittel="Betalt fra konto"
            valg={[
              [ALLE_KONTOER, "Alle kontoer"],
              ...KONTOVILKAR_VALG.map((k): [string, string] => [k.id, k.label]),
            ]}
            aktiv={r.kontoVilkar || ALLE_KONTOER}
            onVelg={(k) => onOppdater({ kontoVilkar: k === ALLE_KONTOER ? null : k })}
          />
          <AnsvarValg
            eiere={r.eiere && r.eiere.length > 0 ? r.eiere : []}
            onVelg={(eiere) => onOppdater({ eiere })}
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

const malTekst = (m: { navn: string; gruppe: string; type: PlasseringType }) =>
  `${m.navn} — ${m.gruppe ? `${m.gruppe} · ` : ""}${MALTYPE_LABEL[m.type]}`;

/**
 * Velg ny målpost for regelen (#59, Helens bestilling 6543518396).
 *
 * - Valgene er dagens aktive poster (kostnad, inntekt, sparing); like navn
 *   skilles med livsområde og type, og valget bæres som type + id.
 * - Utkastet lagres bare ved «Lagre målpost» — aldri ved lukking, Avbryt
 *   eller bytte av regel. Under lagring er knappen sperret (ingen
 *   dobbeltskriving), og «Koblet mot» viser fortsatt det bekreftede målet
 *   til serveren har bekreftet det nye.
 * - Feil og avvisning beholder utkastet og gir «Prøv igjen». Er målet
 *   endret et annet sted siden utkastet ble laget, lagres ingenting.
 */
function MalVelger({
  r,
  grupper,
  slettet,
  onEndreMal,
  onFerdig,
  onAvbryt,
}: {
  r: RegelRecord;
  grupper: RegelGrupper;
  slettet: boolean;
  onEndreMal: (
    fra: { type: PlasseringType; id: string },
    til: { type: PlasseringType; id: string },
  ) => Promise<EndreMalUtfall>;
  onFerdig: (melding: string) => void;
  onAvbryt: () => void;
}) {
  const naaNokkel = regelMalNokkel(r);
  // Målet brukeren så da utkastet ble laget — grunnlaget for samtidighetsvakten.
  const [fra, setFra] = useState<{ type: PlasseringType; id: string }>(() => ({
    type: r.targetType || "budget",
    id: r.targetId,
  }));
  const [sok, setSok] = useState("");
  const [utkast, setUtkast] = useState<RegelMal | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const opptatt = useRef(false);
  const treff = sokRegelMal(regelMalValg(grupper), sok);

  const lagre = async () => {
    if (!utkast || opptatt.current) return;
    opptatt.current = true;
    setLagrer(true);
    setFeil(null);
    try {
      const utfall = await onEndreMal(fra, { type: utkast.type, id: utkast.id });
      switch (utfall.status) {
        case "lagret":
          onFerdig(`Lagret. Regelen kobles nå mot ${malTekst(utfall.mal)}.`);
          return;
        case "uendret":
          onFerdig(`Regelen var allerede koblet mot ${malTekst(utkast)}.`);
          return;
        case "regel_slettet":
          setFeil("Regelen er slettet og kan ikke endres. Ingenting er lagret.");
          return;
        case "mal_ugyldig":
          setFeil(
            "Målposten finnes ikke lenger (slettet eller arkivert). Velg en annen. Ingenting er lagret.",
          );
          setUtkast(null);
          return;
        case "endret_samtidig":
          setFeil(
            `Regelen ble koblet mot ${utfall.naa.targetName} et annet sted i mellomtiden. Ingenting er lagret. Se over og lagre på nytt hvis du fortsatt vil bytte.`,
          );
          setFra({ type: utfall.naa.targetType, id: r.targetId });
          return;
      }
    } catch {
      setFeil("Kunne ikke lagre målposten. Prøv igjen.");
    } finally {
      opptatt.current = false;
      setLagrer(false);
    }
  };

  return (
    <section className={styles.malVelger} aria-label="Endre målpost">
      <span className={styles.feltTittel}>Ny målpost</span>
      <input
        type="search"
        className={styles.sok}
        aria-label="Søk etter målpost"
        placeholder="Søk i kostnad, inntekt og sparing…"
        autoComplete="off"
        value={sok}
        disabled={lagrer || slettet}
        onChange={(e) => setSok(e.target.value)}
      />
      <div className={styles.malListe} role="group" aria-label="Målposter">
        {treff.slice(0, 40).map((m) => {
          const nokkel = malNokkel(m);
          const valgt = utkast !== null && malNokkel(utkast) === nokkel;
          return (
            <button
              key={nokkel}
              type="button"
              className={valgt ? styles.malValgAktiv : styles.malValg}
              aria-pressed={valgt}
              disabled={lagrer || slettet}
              onClick={() => {
                setUtkast(m);
                setFeil(null);
              }}
            >
              <span>{m.navn}</span>
              <span className={styles.dempet}>
                {m.gruppe ? `${m.gruppe} · ` : ""}
                {MALTYPE_LABEL[m.type]}
                {nokkel === naaNokkel ? " · nå" : ""}
              </span>
            </button>
          );
        })}
        {treff.length === 0 && <div className={styles.dempet}>Ingen poster matcher søket.</div>}
      </div>
      <p className={styles.dempet}>
        Gjelder regelen fremover. Transaksjoner som allerede er plassert, endres ikke.
      </p>
      {utkast && (
        <p>
          Ny: <strong>{malTekst(utkast)}</strong>
        </p>
      )}
      {lagrer && (
        <p className={styles.dempet} role="status">
          Lagrer — venter på bekreftelse.
        </p>
      )}
      {feil && (
        <p className={styles.malFeil} role="alert">
          {feil}
        </p>
      )}
      <div className={styles.handlinger}>
        <Button variant="secondary" size="compact" onClick={onAvbryt} disabled={lagrer}>
          Avbryt
        </Button>
        <Button
          size="compact"
          onClick={() => void lagre()}
          disabled={!utkast || slettet}
          loading={lagrer}
        >
          {feil && utkast ? "Prøv igjen" : "Lagre målpost"}
        </Button>
      </div>
    </section>
  );
}

/**
 * Ansvaret regelen plasserer med (#59). Samme oppførsel som «Ansvar» ved
 * behandling: personer veksles, jevnt delt, minst én. Uten eget ansvar er
 * ingen valgt — regelen plasserer da «Felles (standard)».
 */
function AnsvarValg({
  eiere,
  onVelg,
}: {
  eiere: Eierandel[];
  onVelg: (eiere: Eierandel[]) => void;
}) {
  const valgte = eiere.map((e) => e.person);
  return (
    <div className={styles.valgGruppe} role="group" aria-label="Ansvar">
      <div className={styles.feltTittel}>Ansvar</div>
      <div className={styles.valg}>
        {BUDGET_EIER.map((person) => {
          const valgt = eiere.find((e) => e.person === person);
          return (
            <button
              key={person}
              type="button"
              aria-pressed={!!valgt}
              className={valgt ? styles.valgAktiv : styles.valgKnapp}
              onClick={() => {
                const erValgt = valgte.includes(person);
                if (erValgt && valgte.length === 1) return;
                onVelg(
                  jevnFordelEiere(
                    erValgt ? valgte.filter((p) => p !== person) : [...valgte, person],
                  ),
                );
              }}
            >
              {person}
              {valgt && eiere.length > 1 ? ` ${valgt.prosent}%` : ""}
            </button>
          );
        })}
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
    <div className={styles.valgGruppe} role="group" aria-label={tittel}>
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
