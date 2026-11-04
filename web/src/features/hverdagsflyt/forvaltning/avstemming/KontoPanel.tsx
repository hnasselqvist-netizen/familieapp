import { useId, useState } from "react";
import {
  type AvstemmingsRad,
  type Avstemmingsmodell,
  type maanedsstatus,
  type Problem,
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
  SaldoFelt,
  StatusTekst,
  UtenMotpost,
} from "./avstemmingDeler";
import { datoKort, krOre, maanedNavn } from "./avstemmingTekst";
import { problemTekst, radStatus } from "./problemTekst";

/**
 * Det PC (AV-1) og mobil (AV-2) viser likt for én konto/periode: samlet
 * status og panelet med årsak og neste handling først, regnestykket og
 * historikk/angring foldet. Leser den viste, bekreftede raden — aldri en
 * ubekreftet lokal skriving — og bruker de sporede skriveveiene.
 */

export type PanelHandlinger = Pick<
  AvstemmingViewProps,
  "onLagre" | "onAvklarIgnorert" | "transaksjoner" | "korrigering"
>;

export function SamletStatus({
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
    s.lagrer > 0 && `${s.lagrer} lagres, venter på bekreftelse`,
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

export function KontoPanel({
  rad: r,
  maaned,
  fokus = false,
  onNeste,
  onVelg,
  onLagre,
  onAvklarIgnorert,
  transaksjoner: alle,
  korrigering,
  kompakt = false,
}: PanelHandlinger & {
  rad: AvstemmingsRad;
  maaned: string;
  fokus?: boolean;
  onNeste?: () => void;
  onVelg: (konto: string, maaned: string) => void;
  /**
   * Mobilens handlingskort (AV-2): bare det som gjenstår står fremme;
   * saldofeltet ligger foldet når ingen av problemene trenger det.
   */
  kompakt?: boolean;
}) {
  const id = useId();
  const { konto } = r;
  const navn = kontoNavn(konto);
  const gjeld = erGjeldskonto(konto);
  const v = r.vurdering;
  const typer = new Set(r.problemer.map((p) => p.type));
  const lagrer = !!r.lagrer;
  const manglerSaldo = typer.has("mangler_saldo") || typer.has("startpunkt");
  const saldoFremme =
    manglerSaldo ||
    typer.has("avvik") ||
    typer.has("grunnlag_endret") ||
    r.fase === "ingen_data" ||
    r.fase === "foer_start";
  const saldoFelt = (
    <SaldoFelt
      etikett={`${gjeld ? "Skyldig beløp" : "Faktisk saldo"} ${datoKort(sisteDagIMaaned(maaned))}`}
      hint={
        (gjeld
          ? "Skyldig beløp fra kortselskapet, som positivt tall."
          : "Saldo fra nettbanken for siste dag i måneden.") +
        (manglerSaldo && onNeste
          ? " Enter lagrer og går videre til neste konto som mangler saldo."
          : "")
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

      {!kompakt || saldoFremme ? (
        saldoFelt
      ) : (
        <details className={styles.foldet}>
          <summary>Endre saldo</summary>
          {saldoFelt}
        </details>
      )}

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
  alle: PanelHandlinger["transaksjoner"];
  korrigering: PanelHandlinger["korrigering"];
  onAvklarIgnorert: PanelHandlinger["onAvklarIgnorert"];
  onLagre: PanelHandlinger["onLagre"];
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
  alle: PanelHandlinger["transaksjoner"];
  korrigering: PanelHandlinger["korrigering"];
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
