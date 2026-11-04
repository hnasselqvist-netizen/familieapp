import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RoomHeader } from "@components/RoomHeader";
import { BRED_FLATE, useMediaQuery } from "@hooks/useMediaQuery";
import {
  type AvstemmingsRad,
  avstemmingsmodell,
  berorteNokler,
  medBekreftet,
} from "@domain/avstemming/avstemmingsko";
import {
  type Avstemmingsoversikt,
  type KontoMaanedVurdering,
  erGjeldskonto,
  forrigeMaaned,
  sisteDagIMaaned,
} from "@domain/avstemming/saldoavstemming";
import { kontoNavn } from "@domain/forsoning/regelsenter";
import { KONTOER } from "@domain/forsoning/transaksjonsoversikt";
import type { TransaksjonRecord } from "@app-types/forsoning";
import styles from "./Avstemming.module.css";
import { AvstemmingPC } from "./AvstemmingPC";
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
import type { AvklarIgnorert, Korrigeringshandlinger, LagreSaldo } from "./korrigeringTyper";
import { SaldoUtkastKontekst, saldoNokkel, useSaldoUtkastLager } from "./saldoUtkast";
import { STATUS_TEKST, datoKort, krOre, maanedNavn } from "./avstemmingTekst";

export interface AvstemmingViewProps {
  oversikt: Avstemmingsoversikt;
  /** Lagrer faktisk saldo med fortegn (MC-gjeld negativ) for konto/måned. */
  onLagre: LagreSaldo;
  /** Helens avklaring av en ignorert transaksjon: dublett eller ekte bankbevegelse. */
  onAvklarIgnorert: AvklarIgnorert;
  /** Alle transaksjoner, for motposter på andre kontoer. */
  transaksjoner: readonly TransaksjonRecord[];
  /** Reversible korrigeringer fra avvikshjelpen (dublett ↔ ekte bevegelse). */
  korrigering: Korrigeringshandlinger;
  /** Viser året før det tidligste (for startsaldo lenger bak). */
  onVisTidligereAar?: () => void;
}

/**
 * Kontoene bankimporten kjenner (`KONTOER`, legacy ~6555) — kilden til
 * «konfigurerte kontoer» (AV-1, 6542342933). De vises på PC selv uten data.
 */
const KONFIGURERTE = KONTOER.filter((k) => k.id !== "alle").map((k) => k.id);

/**
 * Saldoavstemming per konto og kalendermåned (#59). Helens regnestykke:
 * faktisk saldo forrige måned + månedens importerte bevegelser = beregnet
 * saldo, mot faktisk saldo fra banken. Status er utledet (§domain/avstemming)
 * og revurderes når transaksjonene endres; å lagre en saldo gjør aldri noe
 * «avstemt» av seg selv.
 *
 * AV-1 (#59, 6572970205): på bred flate (fra 64rem) vises en kompakt
 * PC-arbeidsflate fra den felles modellen (`avstemmingsko`); mobil er
 * uendret. Valgt måned, valgt konto og saldoutkast ligger her, over
 * valget, så ingenting går tapt når vinduet endrer bredde.
 */
export function AvstemmingView(props: AvstemmingViewProps) {
  const { oversikt, transaksjoner } = props;
  const bred = useMediaQuery(BRED_FLATE);
  const lager = useSaldoUtkastLager();
  const [maaned, setMaaned] = useState(oversikt.maaneder[0] ?? "");
  const [valgtKonto, setValgtKonto] = useState<string | null>(null);
  const modell = useMemo(
    () => avstemmingsmodell(oversikt, transaksjoner, KONFIGURERTE),
    [oversikt, transaksjoner],
  );
  const { venter, sporet } = useVentendeSkrivinger(props);
  // Alle PC-flater viser den sist bekreftede raden mens en skriving som
  // berører den, venter (review 5764883177). Raden fra før skrivingen
  // startet, ligger i `bekreftet` fra forrige render.
  const bekreftet = useRef<Record<string, AvstemmingsRad>>({});
  const vist = medBekreftet(
    modell,
    bekreftet.current,
    (konto, m) =>
      venter(konto, m) ||
      lager.hent(saldoNokkel(konto, m)).lagrer ||
      lager.hent(saldoNokkel(konto, forrigeMaaned(m))).lagrer,
  );
  bekreftet.current = vist.bekreftet;
  return (
    <SaldoUtkastKontekst.Provider value={lager}>
      {bred ? (
        <AvstemmingPC
          {...props}
          {...sporet}
          modell={vist.modell}
          maaned={maaned}
          onVelgMaaned={setMaaned}
          valgtKonto={valgtKonto}
          onVelgKonto={setValgtKonto}
        />
      ) : (
        <AvstemmingMobil {...props} maaned={maaned} onVelgMaaned={setMaaned} />
      )}
    </SaldoUtkastKontekst.Provider>
  );
}

/**
 * Skrivinger som ikke er bekreftet ennå, per konto/måned. Databasen viser en
 * lokal skriving før serveren har bekreftet den; på PC skal ingen rad se
 * løst ut før lagringen er bekreftet (6572970205), så raden viser «Lagrer…»
 * så lenge en skriving som berører den, venter.
 */
function useVentendeSkrivinger({
  transaksjoner,
  onAvklarIgnorert,
  korrigering,
}: AvstemmingViewProps): {
  venter: (konto: string, maaned: string) => boolean;
  sporet: Pick<AvstemmingViewProps, "onAvklarIgnorert" | "korrigering">;
} {
  const [ventende, setVentende] = useState<Record<string, number>>({});
  const endre = useCallback((nokler: string[], d: number) => {
    setVentende((v) => {
      const n = { ...v };
      for (const k of nokler) {
        n[k] = (n[k] ?? 0) + d;
        if (n[k]! <= 0) delete n[k];
      }
      return n;
    });
  }, []);
  const sporet = useMemo(() => {
    // Alle rader skrivingen kan endre, fra grunnlaget FØR skrivingen —
    // også motpostkontoen og -måneden og koblede motparter (5765532045).
    const nokkel = (id: string, ekstra: { konto: string; dato: string }[] = []) =>
      berorteNokler(transaksjoner, id, ekstra);
    const spor =
      <A extends unknown[]>(fn: (...a: A) => Promise<void>, nokler: (...a: A) => string[]) =>
      async (...a: A) => {
        const k = [...new Set(nokler(...a))];
        endre(k, 1);
        try {
          await fn(...a);
        } finally {
          endre(k, -1);
        }
      };
    const k = korrigering;
    return {
      onAvklarIgnorert: spor(onAvklarIgnorert, (id) => nokkel(id)),
      korrigering: {
        merkDublett: spor(k.merkDublett, (id) => nokkel(id)),
        angreDublett: spor(k.angreDublett, (id) => nokkel(id)),
        omklassifiser: spor(k.omklassifiser, (id) => nokkel(id)),
        leggTilMotpost: spor(k.leggTilMotpost, (id, konto, dato) => nokkel(id, [{ konto, dato }])),
        bekreftMotpostPaaNytt: spor(k.bekreftMotpostPaaNytt, (id, konto, dato) =>
          nokkel(id, [{ konto, dato }]),
        ),
        angreMotpost: spor(k.angreMotpost, (id) => nokkel(id)),
        avsluttMotpost: spor(k.avsluttMotpost, (id) => nokkel(id)),
        kobleImportert: spor(k.kobleImportert, (kilde, motpost) => [
          ...nokkel(kilde),
          ...nokkel(motpost),
        ]),
      },
    };
  }, [transaksjoner, onAvklarIgnorert, korrigering, endre]);
  const venter = useCallback(
    (konto: string, maaned: string) => (ventende[saldoNokkel(konto, maaned)] ?? 0) > 0,
    [ventende],
  );
  return { venter, sporet };
}

/** Mobil: uendret i AV-1 (AV-2 tar handlingskøen). */
function AvstemmingMobil({
  oversikt,
  onLagre,
  onAvklarIgnorert,
  transaksjoner,
  korrigering,
  onVisTidligereAar,
  maaned,
  onVelgMaaned: setMaaned,
}: AvstemmingViewProps & { maaned: string; onVelgMaaned: (m: string) => void }) {
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

function KontoKort({
  v,
  onLagre,
  onAvklarIgnorert,
  alle,
  korrigering,
}: {
  v: KontoMaanedVurdering;
  onLagre: LagreSaldo;
  onAvklarIgnorert: AvklarIgnorert;
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
        {grunnlag.avledede.antall > 0 && (
          <Linje
            tekst={`≈ Avledet motpost, ikke bankimportert (${grunnlag.avledede.antall})`}
            verdi={krOre(grunnlag.avledede.nettoOre)}
          />
        )}
        {grunnlag.avledetMedKandidat.length > 0 && (
          <Linje
            tekst={`? Avledet, mulig importert (${grunnlag.avledetMedKandidat.length})`}
            verdi={`${krOre(
              grunnlag.avledetMedKandidat.reduce((s, p) => s + p.nettoOre, 0),
            )} ikke med`}
          />
        )}
        {grunnlag.avledetKildeEndret.length > 0 && (
          <Linje
            tekst={`? Avledet, kilden endret etter bekreftelse (${grunnlag.avledetKildeEndret.length})`}
            verdi="ikke med"
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
          maaned={forrige}
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
        maaned={maaned}
        lagret={v.kontroll ? v.kontroll.faktiskSaldo : null}
        onLagre={(s) => onLagre(konto, maaned, s)}
      />

      {v.status === "avvik" && <Forklaringer v={v} alle={alle} korrigering={korrigering} />}
      {grunnlag.dubletter.antall > 0 && (
        <HoldtUtenfor v={v} alle={alle} korrigering={korrigering} />
      )}
      <UtenMotpost v={v} alle={alle} korrigering={korrigering} />
      <EndretAvledet v={v} alle={alle} korrigering={korrigering} />
      {(grunnlag.avledede.antall > 0 ||
        grunnlag.avledetMedKandidat.length > 0 ||
        grunnlag.avledetKildeEndret.length > 0) && (
        <Avledede v={v} alle={alle} korrigering={korrigering} />
      )}
    </section>
  );
}
