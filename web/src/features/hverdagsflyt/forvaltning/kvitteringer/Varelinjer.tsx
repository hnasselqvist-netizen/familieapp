import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@components/Button";
import type { KvitteringRecord, Varelinje } from "@app-types/forsoning";
import {
  ARTER,
  type Advarsel,
  advarsler,
  kronerTekst,
  nettoOre,
  parseVarelinjer,
  summer,
} from "@domain/forsoning/varelinjer";
import {
  type Feltfeil,
  type LinjeUtkast,
  erEndret,
  tilLinjer,
  tilUtkast,
  tomLinje,
} from "./varelinjeUtkast";
import styles from "./Varelinjer.module.css";

/** Det vinduet trenger å vite før det kan lukkes. */
export interface VarelinjeStatus {
  /** Utkastet avviker fra linjene det bygger på. */
  ulagret: boolean;
  /** En varelinjelagring er sendt og ikke besvart. */
  lagrer: boolean;
}

export type LagreVarelinjer = (
  receiptId: string,
  linjer: Varelinje[],
  forventetVersjon: number,
) => Promise<unknown>;

const ART_NAVN = Object.fromEntries(ARTER.map((a) => [a.id, a.navn]));

function advarselTekst(a: Advarsel, linjer: readonly Varelinje[]): string {
  const navn = (id: string) => linjer.find((l) => l.id === id)?.tekst || "en linje";
  switch (a.type) {
    case "uten_belop":
      return `${a.antall} ${a.antall === 1 ? "linje mangler" : "linjer mangler"} beløp og er ikke med i summen.`;
    case "avvik_total":
      return `Linjene summerer ${kronerTekst(Math.abs(a.differanseOre))} ${a.differanseOre > 0 ? "under" : "over"} kvitteringens total${a.ufullstendig ? " (noen linjer mangler beløp)" : ""}.`;
    case "mengde_pris":
      return `«${navn(a.linjeId)}»: mengde × enhetspris er ${kronerTekst(a.forventetOre)}, som ikke stemmer med linjebeløpet.`;
    case "rabatt_uten_belop":
      return `«${navn(a.linjeId)}» har rabatt, men mangler linjebeløp.`;
  }
}

/** Summer og advarsler. Advarslene stopper aldri lagring. */
function Oppsummering({ linjer, total }: { linjer: readonly Varelinje[]; total?: number }) {
  if (linjer.length === 0) return null;
  const s = summer(linjer, total);
  const a = advarsler(linjer, total);
  return (
    <>
      <dl className={styles.summer} aria-label="Sum varelinjer">
        <dt>Sum linjer (etter rabatt)</dt>
        <dd>{kronerTekst(s.sumOre)}</dd>
        <dt>Herav varer</dt>
        <dd>{kronerTekst(s.vareOre)}</dd>
        {s.pantReturOre !== 0 && (
          <>
            <dt>Pant, retur og justering</dt>
            <dd>{kronerTekst(s.pantReturOre)}</dd>
          </>
        )}
        {s.rabattOre > 0 && (
          <>
            <dt>Rabatt (trukket fra)</dt>
            <dd>{kronerTekst(s.rabattOre)}</dd>
          </>
        )}
        {s.totalOre !== undefined && (
          <>
            <dt>Kvitteringens total</dt>
            <dd>{kronerTekst(s.totalOre)}</dd>
            <dt>Differanse</dt>
            <dd>{kronerTekst(s.differanseOre ?? 0)}</dd>
          </>
        )}
      </dl>
      {a.length > 0 && (
        <div className={styles.advarsel} role="status">
          Til informasjon, ingenting er stoppet:
          <ul>
            {a.map((x, i) => (
              <li key={i}>{advarselTekst(x, linjer)}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

const Forklaring = () => (
  <p className={styles.dempet}>
    Bare beskrivelse av hva som ble kjøpt. Påvirker ikke økonomien: fordelingen på poster over er
    det som teller.
  </p>
);

function linjeTekst(l: Varelinje): string {
  const deler: string[] = [];
  if (l.art !== "vare") deler.push(ART_NAVN[l.art] ?? l.art);
  if (l.mengde !== undefined)
    deler.push(`${String(l.mengde).replace(".", ",")} ${l.enhet ?? ""}`.trim());
  if (l.enhetsprisOre !== undefined) deler.push(`à ${kronerTekst(l.enhetsprisOre)}`);
  if (l.rabattOre) deler.push(`rabatt ${kronerTekst(l.rabattOre)}`);
  return deler.join(" · ");
}

/** Lesevisning (porten av, eller ingen skrivetilgang). */
export function VarelinjerVisning({ r }: { r: KvitteringRecord }) {
  const linjer = parseVarelinjer(r.varelinjer);
  if (linjer.length === 0) return null;
  return (
    <section className={styles.seksjon} aria-label="Varelinjer">
      <h3 className={styles.tittel}>Varelinjer</h3>
      <Forklaring />
      <ul className={styles.liste}>
        {linjer.map((l) => {
          const n = nettoOre(l);
          return (
            <li key={l.id} className={styles.visLinje}>
              <span className={styles.rad}>
                <span>{l.tekst}</span>
                <span className={styles.tall}>
                  {n === undefined ? "Mangler beløp" : kronerTekst(n)}
                </span>
              </span>
              {linjeTekst(l) && <span className={styles.dempet}>{linjeTekst(l)}</span>}
            </li>
          );
        })}
      </ul>
      <Oppsummering linjer={linjer} total={r.total} />
    </section>
  );
}

const FEIL_LAGRING =
  "Kunne ikke lagre. Sjekk nettforbindelsen og prøv igjen — det du skrev, er tatt vare på.";

/**
 * Registrering og redigering av varelinjer. Eget utkast og egen
 * lagringsknapp, skilt fra «Lagre endringer» for fordelingen. Utkastet
 * beholdes ved feil og konflikt; lagrede linjer erstatter det bare når
 * brukeren ikke har ulagrede endringer.
 */
export function VarelinjerRedigering({
  r,
  lagre,
  nyId = () => crypto.randomUUID(),
  onStatus,
}: {
  r: KvitteringRecord;
  lagre: LagreVarelinjer;
  nyId?: () => string;
  /** Meldes ved hver endring, så vinduet ikke lukker over et ulagret utkast. */
  onStatus?: (s: VarelinjeStatus) => void;
}) {
  const lagret = parseVarelinjer(r.varelinjer);
  const lagretVersjon = r.varelinjerVersjon ?? 0;
  const [utkast, setUtkast] = useState<LinjeUtkast[]>(() => lagret.map(tilUtkast));
  // Linjene og versjonen utkastet bygger på. «Endret» er utkast mot DETTE
  // grunnlaget, ikke mot det som nettopp kom inn fra en annen enhet.
  const [basis, setBasis] = useState<Varelinje[]>(lagret);
  const [grunn, setGrunn] = useState(lagretVersjon);
  const [feltfeil, setFeltfeil] = useState<Record<string, Feltfeil>>({});
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [konflikt, setKonflikt] = useState(false);
  const [ok, setOk] = useState(false);
  const endret = erEndret(utkast, basis);
  const ulagret = useRef(endret);
  ulagret.current = endret;
  const id = useId();
  const meld = useRef(onStatus);
  meld.current = onStatus;
  useEffect(() => {
    meld.current?.({ ulagret: endret, lagrer });
  }, [endret, lagrer]);

  const tilbakestill = (linjer: Varelinje[], versjon: number) => {
    setUtkast(linjer.map(tilUtkast));
    setBasis(linjer);
    setGrunn(versjon);
  };

  // En lagring fra en annen enhet: ta den inn bare hvis brukeren ikke har
  // ulagrede endringer. Ellers står utkastet, og lagring gir konflikt-valg.
  const lagretNokkel = JSON.stringify(lagret);
  useEffect(() => {
    if (!ulagret.current) tilbakestill(parseVarelinjer(r.varelinjer), r.varelinjerVersjon ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lagretNokkel, lagretVersjon]);

  const sett = (lid: string, felt: Partial<LinjeUtkast>) => {
    setOk(false);
    setUtkast((u) => u.map((x) => (x.id === lid ? { ...x, ...felt } : x)));
  };

  const skriv = async (forventet: number) => {
    const t = tilLinjer(utkast);
    if (t.feil) {
      setFeltfeil(t.feil);
      return;
    }
    setFeltfeil({});
    setLagrer(true);
    setFeil(null);
    setKonflikt(false);
    setOk(false);
    try {
      await lagre(r.id, t.linjer, forventet);
      setBasis(t.linjer);
      setGrunn(forventet + 1);
      setOk(true);
    } catch (e) {
      const erKonflikt = e instanceof Error && e.name === "VarelinjerEndret";
      setKonflikt(erKonflikt);
      setFeil(e instanceof Error && e.name !== "Error" && e.message ? e.message : FEIL_LAGRING);
    } finally {
      setLagrer(false);
    }
  };

  const linjerForSum = (() => {
    const t = tilLinjer(utkast);
    return t.linjer ?? lagret;
  })();

  return (
    <section className={styles.seksjon} aria-label="Varelinjer">
      <h3 className={styles.tittel}>Varelinjer</h3>
      <Forklaring />
      {lagretVersjon !== grunn && endret && !konflikt && (
        <p className={styles.dempet} role="status">
          Varelinjene er endret på en annen enhet mens du skrev. Det du skrev, står; når du lagrer,
          får du velge hva som skal gjelde.
        </p>
      )}
      {utkast.length === 0 && (
        <p className={styles.dempet}>Ingen varelinjer registrert. Det er helt valgfritt.</p>
      )}
      <ul className={styles.liste}>
        {utkast.map((u, i) => {
          const f = feltfeil[u.id] ?? {};
          const fid = `${id}-${u.id}`;
          return (
            <li key={u.id}>
              <fieldset className={styles.linje}>
                <legend>
                  Linje {i + 1}
                  {u.tekst ? `: ${u.tekst}` : ""}
                </legend>
                <div className={styles.felter}>
                  <label className={`${styles.felt} ${styles.bred}`} htmlFor={`${fid}-tekst`}>
                    Vare eller tekst
                    <input
                      id={`${fid}-tekst`}
                      className={styles.input}
                      value={u.tekst}
                      onChange={(e) => sett(u.id, { tekst: e.target.value })}
                      autoComplete="off"
                    />
                    {f.tekst && <span className={styles.feltFeil}>{f.tekst}</span>}
                  </label>
                  <label className={styles.felt} htmlFor={`${fid}-art`}>
                    Type
                    <select
                      id={`${fid}-art`}
                      className={styles.select}
                      value={u.art}
                      onChange={(e) => sett(u.id, { art: e.target.value as LinjeUtkast["art"] })}
                    >
                      {ARTER.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.navn}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.felt} htmlFor={`${fid}-belop`}>
                    Linjebeløp før rabatt (kr)
                    <input
                      id={`${fid}-belop`}
                      className={`${styles.input} ${styles.tall}`}
                      inputMode="decimal"
                      value={u.belop}
                      onChange={(e) => sett(u.id, { belop: e.target.value })}
                    />
                    {f.belop && <span className={styles.feltFeil}>{f.belop}</span>}
                  </label>
                  <label className={styles.felt} htmlFor={`${fid}-mengde`}>
                    Mengde (valgfritt)
                    <input
                      id={`${fid}-mengde`}
                      className={`${styles.input} ${styles.tall}`}
                      inputMode="decimal"
                      value={u.mengde}
                      onChange={(e) => sett(u.id, { mengde: e.target.value })}
                    />
                    {f.mengde && <span className={styles.feltFeil}>{f.mengde}</span>}
                  </label>
                  <label className={styles.felt} htmlFor={`${fid}-enhet`}>
                    Enhet (valgfritt)
                    <input
                      id={`${fid}-enhet`}
                      className={styles.input}
                      placeholder="stk, kg, l"
                      value={u.enhet}
                      onChange={(e) => sett(u.id, { enhet: e.target.value })}
                    />
                  </label>
                  <label className={styles.felt} htmlFor={`${fid}-pris`}>
                    Enhetspris (kr, valgfritt)
                    <input
                      id={`${fid}-pris`}
                      className={`${styles.input} ${styles.tall}`}
                      inputMode="decimal"
                      value={u.enhetspris}
                      onChange={(e) => sett(u.id, { enhetspris: e.target.value })}
                    />
                    {f.enhetspris && <span className={styles.feltFeil}>{f.enhetspris}</span>}
                  </label>
                  <label className={styles.felt} htmlFor={`${fid}-rabatt`}>
                    Rabatt (kr, valgfritt)
                    <input
                      id={`${fid}-rabatt`}
                      className={`${styles.input} ${styles.tall}`}
                      inputMode="decimal"
                      value={u.rabatt}
                      onChange={(e) => sett(u.id, { rabatt: e.target.value })}
                    />
                    {f.rabatt && <span className={styles.feltFeil}>{f.rabatt}</span>}
                  </label>
                </div>
                <div className={styles.knapper}>
                  <button
                    type="button"
                    className={styles.knapp}
                    onClick={() => {
                      setOk(false);
                      setUtkast((x) => x.filter((y) => y.id !== u.id));
                    }}
                    aria-label={`Fjern linje ${i + 1}${u.tekst ? ` (${u.tekst})` : ""}`}
                  >
                    Fjern linje
                  </button>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
      <div className={styles.knapper}>
        <button
          type="button"
          className={styles.knapp}
          onClick={() => {
            setOk(false);
            setUtkast((u) => [...u, tomLinje(nyId())]);
          }}
        >
          Legg til varelinje
        </button>
      </div>

      <Oppsummering linjer={linjerForSum} total={r.total} />

      {feil && (
        <div className={styles.feil} role="alert">
          <p className={styles.dempet} style={{ color: "inherit" }}>
            {feil}
          </p>
          {konflikt && (
            <div className={styles.knapper} style={{ marginTop: 8 }}>
              <Button
                variant="secondary"
                size="compact"
                disabled={lagrer}
                onClick={() => void skriv(lagretVersjon)}
              >
                Lagre min versjon likevel
              </Button>
              <button
                type="button"
                className={styles.knapp}
                onClick={() => {
                  tilbakestill(lagret, lagretVersjon);
                  setFeil(null);
                  setKonflikt(false);
                }}
              >
                Forkast det jeg skrev
              </button>
            </div>
          )}
        </div>
      )}
      {ok && !endret && (
        <p className={styles.ok} role="status">
          Varelinjene er lagret.
        </p>
      )}
      <div className={styles.knapper}>
        <Button
          size="compact"
          loading={lagrer}
          disabled={!endret}
          onClick={() => void skriv(grunn)}
        >
          Lagre varelinjer
        </Button>
        {endret && (
          <button
            type="button"
            className={styles.knapp}
            disabled={lagrer}
            onClick={() => {
              tilbakestill(lagret, lagretVersjon);
              setFeltfeil({});
              setFeil(null);
              setKonflikt(false);
            }}
          >
            Angre endringene
          </button>
        )}
      </div>
    </section>
  );
}
