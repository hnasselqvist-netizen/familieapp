import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RoomHeader } from "@components/RoomHeader";
import {
  type Avstemmingsoversikt,
  type KontoMaanedVurdering,
  erGjeldskonto,
  forrigeMaaned,
  fraVisningsSaldo,
  sisteDagIMaaned,
  tilVisningsSaldo,
} from "@domain/avstemming/saldoavstemming";
import { kontoNavn } from "@domain/forsoning/regelsenter";
import type { IgnorertSom, TransaksjonRecord } from "@app-types/forsoning";
import styles from "./Avstemming.module.css";
import { KorrigerbarRad } from "./KorrigerbarRad";
import type { Korrigeringshandlinger } from "./korrigeringTyper";
import {
  STATUS_SYMBOL,
  STATUS_TEKST,
  datoKort,
  differanseTekst,
  kortMaaned,
  krOre,
  maanedNavn,
  parseSaldo,
} from "./avstemmingTekst";

export interface AvstemmingViewProps {
  oversikt: Avstemmingsoversikt;
  /** Lagrer faktisk saldo med fortegn (MC-gjeld negativ) for konto/måned. */
  onLagre: (konto: string, maaned: string, faktiskSaldo: number) => Promise<void>;
  /** Helens avklaring av en ignorert transaksjon: dublett eller ekte bankbevegelse. */
  onAvklarIgnorert: (transaksjonId: string, som: IgnorertSom) => Promise<void>;
  /** Alle transaksjoner, for motposter på andre kontoer. */
  transaksjoner: readonly TransaksjonRecord[];
  /** Reversible korrigeringer fra avvikshjelpen (dublett ↔ ekte bevegelse). */
  korrigering: Korrigeringshandlinger;
  /** Viser året før det tidligste (for startsaldo lenger bak). */
  onVisTidligereAar?: () => void;
}

/**
 * Saldoavstemming per konto og kalendermåned (#59). Helens regnestykke:
 * faktisk saldo forrige måned + månedens importerte bevegelser = beregnet
 * saldo, mot faktisk saldo fra banken. Status er utledet (§domain/avstemming)
 * og revurderes når transaksjonene endres; å lagre en saldo gjør aldri noe
 * «avstemt» av seg selv.
 */
export function AvstemmingView({
  oversikt,
  onLagre,
  onAvklarIgnorert,
  transaksjoner,
  korrigering,
  onVisTidligereAar,
}: AvstemmingViewProps) {
  const [maaned, setMaaned] = useState(oversikt.maaneder[0] ?? "");
  const ukjent = oversikt.ukjentKonto[maaned] ?? 0;
  const aarListe = [...new Set(oversikt.maaneder.map((m) => m.slice(0, 4)))];
  const aar = maaned.slice(0, 4);
  const aaretsMaaneder = oversikt.maaneder.filter((m) => m.startsWith(aar)).reverse();
  const tidligste = aarListe[aarListe.length - 1];

  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Avstemming"
        description="Saldo per konto, kalendermåned for kalendermåned"
      />

      {oversikt.kontoer.length === 0 ? (
        <p className={styles.tom}>Ingen kontoer med importerte transaksjoner ennå.</p>
      ) : (
        <>
          <nav className={styles.aarVelger} aria-label="Velg år">
            {aarListe.map((a) => (
              <button
                key={a}
                type="button"
                className={a === aar ? styles.maanedValgt : styles.maanedKnapp}
                aria-pressed={a === aar}
                onClick={() => setMaaned(oversikt.maaneder.find((m) => m.startsWith(a)) ?? maaned)}
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
                  setMaaned(`${Number(tidligste) - 1}-12`);
                }}
              >
                Vis {Number(tidligste) - 1}
              </button>
            )}
          </nav>
          <Matrise
            oversikt={oversikt}
            maaneder={aaretsMaaneder}
            aar={aar}
            valgt={maaned}
            onVelg={setMaaned}
          />

          <h2 className={styles.maanedTittel}>{maanedNavn(maaned)}</h2>
          {ukjent > 0 && (
            <p className={styles.advarsel} role="note">
              {ukjent} transaksjon{ukjent === 1 ? "" : "er"} i {maanedNavn(maaned, true)} mangler
              konto og kan ikke avstemmes mot noen konto.
            </p>
          )}
          {oversikt.kontoer.map((konto) => {
            const v = oversikt.celler[konto]?.[maaned];
            return v ? (
              <KontoKort
                key={`${konto}-${maaned}`}
                v={v}
                onLagre={onLagre}
                onAvklarIgnorert={onAvklarIgnorert}
                alle={transaksjoner}
                korrigering={korrigering}
              />
            ) : null;
          })}
        </>
      )}

      <Link to="/forvaltning" className={styles.tilbake}>
        Til Forvaltning
      </Link>
    </div>
  );
}

/** Hvilke kontoer og måneder som er klare — rader per konto, kolonner per måned. */
function Matrise({
  oversikt,
  maaneder,
  aar,
  valgt,
  onVelg,
}: {
  oversikt: Avstemmingsoversikt;
  /** Det valgte årets avsluttede måneder, eldste først. */
  maaneder: string[];
  aar: string;
  valgt: string;
  onVelg: (maaned: string) => void;
}) {
  const kolonner = maaneder;
  const ramme = useRef<HTMLDivElement>(null);
  // Med opptil tolv måneder ruller matrisen sidelengs på mobil: hold den
  // valgte måneden synlig uten å rulle selve siden.
  useEffect(() => {
    const r = ramme.current;
    const knapp = r?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (!r || !knapp) return;
    const rr = r.getBoundingClientRect();
    const kr = knapp.getBoundingClientRect();
    r.scrollLeft += kr.left - rr.left - rr.width / 2 + kr.width / 2;
  }, [valgt, aar]);
  return (
    <>
      <div className={styles.matriseRamme} ref={ramme}>
        <table className={styles.matrise} aria-label={`Status per konto og måned i ${aar}`}>
          <thead>
            <tr>
              <th scope="col">Konto</th>
              {kolonner.map((m) => (
                <th key={m} scope="col">
                  <button
                    type="button"
                    className={m === valgt ? styles.maanedValgt : styles.maanedKnapp}
                    aria-pressed={m === valgt}
                    aria-label={maanedNavn(m)}
                    onClick={() => onVelg(m)}
                  >
                    {kortMaaned(m)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {oversikt.kontoer.map((konto) => (
              <tr key={konto}>
                <th scope="row">{kontoNavn(konto)}</th>
                {kolonner.map((m) => {
                  const status = oversikt.celler[konto]?.[m]?.status ?? "ingen_saldo";
                  return (
                    <td key={m} className={styles[`celle_${status}`]}>
                      <span aria-hidden>{STATUS_SYMBOL[status]}</span>
                      <span className={styles.srOnly}>
                        {kontoNavn(konto)} {maanedNavn(m)}: {STATUS_TEKST[status]}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.forklaring}>
        ✓ avstemt · ≠ avvik · ? usikker · • startpunkt · – mangler saldo
      </p>
    </>
  );
}

function KontoKort({
  v,
  onLagre,
  onAvklarIgnorert,
  alle,
  korrigering,
}: {
  v: KontoMaanedVurdering;
  onLagre: AvstemmingViewProps["onLagre"];
  onAvklarIgnorert: AvstemmingViewProps["onAvklarIgnorert"];
  alle: readonly TransaksjonRecord[];
  korrigering: Korrigeringshandlinger;
}) {
  const { konto, maaned, grunnlag } = v;
  const navn = kontoNavn(konto);
  const gjeld = erGjeldskonto(konto);
  const forrige = forrigeMaaned(maaned);
  const tittelId = `avstemming-${konto}-${maaned}`;
  return (
    <section className={styles.kort} aria-labelledby={tittelId}>
      <header className={styles.kortTopp}>
        <h3 id={tittelId} className={styles.kontoNavn}>
          {navn}
        </h3>
        <span className={styles[`merke_${v.status}`]}>{STATUS_TEKST[v.status]}</span>
      </header>

      <dl className={styles.regnestykke}>
        <Linje
          tekst={`Saldo ${datoKort(sisteDagIMaaned(forrige))}`}
          verdi={v.forrigeSaldoOre === null ? "mangler" : krOre(v.forrigeSaldoOre)}
        />
        <Linje tekst={`+ Inn i ${maanedNavn(maaned, true)}`} verdi={krOre(grunnlag.innOre)} />
        <Linje tekst={`− Ut i ${maanedNavn(maaned, true)}`} verdi={krOre(grunnlag.utOre)} />
        {grunnlag.uavklarte.antall > 0 && (
          <Linje
            tekst={`? Ignorert, ikke avklart (${grunnlag.uavklarte.antall})`}
            verdi={`${krOre(grunnlag.uavklarte.nettoOre)} ikke med`}
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
      <p className={styles.antall}>
        {grunnlag.antall} transaksjon{grunnlag.antall === 1 ? "" : "er"} i{" "}
        {maanedNavn(maaned, true)}
        {grunnlag.dubletter.antall > 0 &&
          ` · ${grunnlag.dubletter.antall} avklart som dublett${
            grunnlag.dubletter.antall === 1 ? "" : "er"
          }, holdt utenfor`}
        {gjeld && " · saldo med fortegn: skyldig beløp er negativt"}
      </p>

      <StatusTekst v={v} />

      {grunnlag.uavklarte.antall > 0 && (
        <AvklarIgnorerte liste={grunnlag.uavklarte.transaksjoner} onAvklar={onAvklarIgnorert} />
      )}

      {v.forrigeSaldoOre === null && (
        <SaldoFelt
          etikett={`${gjeld ? "Skyldig beløp" : "Saldo"} ${datoKort(sisteDagIMaaned(forrige))} (startpunkt)`}
          hint={`Faktisk saldo fra banken for siste dag i ${maanedNavn(forrige, true)}.`}
          konto={konto}
          lagret={null}
          onLagre={(s) => onLagre(konto, forrige, s)}
        />
      )}
      <SaldoFelt
        etikett={`${gjeld ? "Skyldig beløp" : "Faktisk saldo"} ${datoKort(sisteDagIMaaned(maaned))}`}
        hint={
          gjeld
            ? "Skyldig beløp fra kortselskapet, som positivt tall."
            : "Saldo fra nettbanken for siste dag i måneden."
        }
        konto={konto}
        lagret={v.kontroll ? v.kontroll.faktiskSaldo : null}
        onLagre={(s) => onLagre(konto, maaned, s)}
      />

      {v.status === "avvik" && <Forklaringer v={v} alle={alle} korrigering={korrigering} />}
      {grunnlag.dubletter.antall > 0 && (
        <HoldtUtenfor v={v} alle={alle} korrigering={korrigering} />
      )}
    </section>
  );
}

function Linje({ tekst, verdi, sterk }: { tekst: string; verdi: string; sterk?: boolean }) {
  return (
    <div className={sterk ? styles.linjeSterk : styles.linje}>
      <dt>{tekst}</dt>
      <dd>{verdi}</dd>
    </div>
  );
}

function StatusTekst({ v }: { v: KontoMaanedVurdering }) {
  const navn = maanedNavn(v.maaned, true);
  return (
    <div className={styles.statusTekst} role="status">
      {v.status === "avstemt" && <p>Saldoen stemmer med bevegelsene i {navn}.</p>}
      {v.status === "avvik" && v.differanseOre !== null && (
        <p className={styles.avvik}>{differanseTekst(v.differanseOre)}.</p>
      )}
      {v.status === "usikker" &&
        v.differanseOre !== null &&
        v.differanseMedUavklarteOre !== null && (
          <>
            <p className={styles.usikker}>
              Usikker: {v.grunnlag.uavklarte.antall} ignorert
              {v.grunnlag.uavklarte.antall === 1 ? "" : "e"} transaksjon
              {v.grunnlag.uavklarte.antall === 1 ? "" : "er"} er ikke avklart. Måneden regnes ikke
              som avstemt før de er avklart.
            </p>
            <ul className={styles.tolkninger}>
              <li>Er de dubletter: {differanseTekst(v.differanseOre).toLowerCase()}.</li>
              <li>
                Er de ekte bankbevegelser:{" "}
                {differanseTekst(v.differanseMedUavklarteOre).toLowerCase()}.
              </li>
            </ul>
          </>
        )}
      {v.status === "startpunkt" && (
        <p>
          Startpunkt: {navn} kan ikke kontrolleres uten saldo for{" "}
          {maanedNavn(forrigeMaaned(v.maaned), true)}. Den blir grunnlaget for neste måned.
        </p>
      )}
      {v.status === "ingen_saldo" && <p>Registrer faktisk saldo fra banken for å kontrollere.</p>}
      {v.grunnlagEndret && (
        <p className={styles.endret}>
          Transaksjonsgrunnlaget er endret siden saldoen ble lagret
          {v.endringAntall !== 0 &&
            ` (${v.endringAntall > 0 ? "+" : ""}${v.endringAntall} transaksjon${
              Math.abs(v.endringAntall) === 1 ? "" : "er"
            })`}
          . Statusen over er regnet på nytt.
        </p>
      )}
    </div>
  );
}

function SaldoFelt({
  etikett,
  hint,
  konto,
  lagret,
  onLagre,
}: {
  etikett: string;
  hint: string;
  konto: string;
  lagret: number | null;
  onLagre: (faktiskSaldo: number) => Promise<void>;
}) {
  const start = lagret === null ? "" : String(tilVisningsSaldo(konto, lagret)).replace(".", ",");
  const [tekst, setTekst] = useState(start);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const tall = parseSaldo(tekst);
  const uendret = tekst === start;

  const lagre = async () => {
    if (tall === null) {
      setFeil("Skriv saldoen som et tall, for eksempel 12 345,67.");
      return;
    }
    setLagrer(true);
    setFeil(null);
    try {
      await onLagre(fraVisningsSaldo(konto, tall));
    } catch (e) {
      console.error(e);
      setFeil("Kunne ikke lagre. Prøv igjen.");
    } finally {
      setLagrer(false);
    }
  };

  return (
    <form
      className={styles.felt}
      onSubmit={(e) => {
        e.preventDefault();
        void lagre();
      }}
    >
      <label className={styles.feltEtikett}>
        <span>{etikett}</span>
        <input
          type="text"
          inputMode="decimal"
          value={tekst}
          placeholder="0,00"
          onChange={(e) => setTekst(e.target.value)}
        />
      </label>
      <button type="submit" className={styles.lagre} disabled={lagrer || uendret || !tekst}>
        {lagrer ? "Lagrer…" : "Lagre"}
      </button>
      <span className={styles.hint}>{hint}</span>
      {feil && (
        <span className={styles.feil} role="alert">
          {feil}
        </span>
      )}
    </form>
  );
}

/**
 * Helens avklaring av ignorerte transaksjoner (Kontrolltårnet 6062856860).
 * «Ignorer» har aldri lagret hvorfor, så appen gjetter ikke: hver ignorert
 * linje avklares eksplisitt. Statusen forblir «ignorert»; bare
 * `ignorertSom` legges til.
 */
function AvklarIgnorerte({
  liste,
  onAvklar,
}: {
  liste: TransaksjonRecord[];
  onAvklar: AvstemmingViewProps["onAvklarIgnorert"];
}) {
  const [feil, setFeil] = useState(false);
  const [lagrer, setLagrer] = useState<string | null>(null);
  const avklar = async (id: string, som: IgnorertSom) => {
    setLagrer(id);
    setFeil(false);
    try {
      await onAvklar(id, som);
    } catch (e) {
      console.error(e);
      setFeil(true);
    } finally {
      setLagrer(null);
    }
  };
  return (
    <div className={styles.avklar} role="group" aria-label="Avklar ignorerte transaksjoner">
      <p className={styles.avklarTittel}>Avklar de ignorerte: er de bankbevegelser?</p>
      <ul>
        {liste.map((t) => (
          <li key={t.id} className={styles.avklarRad}>
            <span className={styles.avklarTekst}>
              {datoKort(t.dato)} · {t.tekst} · {t.retning === "inn" ? "+" : "−"}
              {krOre(Math.round(Math.abs(t.belop) * 100))}
            </span>
            <span className={styles.avklarKnapper}>
              <button
                type="button"
                disabled={lagrer === t.id}
                aria-label={`${t.tekst} ${datoKort(t.dato)} er en dublett`}
                onClick={() => void avklar(t.id, "dublett")}
              >
                Dublett
              </button>
              <button
                type="button"
                disabled={lagrer === t.id}
                aria-label={`${t.tekst} ${datoKort(t.dato)} er en ekte bankbevegelse`}
                onClick={() => void avklar(t.id, "bankbevegelse")}
              >
                Ekte bevegelse
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>
        Dublett: samme kjøp er importert to ganger, og telles ikke. Ekte bevegelse: ignorert bare
        for budsjettet, og telles i saldoen.
      </p>
      {feil && (
        <p className={styles.feil} role="alert">
          Kunne ikke lagre avklaringen. Prøv igjen.
        </p>
      )}
    </div>
  );
}

/**
 * Transaksjoner avklart som dublett i måneden, med «Ikke dublett» rett ved
 * (#59, 6097180478). Vises uansett status, så en feilmerking alltid kan
 * rettes, også når måneden ser avstemt ut.
 */
function HoldtUtenfor({
  v,
  alle,
  korrigering,
}: {
  v: KontoMaanedVurdering;
  alle: readonly TransaksjonRecord[];
  korrigering: Korrigeringshandlinger;
}) {
  const liste = v.grunnlag.transaksjoner.filter(
    (t) => t.status === "ignorert" && t.ignorertSom === "dublett",
  );
  return (
    <div
      className={styles.holdtUtenfor}
      role="group"
      aria-label={`Holdt utenfor som dublett i ${maanedNavn(v.maaned, true)}`}
    >
      <p className={styles.avklarTittel}>Holdt utenfor som dublett</p>
      <ul className={styles.korrListe}>
        {liste.map((t) => (
          <KorrigerbarRad key={t.id} t={t} alle={alle} handlinger={korrigering} />
        ))}
      </ul>
    </div>
  );
}

/** Mulige forklaringer på et avvik — data, ikke konklusjoner. */
function Forklaringer({
  v,
  alle,
  korrigering,
}: {
  v: KontoMaanedVurdering;
  alle: readonly TransaksjonRecord[];
  korrigering: Korrigeringshandlinger;
}) {
  const g = v.grunnlag;
  const navn = maanedNavn(v.maaned, true);
  const punkter: { tekst: string; liste: TransaksjonRecord[]; korrigerbar?: boolean }[] = [];
  if (g.dubletter.antall > 0)
    punkter.push({
      tekst: `${g.dubletter.antall} transaksjon${g.dubletter.antall === 1 ? "" : "er"} (${krOre(
        g.dubletter.nettoOre,
      )}) er avklart som dublett og holdt utenfor. Stemmer det? Se «Holdt utenfor som dublett».`,
      liste: [],
    });
  if (g.muligeDubletter.length > 0)
    punkter.push({
      tekst: `${g.muligeDubletter.length} mulig${g.muligeDubletter.length === 1 ? "" : "e"} dublett${
        g.muligeDubletter.length === 1 ? "" : "er"
      }: samme dato, beløp og retning.`,
      liste: g.muligeDubletter.flat(),
      korrigerbar: true,
    });
  if (g.vedMaanedsskiftet.length > 0)
    punkter.push({
      tekst: `${g.vedMaanedsskiftet.length} bevegelse${
        g.vedMaanedsskiftet.length === 1 ? "" : "r"
      } ved månedsskiftet. Banken kan ha bokført dem i en annen måned.`,
      liste: g.vedMaanedsskiftet,
    });
  return (
    <details className={styles.forklaringer}>
      <summary>Mulige forklaringer på avviket i {navn}</summary>
      {punkter.length === 0 ? (
        <p>Ingen åpenbare. Mangler en import for {navn}, eller en transaksjon i en annen konto?</p>
      ) : (
        <ul>
          {punkter.map((p) => (
            <li key={p.tekst}>
              {p.tekst}
              {p.korrigerbar ? (
                <ul className={styles.korrListe}>
                  {p.liste.slice(0, 8).map((t) => (
                    <KorrigerbarRad key={t.id} t={t} alle={alle} handlinger={korrigering} />
                  ))}
                </ul>
              ) : (
                p.liste.length > 0 && (
                  <ul className={styles.transListe}>
                    {p.liste.slice(0, 8).map((t) => (
                      <li key={t.id}>
                        {datoKort(t.dato)} · {t.tekst} · {t.retning === "inn" ? "+" : "−"}
                        {krOre(Math.round(Math.abs(t.belop) * 100))}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
