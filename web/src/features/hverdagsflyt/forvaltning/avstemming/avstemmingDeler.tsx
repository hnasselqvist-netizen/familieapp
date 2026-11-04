import { useEffect, useRef, useState } from "react";
import {
  type AvledetPost,
  type Avstemmingsoversikt,
  type KontoMaanedVurdering,
  type KontrollStatus,
  forrigeMaaned,
  fraVisningsSaldo,
  muligeKilderForMotpost,
  tilVisningsSaldo,
} from "@domain/avstemming/saldoavstemming";
import {
  erInternOverforing,
  vurderAvslutningForventet,
  vurderKoblingTilImportert,
} from "@domain/avstemming/saldokorrigering";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import { kontoNavn } from "@domain/forsoning/regelsenter";
import type { IgnorertSom, TransaksjonRecord } from "@app-types/forsoning";
import styles from "./Avstemming.module.css";
import { KorrigerbarRad } from "./KorrigerbarRad";
import type { AvklarIgnorert, Korrigeringshandlinger } from "./korrigeringTyper";
import { saldoNokkel, useSaldoUtkast } from "./saldoUtkast";
import {
  STATUS_SYMBOL,
  STATUS_TEKST,
  datoKort,
  differanseTekst,
  krOre,
  kortMaaned,
  maanedNavn,
  parseSaldo,
} from "./avstemmingTekst";

/**
 * Delene av avstemmingen som PC (AV-1) og mobil viser likt: matrisen,
 * regnestykket, saldofeltet, avklaringen og avvikshjelpen med angring.
 * Flyttet uendret fra `AvstemmingView` (bortsett fra saldoutkastet og
 * cellevalget i matrisen), så begge flatene bruker samme skriveveier.
 */

/** Hvilke kontoer og måneder som er klare — rader per konto, kolonner per måned. */
export function Matrise({
  oversikt,
  maaneder,
  aar,
  valgt,
  onVelg,
  kontoer = oversikt.kontoer,
  statusFor,
  valgtKonto,
  onVelgCelle,
}: {
  oversikt: Avstemmingsoversikt;
  /** Det valgte årets avsluttede måneder, eldste først. */
  maaneder: string[];
  aar: string;
  valgt: string;
  onVelg: (maaned: string) => void;
  /** Radene (standard: oversiktens kontoer). */
  kontoer?: readonly string[];
  /**
   * PC (AV-1): status per celle fra den viste (bekreftede) modellen, så
   * matrisen aldri viser en ubekreftet lokal skriving som løst.
   */
  statusFor?: (
    konto: string,
    maaned: string,
  ) => { status: KontrollStatus; lagrer: boolean } | undefined;
  /** PC (AV-1): valgt konto, og cellene velger både konto og måned. */
  valgtKonto?: string;
  onVelgCelle?: (konto: string, maaned: string) => void;
}) {
  const kolonner = maaneder;
  const ramme = useRef<HTMLDivElement>(null);
  // Med opptil tolv måneder ruller matrisen sidelengs på mobil: hold den
  // valgte måneden synlig uten å rulle selve siden.
  useEffect(() => {
    const r = ramme.current;
    const knapp = r?.querySelector<HTMLElement>("thead [aria-pressed='true']");
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
            {kontoer.map((konto) => (
              <tr key={konto}>
                <th scope="row">{kontoNavn(konto)}</th>
                {kolonner.map((m) => {
                  const vist = statusFor?.(konto, m);
                  const status =
                    vist?.status ?? oversikt.celler[konto]?.[m]?.status ?? "ingen_saldo";
                  const tekst = `${kontoNavn(konto)} ${maanedNavn(m)}: ${STATUS_TEKST[status]}${
                    vist?.lagrer ? " (lagrer)" : ""
                  }`;
                  return (
                    <td key={m} className={styles[`celle_${status}`]}>
                      {onVelgCelle ? (
                        <button
                          type="button"
                          className={styles.celleKnapp}
                          aria-pressed={m === valgt && konto === valgtKonto}
                          onClick={() => onVelgCelle(konto, m)}
                        >
                          <span aria-hidden>{STATUS_SYMBOL[status]}</span>
                          <span className={styles.srOnly}>{tekst}</span>
                        </button>
                      ) : (
                        <>
                          <span aria-hidden>{STATUS_SYMBOL[status]}</span>
                          <span className={styles.srOnly}>{tekst}</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.forklaring}>
        ✓ avstemt · ≈ stemmer med avledet motpost · ≠ avvik · ? usikker · • startpunkt · – mangler
        saldo
      </p>
    </>
  );
}

export function Linje({ tekst, verdi, sterk }: { tekst: string; verdi: string; sterk?: boolean }) {
  return (
    <div className={sterk ? styles.linjeSterk : styles.linje}>
      <dt>{tekst}</dt>
      <dd>{verdi}</dd>
    </div>
  );
}

export function StatusTekst({ v }: { v: KontoMaanedVurdering }) {
  const navn = maanedNavn(v.maaned, true);
  return (
    <div className={styles.statusTekst} role="status">
      {v.status === "avstemt" && <p>Saldoen stemmer med bevegelsene i {navn}.</p>}
      {v.status === "avstemt_avledet" && (
        <p>
          Saldoen stemmer når de avledede motpostene regnes med (
          {krOre(v.grunnlag.avledede.nettoOre)}). De er ikke bankimportert, så {navn} er ikke
          bankverifisert avstemt før de ekte motpostene er importert og koblet.
        </p>
      )}
      {v.status === "avvik" && v.differanseOre !== null && (
        <p className={styles.avvik}>{differanseTekst(v.differanseOre)}.</p>
      )}
      {v.status === "usikker" && v.grunnlag.avledetMedKandidat.length > 0 && (
        <p className={styles.usikker}>
          Usikker: {v.grunnlag.avledetMedKandidat.length} avledet
          {v.grunnlag.avledetMedKandidat.length === 1 ? "" : "e"} motpost
          {v.grunnlag.avledetMedKandidat.length === 1 ? "" : "er"} kan allerede være importert. De
          telles ikke, så ingenting telles to ganger. Koble under «Avledede motposter».
          {v.grunnlag.uavklarte.antall === 0 &&
            v.differanseOre !== null &&
            ` ${differanseTekst(v.differanseOre)}.`}
        </p>
      )}
      {v.status === "usikker" && v.grunnlag.avledetKildeEndret.length > 0 && (
        <p className={styles.usikker}>
          Usikker: kilden til {v.grunnlag.avledetKildeEndret.length} avledet
          {v.grunnlag.avledetKildeEndret.length === 1 ? "" : "e"} motpost
          {v.grunnlag.avledetKildeEndret.length === 1 ? "" : "er"} er endret etter at du bekreftet.
          De telles ikke før du bekrefter på nytt på kildens konto. Saldoen er ikke bankverifisert.
        </p>
      )}
      {v.status === "usikker" &&
        v.grunnlag.uavklarte.antall > 0 &&
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

/**
 * Ett saldofelt. Utkastet, en pågående lagring og en feil ligger i
 * `saldoUtkast` (over valget mellom PC og mobil), så de står ved
 * breddeendring og levende abonnementsendring. Bare en bekreftet lagring
 * fjerner utkastet.
 */
export function SaldoFelt({
  etikett,
  hint,
  konto,
  maaned,
  lagret,
  onLagre,
  onLagret,
  autoFokus,
}: {
  etikett: string;
  hint: string;
  konto: string;
  /** Måneden saldoen gjelder — nøkkelen til utkastet. */
  maaned: string;
  lagret: number | null;
  onLagre: (faktiskSaldo: number) => Promise<void>;
  /** Etter bekreftet lagring (f.eks. videre til neste konto). */
  onLagret?: () => void;
  autoFokus?: boolean;
}) {
  const start = lagret === null ? "" : String(tilVisningsSaldo(konto, lagret)).replace(".", ",");
  const [utkast, settUtkast, lesUtkast] = useSaldoUtkast(saldoNokkel(konto, maaned));
  const tekst = utkast.tekst ?? start;
  const { lagrer, feil } = utkast;
  const tall = parseSaldo(tekst);
  const uendret = tekst === start;
  const felt = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFokus) felt.current?.focus();
  }, [autoFokus]);

  const lagre = async () => {
    if (lagrer) return;
    if (tall === null) {
      settUtkast({ feil: "Skriv saldoen som et tall, for eksempel 12 345,67." });
      return;
    }
    // Feltet kan redigeres mens lagringen venter. Svaret gjelder bare
    // teksten som ble sendt: har brukeren skrevet videre, står den nyere
    // teksten, og vi går ikke videre til neste konto (review 5764883177).
    const sendt = tekst;
    settUtkast({ tekst: sendt, lagrer: true, feil: null });
    try {
      await onLagre(fraVisningsSaldo(konto, tall));
      const skrevetVidere = lesUtkast().tekst !== sendt;
      settUtkast((u) => (u.tekst === sendt ? null : { ...u, lagrer: false }));
      if (!skrevetVidere) onLagret?.();
    } catch (e) {
      console.error(e);
      settUtkast((u) => ({ ...u, lagrer: false, feil: "Kunne ikke lagre. Prøv igjen." }));
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
          ref={felt}
          type="text"
          inputMode="decimal"
          value={tekst}
          placeholder="0,00"
          onChange={(e) => settUtkast({ tekst: e.target.value })}
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
export function AvklarIgnorerte({
  liste,
  onAvklar,
}: {
  liste: TransaksjonRecord[];
  onAvklar: AvklarIgnorert;
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
export function HoldtUtenfor({
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

/**
 * Interne overføringer på kontoen uten koblet motpost (6097196546): her kan
 * Helen gi dem en avledet motpost, eller angre en. Kilden teller på sin
 * egen konto uansett.
 */
export function UtenMotpost({
  v,
  alle,
  korrigering,
}: {
  v: KontoMaanedVurdering;
  alle: readonly TransaksjonRecord[];
  korrigering: Korrigeringshandlinger;
}) {
  const liste = v.grunnlag.transaksjoner.filter(
    (t) => erInternOverforing(t) && !t.motpartTransaksjonId && !vurderAvslutningForventet(t).kan,
  );
  if (liste.length === 0) return null;
  return (
    <div
      className={styles.holdtUtenfor}
      role="group"
      aria-label={`Interne overføringer uten motpost i ${maanedNavn(v.maaned, true)}`}
    >
      <p className={styles.avklarTittel}>Interne overføringer uten motpost</p>
      <ul className={styles.korrListe}>
        {liste.map((t) => (
          <KorrigerbarRad key={t.id} t={t} alle={alle} handlinger={korrigering} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Transaksjoner med en avledet motpost som er endret i Transaksjoner etter
 * at den ble lagt til (#75, Kontrolltårn-review). De kan ikke angres og
 * låser for nye korrigeringer til Helen avslutter dem eksplisitt — derfor
 * vises de her uansett hva de er endret til.
 */
export function EndretAvledet({
  v,
  alle,
  korrigering,
}: {
  v: KontoMaanedVurdering;
  alle: readonly TransaksjonRecord[];
  korrigering: Korrigeringshandlinger;
}) {
  const liste = v.grunnlag.transaksjoner.filter((t) => vurderAvslutningForventet(t).kan);
  if (liste.length === 0) return null;
  return (
    <div
      className={styles.holdtUtenfor}
      role="group"
      aria-label={`Avledet motpost endret siden i ${maanedNavn(v.maaned, true)}`}
    >
      <p className={styles.avklarTittel}>Avledet motpost endret i Transaksjoner</p>
      <ul className={styles.korrListe}>
        {liste.map((t) => (
          <KorrigerbarRad key={t.id} t={t} alle={alle} handlinger={korrigering} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Avledede motposter på mottakerkontoen — tydelig merket som ikke
 * bankimportert, sporbare til kilden, med kobling til en importert motpost.
 */
export function Avledede({
  v,
  alle,
  korrigering,
}: {
  v: KontoMaanedVurdering;
  alle: readonly TransaksjonRecord[];
  korrigering: Korrigeringshandlinger;
}) {
  const poster = [
    ...v.grunnlag.avledede.poster,
    ...v.grunnlag.avledetMedKandidat,
    ...v.grunnlag.avledetKildeEndret,
  ];
  return (
    <div
      className={styles.avledede}
      role="group"
      aria-label={`Avledede motposter i ${maanedNavn(v.maaned, true)}`}
    >
      <p className={styles.avklarTittel}>Avledede motposter (ikke bankimportert)</p>
      <ul className={styles.korrListe}>
        {poster.map((p) => (
          <AvledetRad key={p.kilde.id} p={p} alle={alle} korrigering={korrigering} />
        ))}
      </ul>
      <p className={styles.hint}>
        Regnet ut fra en intern overføring på en annen konto der motposten mangler. Angres på
        kildens konto.
      </p>
    </div>
  );
}

function AvledetRad({
  p,
  alle,
  korrigering,
}: {
  p: AvledetPost;
  alle: readonly TransaksjonRecord[];
  korrigering: Korrigeringshandlinger;
}) {
  const [lagrer, setLagrer] = useState<string | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const koble = async (m: TransaksjonRecord) => {
    const vurdering = vurderKoblingTilImportert(p.kilde, m, alle);
    if (!vurdering.kan) {
      setFeil(vurdering.grunn);
      return;
    }
    setLagrer(m.id);
    setFeil(null);
    try {
      await korrigering.kobleImportert(p.kilde.id, m.id);
    } catch (e) {
      console.error(e);
      setFeil("Kunne ikke koble. Prøv igjen.");
    } finally {
      setLagrer(null);
    }
  };
  const belop = krOre(Math.round(Math.abs(p.kilde.belop) * 100));
  return (
    <li className={styles.korrRad}>
      <span className={styles.korrLinje}>
        <span>
          {datoKort(p.dato)} · {p.retning === "inn" ? "+" : "−"}
          {belop} · fra {kontoNavn(normaliserKonto(p.kilde))}: {p.kilde.tekst}{" "}
          {datoKort(p.kilde.dato)}
        </span>
        <span className={styles.korrTilstand}>
          {p.kildeEndret
            ? `teller ikke: ${p.kildeEndret} Bekreft på nytt på kildens konto.`
            : "avledet, ikke bankimportert"}
        </span>
      </span>
      {p.kandidater.length > 0 && (
        <>
          <span className={styles.korrTilstand}>
            En importert transaksjon kan være den ekte motposten. Den avledede telles ikke før du
            har avklart:
          </span>
          <ul className={styles.korrListe}>
            {p.kandidater.slice(0, 4).map((m) => (
              <li key={m.id} className={styles.korrLinje}>
                <span>
                  {datoKort(m.dato)} · {m.tekst} · {m.retning === "inn" ? "+" : "−"}
                  {krOre(Math.round(Math.abs(m.belop) * 100))}
                </span>
                <span className={styles.korrKnapper}>
                  <button
                    type="button"
                    className={styles.korrKnapp}
                    disabled={lagrer !== null}
                    aria-label={`Koble ${m.tekst} ${datoKort(m.dato)} som motpost til ${p.kilde.tekst}`}
                    onClick={() => void koble(m)}
                  >
                    {lagrer === m.id ? "Kobler…" : "Koble som motpost"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {feil && (
        <span className={styles.feil} role="alert">
          {feil}
        </span>
      )}
    </li>
  );
}

/** Mulige forklaringer på et avvik — data, ikke konklusjoner. */
export function Forklaringer({
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
  const punkter: {
    tekst: string;
    liste: TransaksjonRecord[];
    korrigerbar?: boolean;
    foreslattKonto?: string;
  }[] = [];
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
  const kilder = muligeKilderForMotpost(alle, v.konto, v.maaned);
  if (kilder.length > 0)
    punkter.push({
      tekst: `${kilder.length} intern${kilder.length === 1 ? "" : "e"} overføring${
        kilder.length === 1 ? "" : "er"
      } eller ignorert${kilder.length === 1 ? "" : "e"} bevegelse${
        kilder.length === 1 ? "" : "r"
      } på andre kontoer uten motpost. Mangler en av dem motposten på ${kontoNavn(v.konto)}?`,
      liste: kilder,
      korrigerbar: true,
      foreslattKonto: v.konto,
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
                    <KorrigerbarRad
                      key={t.id}
                      t={t}
                      alle={alle}
                      handlinger={korrigering}
                      foreslattKonto={p.foreslattKonto}
                    />
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
