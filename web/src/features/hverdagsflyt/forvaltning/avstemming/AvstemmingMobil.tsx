import { Link } from "react-router-dom";
import { RoomHeader } from "@components/RoomHeader";
import { type Avstemmingsmodell, maanedsstatus } from "@domain/avstemming/avstemmingsko";
import {
  type KontoMaanedVurdering,
  erGjeldskonto,
  forrigeMaaned,
  sisteDagIMaaned,
} from "@domain/avstemming/saldoavstemming";
import { kontoNavn } from "@domain/forsoning/regelsenter";
import type { TransaksjonRecord } from "@app-types/forsoning";
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
import type { AvklarIgnorert, Korrigeringshandlinger, LagreSaldo } from "./korrigeringTyper";
import { KontoPanel, SamletStatus } from "./KontoPanel";
import { STATUS_TEKST, datoKort, krOre, maanedNavn } from "./avstemmingTekst";
import { problemTekst } from "./problemTekst";

type MobilProps = AvstemmingViewProps & {
  /** Den viste, bekreftede modellen — samme som PC (`medBekreftet`). */
  modell: Avstemmingsmodell;
  maaned: string;
  onVelgMaaned: (m: string) => void;
  visAlle: boolean;
  onVisAlle: (v: boolean) => void;
  /** Siste «Gå til konto, måned» (review 5771685104), eller null. */
  maal: GaaTilMaal | null;
  /** Velger både konto og måned, også når kontoen ikke har eget kort. */
  onGaaTil: (konto: string, maaned: string) => void;
  onLukkMaal: () => void;
};

export interface GaaTilMaal {
  konto: string;
  maaned: string;
  /** Øker ved hvert klikk, så målet får fokus på nytt. */
  nr: number;
}

/**
 * Mobil avstemming (#59, AV-2, 6633102535): kompakt periodevelger, enkel
 * samlet status og korte handlingskort — ett per konto/måned som fortsatt
 * har noe som gjenstår. Kortene leser den samme viste, bekreftede modellen
 * som PC: et kort forsvinner først når lagringen er bekreftet OG den nye
 * vurderingen ikke har noe igjen; delvis løst beholder kortet med resten.
 * Full oversikt (matrise og alle kontokort) med historikk og angring ligger
 * diskret bak «Vis full oversikt».
 */
export function AvstemmingMobil(props: MobilProps) {
  const {
    oversikt,
    modell,
    onLagre,
    onAvklarIgnorert,
    transaksjoner,
    korrigering,
    onVisTidligereAar,
    maaned,
    onVelgMaaned: setMaaned,
    visAlle,
    onVisAlle,
    maal: alleMaal,
    onGaaTil,
    onLukkMaal,
  } = props;
  const rader = modell.rader[maaned] ?? [];
  const status = maanedsstatus(modell, maaned);
  const ukjent = modell.ukjent[maaned];
  const kort = rader.filter((r) => r.problemer.length > 0);
  // «Gå til»: målkontoen vises med historikk og angring åpent og får fokus.
  // Har den ikke eget kort (f.eks. en bankavstemt kildekonto), vises den
  // likevel øverst, så den nødvendige handlingen er rett der.
  const maal = alleMaal && alleMaal.maaned === maaned ? alleMaal : null;
  const maalRad = maal ? rader.find((r) => r.konto === maal.konto) : undefined;
  const maalUtenKort = maalRad && !kort.includes(maalRad) ? maalRad : undefined;
  const aarListe = [...new Set(oversikt.maaneder.map((m) => m.slice(0, 4)))];
  const aar = maaned.slice(0, 4);
  const aaretsMaaneder = oversikt.maaneder.filter((m) => m.startsWith(aar)).reverse();
  const tidligste = aarListe[aarListe.length - 1];
  const handlinger = { onLagre, onAvklarIgnorert, transaksjoner, korrigering };

  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Avstemming"
        description="Saldo per konto, kalendermåned for kalendermåned"
      />

      {oversikt.kontoer.length === 0 && !ukjent ? (
        <p className={styles.tom}>Ingen kontoer med importerte transaksjoner ennå.</p>
      ) : (
        <>
          <div className={styles.periodevelger}>
            <nav className={styles.aarVelger} aria-label="Velg år">
              {aarListe.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={a === aar ? styles.maanedValgt : styles.maanedKnapp}
                  aria-pressed={a === aar}
                  onClick={() =>
                    setMaaned(oversikt.maaneder.find((m) => m.startsWith(a)) ?? maaned)
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
                    setMaaned(`${Number(tidligste) - 1}-12`);
                  }}
                >
                  Vis {Number(tidligste) - 1}
                </button>
              )}
            </nav>
            <label className={styles.maanedVelger}>
              <span>Måned</span>
              <select value={maaned} onChange={(e) => setMaaned(e.target.value)}>
                {[...aaretsMaaneder].reverse().map((m) => (
                  <option key={m} value={m}>
                    {maanedNavn(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <SamletStatus modell={modell} status={status} onVelg={(m) => setMaaned(m)} />

          <section className={styles.ko} aria-label={`Å gjøre i ${maanedNavn(maaned)}`}>
            {ukjent && (
              <div className={styles.advarsel} role="note">
                {problemTekst(ukjent).aarsak}{" "}
                <Link to="/forvaltning/transaksjoner">{problemTekst(ukjent).handling}</Link>
              </div>
            )}
            {maalUtenKort && maal && (
              <KontoPanel
                key={`maal|${maalUtenKort.konto}|${maaned}`}
                {...handlinger}
                kompakt
                rad={maalUtenKort}
                maaned={maaned}
                onVelg={onGaaTil}
                visHistorikk
                fremhev={maal.nr}
                onLukk={onLukkMaal}
              />
            )}
            {kort.length === 0 && !ukjent && !maalUtenKort && (
              <p className={styles.okTekst} role="status">
                Ingenting gjenstår i {maanedNavn(maaned, true)}.
              </p>
            )}
            {kort.map((r) => {
              const erMaal = maal?.konto === r.konto;
              return (
                <KontoPanel
                  key={`${r.konto}|${maaned}`}
                  {...handlinger}
                  kompakt
                  rad={r}
                  maaned={maaned}
                  onVelg={onGaaTil}
                  visHistorikk={erMaal}
                  fremhev={erMaal ? maal.nr : undefined}
                />
              );
            })}
          </section>

          <button
            type="button"
            className={styles.visAlle}
            aria-expanded={visAlle}
            onClick={() => onVisAlle(!visAlle)}
          >
            {visAlle ? "Skjul full oversikt" : "Vis full oversikt og historikk"}
          </button>

          {visAlle && (
            <section className={styles.fullOversikt} aria-label="Full oversikt">
              <Matrise
                oversikt={oversikt}
                maaneder={aaretsMaaneder}
                aar={aar}
                valgt={maaned}
                onVelg={setMaaned}
                statusFor={(k, m) => {
                  const r = modell.rader[m]?.find((x) => x.konto === k);
                  return r ? { status: r.status, lagrer: !!r.lagrer } : undefined;
                }}
              />
              {/* Ukjent konto står allerede øverst i køen, som alltid er synlig. */}
              <h2 className={styles.maanedTittel}>{maanedNavn(maaned)}</h2>
              {rader.map((r) =>
                r.vurdering && oversikt.kontoer.includes(r.konto) ? (
                  <KontoKort
                    key={`${r.konto}-${maaned}`}
                    v={r.vurdering}
                    lagrer={!!r.lagrer}
                    onLagre={onLagre}
                    onAvklarIgnorert={onAvklarIgnorert}
                    alle={transaksjoner}
                    korrigering={korrigering}
                  />
                ) : (
                  <KontoPanel
                    key={`${r.konto}-${maaned}`}
                    {...handlinger}
                    kompakt
                    rad={r}
                    maaned={maaned}
                    onVelg={onGaaTil}
                  />
                ),
              )}
            </section>
          )}
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
  lagrer = false,
}: {
  v: KontoMaanedVurdering;
  /** En skriving som berører kontoen/måneden, er ikke bekreftet ennå (AV-2). */
  lagrer?: boolean;
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
        <span className={styles[`merke_${v.status}`]}>
          {lagrer ? "Lagrer…" : STATUS_TEKST[v.status]}
        </span>
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
