import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import type { IconName } from "@components/icons";
import { RoomHeader } from "@components/RoomHeader";
import type { Belop, Okonomibilde, OmradeSum } from "@domain/budsjettfamilie/okonomi";
import type { Oppmerksomhet } from "@domain/forsoning/oppmerksomhet";
import type { SpilleromOversikt } from "@domain/liquidity/oversikt";
import type { Runde } from "@domain/lonnsdagsrunde/lonnsdagsrunde";
import { STEG_TITTEL } from "../runde/rundeTekst";
import { type Omrade, okonomiLenke } from "../okonomi/okonomiLenke";
import styles from "./ForvaltningHub.module.css";

const MAANEDER = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
];

const kr = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);

const flertall = (n: number, en: string, flere: string) => `${n} ${n === 1 ? en : flere}`;

export interface ForvaltningOversiktViewProps {
  spillerom: SpilleromOversikt;
  oppmerksomhet: Oppmerksomhet;
  okonomi: Okonomibilde;
  /** 0–11, måneden økonomibildet gjelder. */
  month: number;
  /** Lønnsdagsrunden (#59); kortet vises bare når den er med. */
  runde?: Runde;
}

/**
 * Forvaltning-forsiden som handlingsflate (produktfase 1, #34 6000282907):
 * «Hvordan står økonomien til, og er det noe jeg trenger å gjøre?» — uten
 * at brukeren først velger modul.
 *
 *  1. Spillerom øverst, som situasjonsbilde med vei til detaljene.
 *  2. «Trenger oppmerksomhet»: bare køer med noe i, med direkte inngang til
 *     riktig kø. Er det ingenting, krymper delen til én rolig linje.
 *  3. Økonomien denne måneden: inntekter, kostnader og sparing som ett
 *     bilde for samme periode, med gruppesummer ved behov og netto
 *     (inntekter − kostnader − sparing), hittil og budsjettert.
 *  4. Regelsenter og Årsbudsjett ligger rolig nederst som oppsett.
 */
export function ForvaltningOversiktView({
  spillerom,
  oppmerksomhet,
  okonomi,
  month,
  runde,
}: ForvaltningOversiktViewProps) {
  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Forvaltning"
        description="Hvordan står økonomien til?"
      />
      <SpilleromKort o={spillerom} />
      {runde && <RundeKort runde={runde} />}
      <OppmerksomhetKort o={oppmerksomhet} />
      <OkonomiKort okonomi={okonomi} maaned={MAANEDER[month] ?? ""} />
      <nav className={styles.oppsett} aria-label="Oppsett">
        <span className={styles.oppsettTittel}>Oppsett</span>
        <Link to="/forvaltning/regelsenter">Regelsenter</Link>
        <span aria-hidden>·</span>
        <Link to="/forvaltning/arsbudsjett">Årsbudsjett</Link>
      </nav>
    </div>
  );
}

/**
 * Inngangen til Lønnsdagsrunden (#59): hvor langt runden er kommet og hva
 * som er neste steg. Når runden er ferdig, krymper kortet til én rolig linje.
 */
function RundeKort({ runde }: { runde: Runde }) {
  if (runde.ferdig) {
    return (
      <Link to="/forvaltning/runde" className={styles.rolig}>
        <Icon name="circle-check-big" size={16} />
        <span>Lønnsdagsrunden er ferdig for denne perioden.</span>
      </Link>
    );
  }
  return (
    <section aria-label="Lønnsdagsrunden">
      <Card>
        <Link to="/forvaltning/runde" className={styles.rad}>
          <span className={styles.ikon} aria-hidden>
            <Icon name="list-todo" size={18} />
          </span>
          <span className={styles.tekst}>
            <span className={styles.tittel}>Lønnsdagsrunden</span>
            <span className={styles.beskrivelse}>
              {runde.steg.length - runde.gjenstar} av {runde.steg.length} steg gjort
              {runde.aktivt && <> · Neste: {STEG_TITTEL[runde.aktivt].toLowerCase()}</>}
            </span>
          </span>
          <Icon name="chevron-right" size={16} />
        </Link>
      </Card>
    </section>
  );
}

function SpilleromKort({ o }: { o: SpilleromOversikt }) {
  const klar = o.harSaldo && o.harPoster;
  return (
    <Link
      to="/forvaltning/spillerom"
      className={styles.spillerom}
      aria-label="Spillerom, se detaljer"
    >
      <span className={styles.spilleromTittel}>Spillerom</span>
      {klar ? (
        <>
          <span
            className={`${styles.spilleromTall} ${o.spillerom < 0 ? styles.negativ : styles.positiv}`}
          >
            {kr(o.spillerom)}
          </span>
          <span className={styles.spilleromDetalj}>
            Disponibelt {kr(o.saldo)}
            {o.innbetalinger > 0 && <> · inn {kr(o.innbetalinger)}</>} · ut {kr(o.utbetalinger)}
          </span>
        </>
      ) : (
        <span className={styles.spilleromDetalj}>
          {o.harSaldo
            ? "Legg inn prognoseposter for å se spillerommet."
            : "Sett disponibelt beløp for å se spillerommet."}
        </span>
      )}
      <Icon name="chevron-right" size={16} />
    </Link>
  );
}

interface Handling {
  til: string;
  ikon: IconName;
  tekst: string;
  hint?: string;
}

function OppmerksomhetKort({ o }: { o: Oppmerksomhet }) {
  const handlinger: Handling[] = [];
  if (o.transaksjonerAVurdere > 0) {
    handlinger.push({
      til: "/forvaltning/transaksjoner?ko=vurdering",
      ikon: "list-todo",
      tekst: flertall(o.transaksjonerAVurdere, "transaksjon å vurdere", "transaksjoner å vurdere"),
    });
  }
  if (o.forslagTilMatch > 0) {
    handlinger.push({
      til: "/forvaltning/transaksjoner?ko=forslag",
      ikon: "circle-check-big",
      tekst: flertall(o.forslagTilMatch, "forslag å bekrefte", "forslag å bekrefte"),
    });
  }
  if (o.kvitteringer > 0) {
    handlinger.push({
      til: "/forvaltning/kvitteringer",
      ikon: "receipt-text",
      tekst: flertall(o.kvitteringer, "kvittering å behandle", "kvitteringer å behandle"),
      hint:
        o.kvitteringerMedForslag > 0 ? `${o.kvitteringerMedForslag} med forslag klart` : undefined,
    });
  }

  const vent =
    o.paaVent > 0 ? (
      <Link to="/forvaltning/transaksjoner?ko=paavent" className={styles.vent}>
        {flertall(o.paaVent, "transaksjon", "transaksjoner")} på vent
      </Link>
    ) : null;

  if (handlinger.length === 0) {
    return (
      <section aria-label="Trenger oppmerksomhet" className={styles.rolig}>
        <Icon name="circle-check-big" size={16} />
        <span>Ingenting venter på deg.</span>
        {vent}
      </section>
    );
  }

  return (
    <section aria-label="Trenger oppmerksomhet">
      <h2 className={styles.seksjonTittel}>Trenger oppmerksomhet</h2>
      <Card>
        {handlinger.map((h) => (
          <Link key={h.til} to={h.til} className={styles.rad}>
            <span className={styles.ikon} aria-hidden>
              <Icon name={h.ikon} size={18} />
            </span>
            <span className={styles.tekst}>
              <span className={styles.tittel}>{h.tekst}</span>
              {h.hint && <span className={styles.beskrivelse}>{h.hint}</span>}
            </span>
            <Icon name="chevron-right" size={16} />
          </Link>
        ))}
      </Card>
      {vent && <div className={styles.ventLinje}>{vent}</div>}
    </section>
  );
}

const OMRADER: { nokkel: Omrade; navn: string }[] = [
  { nokkel: "inntekter", navn: "Inntekter" },
  { nokkel: "kostnader", navn: "Kostnader" },
  { nokkel: "sparing", navn: "Sparing" },
];

function OkonomiKort({ okonomi, maaned }: { okonomi: Okonomibilde; maaned: string }) {
  return (
    <section aria-label={`Økonomien i ${maaned}`}>
      <h2 className={styles.seksjonTittel}>Økonomien i {maaned}</h2>
      <Card>
        <div className={styles.kolonneHode} aria-hidden>
          <span />
          <span>Hittil</span>
          <span>Budsjett</span>
        </div>
        {OMRADER.map((o) => (
          <OmradeRad
            key={o.nokkel}
            navn={o.navn}
            til={okonomiLenke(o.nokkel)}
            sum={okonomi[o.nokkel]}
          />
        ))}
        <BelopRad navn="Netto" belop={okonomi.igjen} uthevet />
      </Card>
    </section>
  );
}

function OmradeRad({ navn, til, sum }: { navn: string; til: string; sum: OmradeSum }) {
  const [apen, setApen] = useState(false);
  return (
    <div className={styles.omrade}>
      <button
        type="button"
        className={styles.belopRad}
        aria-expanded={apen}
        onClick={() => setApen((a) => !a)}
      >
        <span className={styles.belopNavn}>
          <Icon name={apen ? "chevron-down" : "chevron-right"} size={14} />
          {navn}
        </span>
        <span className={styles.belop}>{kr(sum.faktisk)}</span>
        <span className={styles.belopSoft}>{kr(sum.budsjett)}</span>
      </button>
      {apen && (
        <div className={styles.grupper}>
          {sum.grupper.length === 0 && <div className={styles.tom}>Ingen grupper ennå.</div>}
          {sum.grupper.map((g) => (
            <div key={g.id} className={styles.gruppeRad}>
              <span className={styles.belopNavn}>{g.label}</span>
              <span className={styles.belop}>{kr(g.faktisk)}</span>
              <span className={styles.belopSoft}>{kr(g.budsjett)}</span>
            </div>
          ))}
          <Link to={til} className={styles.detaljLenke}>
            Åpne {navn.toLowerCase()} →
          </Link>
        </div>
      )}
    </div>
  );
}

function BelopRad({ navn, belop, uthevet }: { navn: string; belop: Belop; uthevet?: boolean }) {
  return (
    <div className={`${styles.belopRad} ${uthevet ? styles.uthevet : ""}`}>
      <span className={styles.belopNavn}>{navn}</span>
      {/* Nøytral farge: tidlig i måneden er netto hittil ofte negativ før
          inntektene kommer — det er informasjon, ikke en alarm. */}
      <span className={styles.belop}>{kr(belop.faktisk)}</span>
      <span className={styles.belopSoft}>{kr(belop.budsjett)}</span>
    </div>
  );
}
