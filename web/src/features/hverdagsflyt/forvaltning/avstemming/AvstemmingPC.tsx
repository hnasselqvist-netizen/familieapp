import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RoomHeader } from "@components/RoomHeader";
import {
  type AvstemmingsRad,
  type Avstemmingsmodell,
  type Problem,
  maanedsstatus,
  nesteKonto,
} from "@domain/avstemming/avstemmingsko";
import {
  type KontoMaanedVurdering,
  erGjeldskonto,
  forrigeMaaned,
  maanedFor,
  nesteMaaned,
  sisteDagIMaaned,
} from "@domain/avstemming/saldoavstemming";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import { kontoNavn } from "@domain/forsoning/regelsenter";
import styles from "./Avstemming.module.css";
import type { AvstemmingViewProps } from "./AvstemmingView";
import {
  Avledede,
  AvklarIgnorerte,
  EndretAvledet,
  Forklaringer,
  HoldtUtenfor,
  Linje,
  Matrise,
  SaldoFelt,
  StatusTekst,
  UtenMotpost,
} from "./avstemmingDeler";
import { datoKort, krOre, maanedNavn } from "./avstemmingTekst";
import { problemTekst, radHandling, radStatus } from "./problemTekst";

type PCProps = AvstemmingViewProps & {
  modell: Avstemmingsmodell;
  maaned: string;
  onVelgMaaned: (m: string) => void;
  valgtKonto: string | null;
  onVelgKonto: (k: string | null) => void;
  /** En skriving som berører konto/måned, er ikke bekreftet ennå. */
  venter: (konto: string, maaned: string) => boolean;
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
          venter={(k) => props.venter(k, maaned)}
        />
        {valgt && (
          <DetaljPanel
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

function SamletStatus({
  modell,
  status: s,
  onVelg,
}: {
  modell: Avstemmingsmodell;
  status: ReturnType<typeof maanedsstatus>;
  onVelg: (maaned: string) => void;
}) {
  const deler = [
    s.avvikEllerUsikker > 0 && `${s.avvikEllerUsikker} med avvik eller usikker`,
    s.manglerGrunnlag > 0 && `${s.manglerGrunnlag} mangler saldo`,
    s.avledet > 0 && `${s.avledet} stemmer bare med avledet motpost`,
    s.andreApne > 0 && `${s.andreApne} avstemt med åpne forhold`,
    s.startsaldo > 0 && `${s.startsaldo} med startsaldo`,
    s.ukjentKonto > 0 && `${s.ukjentKonto} transaksjoner uten konto`,
  ].filter(Boolean);
  return (
    <section className={styles.samletStatus} aria-label="Samlet status">
      <p className={styles.samletLinje}>
        <strong>{maanedNavn(s.maaned)}:</strong> {s.bankavstemt} av {s.aktive}{" "}
        {s.aktive === 1 ? "konto" : "kontoer"} bankavstemt
        {deler.length > 0 && ` · ${deler.join(" · ")}`}
      </p>
      {s.andreMaaneder.length > 0 ? (
        <div className={styles.andreMaaneder}>
          <span>Åpne forhold i andre måneder:</span>
          {s.andreMaaneder.slice(0, 12).map(({ maaned, antall }) => (
            <button
              key={maaned}
              type="button"
              className={styles.korrKnapp}
              onClick={() => onVelg(maaned)}
            >
              {maanedNavn(maaned)} ({antall})
            </button>
          ))}
          {s.andreMaaneder.length > 12 && <span>og {s.andreMaaneder.length - 12} til</span>}
        </div>
      ) : (
        modell.maaneder.length > 1 && (
          <p className={styles.dempet}>Ingen åpne forhold i andre måneder.</p>
        )
      )}
    </section>
  );
}

const belop = (ore: number | null, mangler = "—") => (ore === null ? mangler : krOre(ore));

function KontoTabell({
  rader,
  maaned,
  ukjent,
  valgt,
  onVelg,
  venter,
}: {
  rader: AvstemmingsRad[];
  maaned: string;
  ukjent: Problem | undefined;
  valgt: string | null;
  onVelg: (konto: string) => void;
  venter: (konto: string) => boolean;
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
            const lagrer = venter(r.konto);
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

function DetaljPanel({
  rad: r,
  maaned,
  fokus,
  venter,
  onNeste,
  onVelg,
  onLagre,
  onAvklarIgnorert,
  transaksjoner: alle,
  korrigering,
}: PCProps & {
  rad: AvstemmingsRad;
  fokus: boolean;
  onNeste: () => void;
  onVelg: (konto: string, maaned: string) => void;
}) {
  const id = useId();
  const { konto } = r;
  const navn = kontoNavn(konto);
  const gjeld = erGjeldskonto(konto);
  const v = r.vurdering;
  const typer = new Set(r.problemer.map((p) => p.type));
  const lagrer = venter(konto, maaned);
  const manglerSaldo = typer.has("mangler_saldo") || typer.has("startpunkt");
  const saldoFelt = (
    <SaldoFelt
      etikett={`${gjeld ? "Skyldig beløp" : "Faktisk saldo"} ${datoKort(sisteDagIMaaned(maaned))}`}
      hint={
        (gjeld
          ? "Skyldig beløp fra kortselskapet, som positivt tall."
          : "Saldo fra nettbanken for siste dag i måneden.") +
        (manglerSaldo ? " Enter lagrer og går videre til neste konto som mangler saldo." : "")
      }
      konto={konto}
      maaned={maaned}
      lagret={v?.kontroll ? v.kontroll.faktiskSaldo : null}
      onLagre={(s) => onLagre(konto, maaned, s)}
      onLagret={manglerSaldo ? onNeste : undefined}
      autoFokus={fokus && !typer.has("startpunkt")}
    />
  );

  return (
    <section className={styles.panel} aria-labelledby={id}>
      <header className={styles.kortTopp}>
        <h3 id={id} className={styles.kontoNavn}>
          {navn}, {maanedNavn(maaned)}
        </h3>
        <span className={r.ok && !lagrer ? styles.statusOk : styles.statusApen}>
          {lagrer ? "Lagrer…" : radStatus(r)}
        </span>
      </header>
      {lagrer && (
        <p className={styles.dempet} role="status">
          Lagrer — venter på bekreftelse. Statusen oppdateres når lagringen er bekreftet.
        </p>
      )}

      {r.fase === "ingen_data" && (
        <p className={styles.dempet}>
          Ingen bevegelser eller saldo er registrert for {navn}. Registrer en saldo for å ta kontoen
          med i avstemmingen.
        </p>
      )}
      {r.fase === "foer_start" && (
        <p className={styles.dempet}>
          Før første registrerte saldo for {navn}: ikke del av avstemmingen. En saldo her gjør
          måneden til nytt startpunkt.
        </p>
      )}
      {r.fase === "start" && (
        <>
          <p className={styles.dempet}>
            Startsaldo for {navn}: grunnlaget for {maanedNavn(nesteMaaned(maaned), true)}. Måneden
            selv avstemmes ikke uten saldo for {maanedNavn(forrigeMaaned(maaned), true)}.
          </p>
          <SaldoFelt
            etikett={`${gjeld ? "Skyldig beløp" : "Saldo"} ${datoKort(sisteDagIMaaned(forrigeMaaned(maaned)))} (startpunkt)`}
            hint={`Valgfritt: faktisk saldo for siste dag i ${maanedNavn(forrigeMaaned(maaned), true)}, så ${maanedNavn(maaned, true)} også kan kontrolleres.`}
            konto={konto}
            maaned={forrigeMaaned(maaned)}
            lagret={null}
            onLagre={(s) => onLagre(konto, forrigeMaaned(maaned), s)}
          />
        </>
      )}
      {r.ok && !lagrer && (
        <p className={styles.okTekst} role="status">
          Avstemt mot banken. Ingenting gjenstår for {navn} i {maanedNavn(maaned, true)}.
        </p>
      )}

      {r.problemer.length > 0 && v && (
        <ol className={styles.problemer} aria-label="Dette gjenstår">
          {r.problemer.map((p) => (
            <li key={p.type} className={styles.problem}>
              <p className={styles.aarsak}>
                <strong>{problemTekst(p).handling}:</strong> {problemTekst(p).aarsak}
              </p>
              <ProblemHandling
                p={p}
                v={v}
                alle={alle}
                korrigering={korrigering}
                onAvklarIgnorert={onAvklarIgnorert}
                onLagre={onLagre}
                onVelg={onVelg}
                fokus={fokus}
              />
            </li>
          ))}
        </ol>
      )}

      {saldoFelt}

      {v && (
        <details className={styles.foldet}>
          <summary>Regnestykket</summary>
          <Regnestykke v={v} />
          <StatusTekst v={v} />
        </details>
      )}
      {v && (
        <details className={styles.foldet}>
          <summary>Historikk og angring</summary>
          <Historikk v={v} alle={alle} korrigering={korrigering} skjul={typer} />
        </details>
      )}
    </section>
  );
}

function ProblemHandling({
  p,
  v,
  alle,
  korrigering,
  onAvklarIgnorert,
  onLagre,
  onVelg,
  fokus,
}: {
  p: Problem;
  v: KontoMaanedVurdering;
  alle: PCProps["transaksjoner"];
  korrigering: PCProps["korrigering"];
  onAvklarIgnorert: PCProps["onAvklarIgnorert"];
  onLagre: PCProps["onLagre"];
  onVelg: (konto: string, maaned: string) => void;
  fokus: boolean;
}) {
  const { konto, maaned } = v;
  switch (p.type) {
    case "startpunkt": {
      const forrige = forrigeMaaned(maaned);
      return (
        <SaldoFelt
          etikett={`${erGjeldskonto(konto) ? "Skyldig beløp" : "Saldo"} ${datoKort(sisteDagIMaaned(forrige))} (startpunkt)`}
          hint={`Faktisk saldo fra banken for siste dag i ${maanedNavn(forrige, true)}.`}
          konto={konto}
          maaned={forrige}
          lagret={null}
          onLagre={(s) => onLagre(konto, forrige, s)}
          autoFokus={fokus}
        />
      );
    }
    case "uavklart_ignorert":
      return (
        <AvklarIgnorerte liste={v.grunnlag.uavklarte.transaksjoner} onAvklar={onAvklarIgnorert} />
      );
    case "avledet_mulig_importert":
    case "avledet":
      return <Avledede v={v} alle={alle} korrigering={korrigering} />;
    case "avledet_kilde_endret":
      return (
        <ul className={styles.korrListe}>
          {v.grunnlag.avledetKildeEndret.map((a) => {
            const k = normaliserKonto(a.kilde);
            const m = maanedFor(a.kilde.dato) ?? maaned;
            return (
              <li key={a.kilde.id} className={styles.korrLinje}>
                <span>
                  {a.kilde.tekst} {datoKort(a.kilde.dato)} på {kontoNavn(k)}
                </span>
                <button type="button" className={styles.korrKnapp} onClick={() => onVelg(k, m)}>
                  Gå til {kontoNavn(k)}, {maanedNavn(m)}
                </button>
              </li>
            );
          })}
        </ul>
      );
    case "avledet_endret":
      return <EndretAvledet v={v} alle={alle} korrigering={korrigering} />;
    case "avvik":
      return <Forklaringer v={v} alle={alle} korrigering={korrigering} />;
    case "grunnlag_endret":
      return v.kontroll ? (
        <BekreftPaaNytt
          onBekreft={() => onLagre(konto, maaned, v.kontroll!.faktiskSaldo)}
          saldo={v.kontroll.faktiskSaldo}
          konto={konto}
        />
      ) : null;
    default:
      // mangler_saldo: saldofeltet under. manglende_motpost: i forklaringene.
      return null;
  }
}

/**
 * Lagrer den registrerte saldoen på nytt med et ferskt øyeblikksbilde av
 * grunnlaget — samme skrivevei som saldofeltet, ingen ny.
 */
function BekreftPaaNytt({
  onBekreft,
  saldo,
  konto,
}: {
  onBekreft: () => Promise<void>;
  saldo: number;
  konto: string;
}) {
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const vist = erGjeldskonto(konto) ? -saldo : saldo;
  return (
    <div className={styles.korrLinje}>
      <button
        type="button"
        className={styles.korrKnapp}
        disabled={lagrer}
        onClick={async () => {
          setLagrer(true);
          setFeil(null);
          try {
            await onBekreft();
          } catch (e) {
            console.error(e);
            setFeil("Kunne ikke lagre. Prøv igjen.");
          } finally {
            setLagrer(false);
          }
        }}
      >
        {lagrer ? "Lagrer…" : `Bekreft ${krOre(Math.round(vist * 100))} mot dagens grunnlag`}
      </button>
      {feil && (
        <span className={styles.feil} role="alert">
          {feil}
        </span>
      )}
    </div>
  );
}

function Regnestykke({ v }: { v: KontoMaanedVurdering }) {
  const { maaned, grunnlag } = v;
  const forrige = forrigeMaaned(maaned);
  return (
    <dl className={styles.regnestykke}>
      <Linje
        tekst={`Saldo ${datoKort(sisteDagIMaaned(forrige))}`}
        verdi={v.forrigeSaldoOre === null ? "mangler" : krOre(v.forrigeSaldoOre)}
      />
      <Linje tekst={`+ Inn i ${maanedNavn(maaned, true)}`} verdi={krOre(grunnlag.innOre)} />
      <Linje tekst={`− Ut i ${maanedNavn(maaned, true)}`} verdi={krOre(grunnlag.utOre)} />
      {grunnlag.avledede.antall > 0 && (
        <Linje
          tekst={`≈ Avledet motpost, ikke bankimportert (${grunnlag.avledede.antall})`}
          verdi={krOre(grunnlag.avledede.nettoOre)}
        />
      )}
      <Linje
        tekst={`= Beregnet ${datoKort(sisteDagIMaaned(maaned))}`}
        verdi={v.beregnetOre === null ? "—" : krOre(v.beregnetOre)}
        sterk
      />
      <Linje
        tekst={`Faktisk ${datoKort(sisteDagIMaaned(maaned))}`}
        verdi={v.kontroll ? krOre(Math.round(v.kontroll.faktiskSaldo * 100)) : "ikke registrert"}
        sterk
      />
    </dl>
  );
}

/**
 * Alt som kan angres eller rettes, også når måneden er løst: «Ikke dublett»,
 * motposter uten kobling og avledede motposter. Det som allerede står som
 * en handling over, vises ikke to ganger.
 */
function Historikk({
  v,
  alle,
  korrigering,
  skjul,
}: {
  v: KontoMaanedVurdering;
  alle: PCProps["transaksjoner"];
  korrigering: PCProps["korrigering"];
  skjul: Set<string>;
}) {
  const g = v.grunnlag;
  const harAvledede =
    g.avledede.antall > 0 || g.avledetMedKandidat.length > 0 || g.avledetKildeEndret.length > 0;
  return (
    <>
      <p className={styles.antall}>
        {g.antall} transaksjon{g.antall === 1 ? "" : "er"} i {maanedNavn(v.maaned, true)}
        {g.dubletter.antall > 0 &&
          ` · ${g.dubletter.antall} avklart som dublett${g.dubletter.antall === 1 ? "" : "er"}, holdt utenfor`}
      </p>
      {g.dubletter.antall > 0 && <HoldtUtenfor v={v} alle={alle} korrigering={korrigering} />}
      <UtenMotpost v={v} alle={alle} korrigering={korrigering} />
      {!skjul.has("avledet_endret") && (
        <EndretAvledet v={v} alle={alle} korrigering={korrigering} />
      )}
      {harAvledede && !skjul.has("avledet") && !skjul.has("avledet_mulig_importert") && (
        <Avledede v={v} alle={alle} korrigering={korrigering} />
      )}
    </>
  );
}
