import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RoomHeader } from "@components/RoomHeader";
import {
  type AvstemmingsRad,
  type Avstemmingsmodell,
  type Problem,
  maanedsstatus,
  nesteKonto,
} from "@domain/avstemming/avstemmingsko";
import { kontoNavn } from "@domain/forsoning/regelsenter";
import styles from "./Avstemming.module.css";
import type { AvstemmingViewProps } from "./AvstemmingView";
import { Matrise } from "./avstemmingDeler";
import { krOre, maanedNavn } from "./avstemmingTekst";
import { KontoPanel, SamletStatus } from "./KontoPanel";
import { problemTekst, radHandling, radStatus } from "./problemTekst";

type PCProps = AvstemmingViewProps & {
  modell: Avstemmingsmodell;
  maaned: string;
  onVelgMaaned: (m: string) => void;
  valgtKonto: string | null;
  onVelgKonto: (k: string | null) => void;
};

/**
 * Kompakt PC-avstemming (#59, AV-1, 6572970205). Én konto/periode i
 * detaljpanelet om gangen, med årsak og neste handling først; regnestykket,
 * forklaringene og historikken er foldet. Alt leses av den felles modellen
 * (`avstemmingsko`), og alle handlinger bruker de eksisterende skriveveiene.
 */
export function AvstemmingPC(props: PCProps) {
  const { oversikt, modell, maaned, onVelgMaaned, valgtKonto, onVelgKonto, onVisTidligereAar } =
    props;
  // Satt når «videre til neste konto» flytter valget: saldofeltet får fokus.
  const [fokus, setFokus] = useState(false);
  // «Neste konto» kalles etter at lagringen er bekreftet: les den ferskeste
  // modellen, ikke den fra renderen da lagringen startet.
  const fersk = useRef(modell);
  fersk.current = modell;
  const rader = modell.rader[maaned] ?? [];
  const status = maanedsstatus(modell, maaned);
  const standard =
    rader.find((r) => r.problemer.length > 0) ?? rader.find((r) => r.fase === "aktiv") ?? rader[0];
  const valgt = rader.find((r) => r.konto === valgtKonto) ?? standard;
  // Standardvalget låses når det vises: en lagring som løser problemet,
  // skal ikke flytte panelet til en annen konto midt i arbeidet.
  useEffect(() => {
    if (valgtKonto === null && standard) onVelgKonto(standard.konto);
  }, [valgtKonto, standard, onVelgKonto]);
  const aarListe = [...new Set(oversikt.maaneder.map((m) => m.slice(0, 4)))];
  const aar = maaned.slice(0, 4);
  const aaretsMaaneder = oversikt.maaneder.filter((m) => m.startsWith(aar)).reverse();
  const tidligste = aarListe[aarListe.length - 1];

  const velg = (konto: string | null, m: string = maaned) => {
    setFokus(false);
    onVelgMaaned(m);
    onVelgKonto(konto);
  };
  const tilNeste = (fra: string) => {
    const neste = nesteKonto(fersk.current, maaned, fra);
    if (!neste || neste === fra) return;
    onVelgKonto(neste);
    setFokus(true);
  };

  return (
    <div className={`${styles.side} ${styles.pc}`}>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Avstemming"
        description="Saldo per konto, kalendermåned for kalendermåned"
      />

      <nav className={styles.aarVelger} aria-label="Velg år">
        {aarListe.map((a) => (
          <button
            key={a}
            type="button"
            className={a === aar ? styles.maanedValgt : styles.maanedKnapp}
            aria-pressed={a === aar}
            onClick={() =>
              velg(valgtKonto, oversikt.maaneder.find((m) => m.startsWith(a)) ?? maaned)
            }
          >
            {a}
          </button>
        ))}
        {onVisTidligereAar && tidligste && (
          <button
            type="button"
            className={styles.korrKnapp}
            onClick={() => {
              onVisTidligereAar();
              velg(valgtKonto, `${Number(tidligste) - 1}-12`);
            }}
          >
            Vis {Number(tidligste) - 1}
          </button>
        )}
      </nav>

      <SamletStatus
        modell={modell}
        status={status}
        onVelg={(m) => {
          const forste = modell.problemer.find((p) => p.maaned === m && p.konto !== "?");
          velg(forste?.konto ?? null, m);
        }}
      />

      <Matrise
        oversikt={oversikt}
        maaneder={aaretsMaaneder}
        aar={aar}
        valgt={maaned}
        onVelg={(m) => velg(valgtKonto, m)}
        kontoer={modell.kontoer}
        statusFor={(k, m) => {
          const r = modell.rader[m]?.find((x) => x.konto === k);
          return r ? { status: r.status, lagrer: !!r.lagrer } : undefined;
        }}
        valgtKonto={valgt?.konto}
        onVelgCelle={(k, m) => velg(k, m)}
      />

      <div className={styles.pcArbeid}>
        <KontoTabell
          rader={rader}
          maaned={maaned}
          ukjent={modell.ukjent[maaned]}
          valgt={valgt?.konto ?? null}
          onVelg={(k) => velg(k)}
        />
        {valgt && (
          <KontoPanel
            key={`${valgt.konto}|${maaned}`}
            {...props}
            rad={valgt}
            fokus={fokus}
            onNeste={() => tilNeste(valgt.konto)}
            onVelg={velg}
          />
        )}
      </div>

      <Link to="/forvaltning" className={styles.tilbake}>
        Til Forvaltning
      </Link>
    </div>
  );
}

const belop = (ore: number | null, mangler = "—") => (ore === null ? mangler : krOre(ore));

function KontoTabell({
  rader,
  maaned,
  ukjent,
  valgt,
  onVelg,
}: {
  rader: AvstemmingsRad[];
  maaned: string;
  ukjent: Problem | undefined;
  valgt: string | null;
  onVelg: (konto: string) => void;
}) {
  return (
    <div className={styles.tabellRamme}>
      <table className={styles.kontoTabell} aria-label={`Kontoer i ${maanedNavn(maaned)}`}>
        <thead>
          <tr>
            <th scope="col">Konto</th>
            <th scope="col">Inngående</th>
            <th scope="col">Inn</th>
            <th scope="col">Ut</th>
            <th scope="col">Beregnet utgående</th>
            <th scope="col">Faktisk utgående</th>
            <th scope="col">Differanse</th>
            <th scope="col">Status / handling</th>
          </tr>
        </thead>
        <tbody>
          {rader.map((r) => {
            const lagrer = !!r.lagrer;
            const handling = lagrer ? null : radHandling(r);
            const erValgt = r.konto === valgt;
            return (
              <tr
                key={r.konto}
                className={`${erValgt ? styles.radValgt : ""} ${r.fase !== "aktiv" ? styles.radDempet : ""}`}
              >
                <th scope="row">
                  <button
                    type="button"
                    className={styles.radKnapp}
                    aria-pressed={erValgt}
                    onClick={() => onVelg(r.konto)}
                  >
                    {kontoNavn(r.konto)}
                  </button>
                </th>
                <td className={styles.tall}>{belop(r.inngaaendeOre, "mangler")}</td>
                <td className={styles.tall}>{r.vurdering ? krOre(r.innOre) : "—"}</td>
                <td className={styles.tall}>{r.vurdering ? krOre(r.utOre) : "—"}</td>
                <td className={styles.tall}>
                  {belop(r.beregnetOre)}
                  {r.avledetOre !== 0 && (
                    <span className={styles.underTall}>inkl. avledet {krOre(r.avledetOre)}</span>
                  )}
                </td>
                <td className={styles.tall}>{belop(r.faktiskOre, "mangler")}</td>
                <td className={styles.tall}>{belop(r.differanseOre)}</td>
                <td>
                  <span
                    className={
                      r.ok && !lagrer
                        ? styles.statusOk
                        : r.fase === "aktiv"
                          ? styles.statusApen
                          : undefined
                    }
                  >
                    {lagrer ? "Lagrer…" : radStatus(r)}
                  </span>
                  {handling && <span className={styles.handling}>{handling}</span>}
                </td>
              </tr>
            );
          })}
          {ukjent && (
            <tr className={styles.radUkjent}>
              <th scope="row">Ukjent konto</th>
              <td colSpan={6}>{problemTekst(ukjent).aarsak}</td>
              <td>
                <Link to="/forvaltning/transaksjoner" className={styles.handling}>
                  {problemTekst(ukjent).handling}
                </Link>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
