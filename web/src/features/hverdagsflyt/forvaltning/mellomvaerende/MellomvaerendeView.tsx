import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { RoomHeader } from "@components/RoomHeader";
import type { MalPost } from "@app-types/forsoning";
import type { Mellomvaerende } from "@app-types/mellomvaerende";
import { BUDGET_EIER } from "@domain/budsjettfamilie/budsjettfamilie";
import { jevnFordelEiere } from "@domain/forsoning/fordeling";
import {
  type MellomvaerendeStatus,
  type NyttMellomvaerende,
  type OppgjorLinje,
  gjenstaendeOppgjor,
  kronerTekst,
  maanedTekst,
  tolkKroner,
  valider,
} from "@domain/mellomvaerende/mellomvaerende";
import type { MellomvaerendeHandlinger } from "@hooks/useMellomvaerende";
import { lagringsfeil } from "./lagringsfeil";
import { OppgjorKort } from "./OppgjorKort";
import styles from "./Mellomvaerende.module.css";

export interface MellomvaerendeViewProps {
  statuser: MellomvaerendeStatus[];
  poster: MalPost[];
  naaMaaned: string;
  handlinger: MellomvaerendeHandlinger;
  /** Kan skrives (forsoningsporten er på). */
  skrivingAktiv: boolean;
  /** Ny id til registreringsskjemaet (beholdes ved retry). */
  nyId: () => string;
}

const HANDLING_TEKST = { bekreftet: "Bekreftet", rettet: "Rettet", angret: "Angret" } as const;
const tidTekst = (iso: string) =>
  new Date(iso).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" });

/**
 * `/forvaltning/mellomvaerende` (#95): hvert mellomværende med opprinnelig
 * beløp, oppgjør per måned med spor, og det som gjenstår — pluss
 * forfalte måneder, retting/angring og registrering av et nytt.
 */
export function MellomvaerendeView({
  statuser,
  poster,
  naaMaaned,
  handlinger,
  skrivingAktiv,
  nyId,
}: MellomvaerendeViewProps) {
  const [visSkjema, setVisSkjema] = useState(statuser.length === 0);
  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Mellomværende"
        description="Utlegg som gjøres opp ved motregning, måned for måned."
      />
      {statuser.length === 0 && !visSkjema && (
        <div className={styles.tom}>Ingen mellomværender er registrert.</div>
      )}
      {statuser.map((s) => (
        <Avtale key={s.avtale.id} s={s} handlinger={handlinger} skrivingAktiv={skrivingAktiv} />
      ))}
      {skrivingAktiv &&
        (visSkjema ? (
          <Registrering
            poster={poster}
            naaMaaned={naaMaaned}
            nyId={nyId}
            onRegistrer={handlinger.registrer}
            onFerdig={() => setVisSkjema(false)}
          />
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setVisSkjema(true)}>
              Registrer nytt mellomværende
            </Button>
          </div>
        ))}
    </div>
  );
}

function Avtale({
  s,
  handlinger,
  skrivingAktiv,
}: {
  s: MellomvaerendeStatus;
  handlinger: MellomvaerendeHandlinger;
  skrivingAktiv: boolean;
}) {
  const a = s.avtale;
  const gjenstar = gjenstaendeOppgjor(s);
  return (
    <section aria-label={a.navn} className={styles.side}>
      <Card>
        <div className={styles.avtale}>
          <div className={styles.kortHode}>
            <h2 className={styles.kortTittel}>{a.navn}</h2>
            <span className={styles.dempet}>
              Med {a.motpart} · fra {maanedTekst(a.startMaaned)}
            </span>
          </div>
          <dl className={styles.nokkeltall}>
            <div>
              <dt>Utlegg</dt>
              <dd>{kronerTekst(a.opprinneligOre)}</dd>
            </div>
            <div>
              <dt>Oppgjort</dt>
              <dd>{kronerTekst(s.oppgjortOre)}</dd>
            </div>
            <div>
              <dt>Gjenstår</dt>
              <dd>{kronerTekst(s.restOre)}</dd>
            </div>
          </dl>
          <span className={styles.dempet}>
            Kostnad på {a.kostnad.postNavn} i {maanedTekst(a.startMaaned)}; oppgjørene reduserer{" "}
            {a.oppgjor.postNavn}. Ingen bankkonto påvirkes.{" "}
            {s.avsluttet
              ? "Mellomværendet er gjort opp."
              : gjenstar.fulle > 0 &&
                `Med ${kronerTekst(s.forslagOre)} i måneden gjenstår ${gjenstar.fulle} oppgjør${
                  gjenstar.sisteOre > 0 ? ` og ett på ${kronerTekst(gjenstar.sisteOre)}` : ""
                }.`}
          </span>
          {s.oppgjor.length > 0 && (
            <table className={styles.tabell}>
              <thead>
                <tr>
                  <th>Måned</th>
                  <th className={styles.hoyre}>Beløp</th>
                  {skrivingAktiv && <th className={styles.hoyre}>Endre</th>}
                </tr>
              </thead>
              <tbody>
                {s.oppgjor.map((o) => (
                  <OppgjorRad
                    key={o.maaned}
                    o={o}
                    avtale={a}
                    restOre={s.restOre}
                    handlinger={handlinger}
                    skrivingAktiv={skrivingAktiv}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      {skrivingAktiv && (s.forfalte.length > 0 || !s.kostnadFort) && (
        <OppgjorKort
          status={s}
          onBekreft={(maaned, ore) => handlinger.bekreft(a, maaned, ore)}
          onFullfor={() => handlinger.fullforRegistrering(a)}
        />
      )}
    </section>
  );
}

function OppgjorRad({
  o,
  avtale,
  restOre,
  handlinger,
  skrivingAktiv,
}: {
  o: OppgjorLinje;
  avtale: Mellomvaerende;
  restOre: number;
  handlinger: MellomvaerendeHandlinger;
  skrivingAktiv: boolean;
}) {
  const [retter, setRetter] = useState(false);
  const [tekst, setTekst] = useState(String(o.belopOre / 100).replace(".", ","));
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const kjor = async (f: () => Promise<void>) => {
    setLagrer(true);
    setFeil(null);
    try {
      await f();
      setRetter(false);
    } catch (e) {
      setFeil(lagringsfeil(e));
    } finally {
      setLagrer(false);
    }
  };
  const nytt = tolkKroner(tekst);
  const maks = restOre + o.belopOre;
  return (
    <tr>
      <td>
        {maanedTekst(o.maaned)}
        <ul className={styles.spor} aria-label={`Spor for ${maanedTekst(o.maaned)}`}>
          {o.spor.map((sp, i) => (
            <li key={i}>
              {HANDLING_TEKST[sp.handling]}
              {sp.handling !== "angret" && ` ${kronerTekst(sp.belopOre)}`} · {tidTekst(sp.tid)} ·{" "}
              {sp.av}
            </li>
          ))}
        </ul>
        {feil && (
          <p className={styles.feil} role="alert">
            {feil}
          </p>
        )}
      </td>
      <td className={`${styles.hoyre} ${styles.tall} ${o.aktiv ? "" : styles.angret}`}>
        {o.aktiv ? kronerTekst(o.belopOre) : "Angret"}
      </td>
      {skrivingAktiv && (
        <td className={styles.hoyre}>
          {o.aktiv &&
            (retter ? (
              <div className={styles.handlinger}>
                <input
                  className={styles.input}
                  inputMode="decimal"
                  aria-label={`Nytt beløp for ${maanedTekst(o.maaned)}`}
                  value={tekst}
                  onChange={(e) => setTekst(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.tekstKnapp}
                  disabled={lagrer || nytt === null || nytt > maks}
                  onClick={() =>
                    nytt !== null && kjor(() => handlinger.rett(avtale, o.maaned, nytt, o.versjon))
                  }
                >
                  {lagrer ? "Lagrer…" : "Lagre"}
                </button>
                <button
                  type="button"
                  className={styles.tekstKnapp}
                  disabled={lagrer}
                  onClick={() => setRetter(false)}
                >
                  Avbryt
                </button>
              </div>
            ) : (
              <div className={styles.handlinger}>
                <button
                  type="button"
                  className={styles.tekstKnapp}
                  disabled={lagrer}
                  onClick={() => {
                    setTekst(String(o.belopOre / 100).replace(".", ","));
                    setRetter(true);
                  }}
                >
                  Rett
                </button>
                <button
                  type="button"
                  className={styles.tekstKnapp}
                  disabled={lagrer}
                  aria-label={`Angre oppgjør ${maanedTekst(o.maaned)}`}
                  onClick={() => kjor(() => handlinger.angre(avtale, o.maaned, o.versjon))}
                >
                  {lagrer ? "Lagrer…" : "Angre"}
                </button>
              </div>
            ))}
        </td>
      )}
    </tr>
  );
}

function EierValg({
  legend,
  valgt,
  onEndre,
}: {
  legend: string;
  valgt: string[];
  onEndre: (personer: string[]) => void;
}) {
  return (
    <fieldset className={styles.gruppe}>
      <legend>{legend}</legend>
      <div className={styles.chips}>
        {BUDGET_EIER.map((p) => {
          const aktiv = valgt.includes(p);
          return (
            <button
              key={p}
              type="button"
              aria-pressed={aktiv}
              className={aktiv ? styles.chipAktiv : styles.chip}
              onClick={() => onEndre(aktiv ? valgt.filter((x) => x !== p) : [...valgt, p])}
            >
              {p}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Registrering({
  poster,
  naaMaaned,
  nyId,
  onRegistrer,
  onFerdig,
}: {
  poster: MalPost[];
  naaMaaned: string;
  nyId: () => string;
  onRegistrer: MellomvaerendeHandlinger["registrer"];
  onFerdig: () => void;
}) {
  // Samme id ved retry: en avbrutt registrering kan aldri bli to avtaler.
  const [id] = useState(nyId);
  const [navn, setNavn] = useState("");
  const [motpart, setMotpart] = useState("");
  const [utlegg, setUtlegg] = useState("");
  const [start, setStart] = useState(naaMaaned);
  const [kostnadPost, setKostnadPost] = useState("");
  const [oppgjorPost, setOppgjorPost] = useState("");
  const [kostnadEiere, setKostnadEiere] = useState<string[]>([]);
  const [oppgjorEiere, setOppgjorEiere] = useState<string[]>([]);
  const [maanedlig, setMaanedlig] = useState("");
  const [visFeil, setVisFeil] = useState(false);
  const [lagrer, setLagrer] = useState(false);
  const [lagreFeil, setLagreFeil] = useState<string | null>(null);

  const postFor = (postId: string, eiere: string[]) => {
    const p = poster.find((x) => x.id === postId);
    return {
      postId: p?.id ?? "",
      postNavn: p?.name ?? "",
      plasseringType: "budget" as const,
      eiere: jevnFordelEiere(eiere),
    };
  };
  const ny: NyttMellomvaerende = {
    navn,
    motpart,
    opprinneligOre: tolkKroner(utlegg) ?? 0,
    startMaaned: start,
    kostnad: postFor(kostnadPost, kostnadEiere),
    oppgjor: postFor(oppgjorPost, oppgjorEiere),
    standardBelopOre: tolkKroner(maanedlig) ?? 0,
  };
  const feil = valider(ny);
  const send = async () => {
    setVisFeil(true);
    if (feil.length > 0) return;
    setLagrer(true);
    setLagreFeil(null);
    try {
      await onRegistrer(ny, id);
      onFerdig();
    } catch (err) {
      setLagreFeil(lagringsfeil(err));
    } finally {
      setLagrer(false);
    }
  };

  const postValg = (verdi: string, onEndre: (v: string) => void, etikett: string) => (
    <label className={styles.felt}>
      {etikett}
      <select
        className={`${styles.select} ${styles.inputBred}`}
        value={verdi}
        onChange={(e) => onEndre(e.target.value)}
      >
        <option value="">Velg post…</option>
        {poster.map((p) => (
          <option key={p.id} value={p.id}>
            {p.gruppe ? `${p.gruppe} / ${p.name}` : p.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-label="Registrer mellomværende">
      <Card>
        <div className={styles.skjema}>
          <h2 className={styles.kortTittel}>Nytt mellomværende</h2>
          <div className={styles.rutenett}>
            <label className={styles.felt}>
              Navn
              <input
                className={`${styles.input} ${styles.inputBred}`}
                value={navn}
                placeholder="F.eks. Gave fra mamma"
                onChange={(e) => setNavn(e.target.value)}
              />
            </label>
            <label className={styles.felt}>
              Med hvem
              <input
                className={`${styles.input} ${styles.inputBred}`}
                value={motpart}
                placeholder="F.eks. Mamma"
                onChange={(e) => setMotpart(e.target.value)}
              />
            </label>
            <label className={styles.felt}>
              Utlegg (kr)
              <input
                className={`${styles.input} ${styles.inputBred}`}
                inputMode="decimal"
                value={utlegg}
                onChange={(e) => setUtlegg(e.target.value)}
              />
            </label>
            <label className={styles.felt}>
              Startmåned
              <input
                type="month"
                className={`${styles.input} ${styles.inputBred}`}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            {postValg(kostnadPost, setKostnadPost, "Utlegget er en kostnad på")}
            <EierValg legend="Hvem eier kostnaden" valgt={kostnadEiere} onEndre={setKostnadEiere} />
            {postValg(oppgjorPost, setOppgjorPost, "Oppgjørene reduserer")}
            <EierValg
              legend="Hvem eier reduksjonen"
              valgt={oppgjorEiere}
              onEndre={setOppgjorEiere}
            />
            <label className={styles.felt}>
              Månedlig oppgjør (kr)
              <input
                className={`${styles.input} ${styles.inputBred}`}
                inputMode="decimal"
                value={maanedlig}
                onChange={(e) => setMaanedlig(e.target.value)}
              />
            </label>
          </div>
          <span className={styles.dempet}>
            Utlegget føres som faktisk kostnad i startmåneden, uten bank. Hver måned foreslås siste
            avtalte beløp, og du bekrefter det på Forvaltning-forsiden.
          </span>
          {visFeil && feil.length > 0 && (
            <ul className={styles.feil} role="alert">
              {feil.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {lagreFeil && (
            <p className={styles.feil} role="alert">
              {lagreFeil}
            </p>
          )}
          <div className={styles.handlinger}>
            <Button variant="secondary" onClick={onFerdig} disabled={lagrer}>
              Avbryt
            </Button>
            <Button loading={lagrer} onClick={send}>
              Registrer
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
