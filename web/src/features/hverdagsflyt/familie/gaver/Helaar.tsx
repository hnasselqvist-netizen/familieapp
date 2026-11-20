import { useId, useRef, useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import type { Anledning, Gave, GaveStatus, Person } from "@app-types/gaver";
import {
  type Grupper,
  STATUS_TEKST,
  statusValg,
  belopTekst,
  fodselsdatoTekst,
  grupperMottakere,
  julAnledningId,
  tolkPlanBelop,
} from "@domain/gaver/gaver";
import { type AnledningsDel, type HelaarsPerson, helaarsoversikt } from "@domain/gaver/helaar";
import type { GaverHandlinger, Registreringsforsok } from "@hooks/useGaver";
import { GaveRad } from "./GaveListe";
import { BudsjettSkjema } from "./JulPlan";
import { budsjettUtkast } from "./budsjettUtkast";
import { useLagring } from "./lagring";
import { Lagringsmelding } from "./Skjemadeler";
import { nokkel, useUtkastLager, useVert } from "./utkast";
import styles from "./Gaver.module.css";

export interface HelaarProps {
  aar: number;
  personer: Person[];
  grupper: Grupper;
  anledninger: Anledning[];
  gaver: Gave[];
  handlinger: GaverHandlinger;
}

/**
 * «Året {aar}» (roadmap Gaver punkt 2): per person bursdag, jul, samlet
 * gaveverdi og gjenstående rom mot personens eget gavebudsjett, pluss
 * eksplisitt etterregistrering av gaver. Ingen gaver opprettes automatisk,
 * og ingenting skrives til økonomien.
 */
export function Helaar({ aar, personer, grupper, anledninger, gaver, handlinger }: HelaarProps) {
  const o = helaarsoversikt(aar, personer, grupper, anledninger, gaver);
  const julStartet = anledninger.some((a) => a.id === julAnledningId(aar));
  return (
    <div className={styles.seksjon}>
      <Card>
        <div className={styles.kort}>
          <h2 className={styles.kortTittel}>Gaver i {aar}</h2>
          <dl className={styles.nokkeltall}>
            <div>
              <dt>Samlet gaveverdi</dt>
              <dd>{belopTekst(o.verdiOre)}</dd>
            </div>
            <div>
              <dt>Kjent budsjett</dt>
              <dd>{belopTekst(o.kjentBudsjettOre)}</dd>
            </div>
            <div>
              <dt>Ukjent budsjett</dt>
              <dd>
                {o.antallUkjentBudsjett} {o.antallUkjentBudsjett === 1 ? "person" : "personer"}
              </dd>
            </div>
          </dl>
          <p className={styles.dempet}>
            Hver person har sitt eget budsjett: fra «Personer» (eget valg eller gruppen), eller fra
            juleplanen og bursdagen når de er startet. Mangler et budsjett, vises det som ukjent,
            ikke som 0. Gaveverdi er kjøpte, gitte og valgte gaver med beløp
            {o.utenBelop > 0 && ` (${o.utenBelop} uten beløp er ikke med)`}. Året avgjøres av
            anledningen, ikke av kjøpsdatoen. Dette er oversikt, ikke regnskap.
          </p>
        </div>
      </Card>

      <Registrering aar={aar} personer={personer} julStartet={julStartet} handlinger={handlinger} />

      {o.personer.length === 0 && (
        <p className={styles.tom}>
          Ingen personer er registrert ennå. Legg dem til under Personer.
        </p>
      )}
      {grupperMottakere(o.personer).map((g) => (
        <section
          key={g.id}
          className={styles.mottakerGruppe}
          aria-labelledby={`helaargruppe-${g.id}`}
        >
          <h2 id={`helaargruppe-${g.id}`} className={styles.seksjonTittel}>
            {g.navn} <span className={styles.dempetInline}>({g.mottakere.length})</span>
          </h2>
          <div className={styles.mottakere}>
            {g.mottakere.map((p) => (
              <PersonKort key={p.personId} p={p} aar={aar} handlinger={handlinger} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function delBudsjettTekst(d: AnledningsDel): string {
  if (!d.med) return "ikke med i budsjettet";
  if (d.budsjett.type !== "belop") return "budsjett ukjent";
  return `av ${belopTekst(d.budsjett.belopOre)}`;
}

const utenBelopTekst = (n: number) => (n > 0 ? ` + ${n} uten beløp` : "");

function RomVerdi({ p }: { p: HelaarsPerson }) {
  if (p.budsjett.type === "ingen") return <>Ikke med</>;
  if (p.budsjett.type === "ukjent") {
    return (
      <>
        Ukjent
        <span className={styles.dempetInline}>
          mangler budsjett for {p.budsjett.mangler.join(" og ")}
        </span>
      </>
    );
  }
  const rom = p.romOre ?? 0;
  return <>{rom < 0 ? `${belopTekst(-rom)} over` : belopTekst(rom)}</>;
}

function PersonKort({
  p,
  aar,
  handlinger,
}: {
  p: HelaarsPerson;
  aar: number;
  handlinger: GaverHandlinger;
}) {
  const lager = useUtkastLager();
  const bAnl = p.bursdag.anledning;
  const nBudsjett = bAnl && bAnl.mottakere[p.personId] ? nokkel.budsjett(bAnl.id, p.personId) : "";
  useVert(nBudsjett);
  const budsjettAapen = nBudsjett !== "" && lager.poster.has(nBudsjett);
  const fullfor = useLagring();
  // Gaven ble lagret, men bursdagen ikke (feil i registreringens andre steg).
  const bursdagMangler = !bAnl && p.bursdag.gaver.length > 0 && p.person !== null;
  const fd = fodselsdatoTekst(p.person?.fodselsdato);
  const info = [
    fd && `Bursdag ${fd}`,
    p.person?.arkivert && "arkivert",
    !p.person && "Ikke i registeret",
  ].filter(Boolean);

  return (
    <Card>
      <section className={styles.kort} aria-label={p.navn}>
        <h3 className={styles.kortTittel}>{p.navn}</h3>
        {info.length > 0 && <p className={styles.dempet}>{info.join(" · ")}</p>}
        <dl className={styles.helaarTall}>
          <div>
            <dt>Bursdag {aar}</dt>
            <dd>
              {belopTekst(p.bursdag.verdiOre)}
              {utenBelopTekst(p.bursdag.utenBelop)}
              <span className={styles.dempetInline}>{delBudsjettTekst(p.bursdag)}</span>
            </dd>
          </div>
          <div>
            <dt>Jul {aar}</dt>
            <dd>
              {belopTekst(p.jul.verdiOre)}
              {utenBelopTekst(p.jul.utenBelop)}
              <span className={styles.dempetInline}>
                {delBudsjettTekst(p.jul)}
                {!p.jul.anledning && p.jul.med && " (plan ikke startet)"}
              </span>
            </dd>
          </div>
          <div>
            <dt>Samlet gaveverdi</dt>
            <dd>
              {belopTekst(p.verdiOre)}
              {utenBelopTekst(p.utenBelop)}
            </dd>
          </div>
          <div>
            <dt>Igjen av budsjett</dt>
            <dd>
              <RomVerdi p={p} />
            </dd>
          </div>
        </dl>

        {p.bursdag.gaver.length > 0 && (
          <ul className={styles.liste} aria-label={`Bursdagsgaver til ${p.navn}`}>
            {p.bursdag.gaver.map((g) => (
              <GaveRad key={g.id} gave={g} handlinger={handlinger} belopEtikett="Beløp" />
            ))}
          </ul>
        )}
        {p.jul.gaver.length > 0 && (
          <p className={styles.dempet}>
            {p.jul.gaver.length} {p.jul.gaver.length === 1 ? "idé eller gave" : "ideer og gaver"}{" "}
            til jul {aar} — se «Jul {aar}».
          </p>
        )}

        {bursdagMangler && (
          <div className={styles.seksjon}>
            <p className={styles.dempet}>
              Bursdag {aar} er ikke ferdig lagret. Gavene teller, og budsjettet følger «Personer»
              til bursdagen er lagret.
            </p>
            <div className={styles.handlinger}>
              <Button
                size="compact"
                variant="secondary"
                loading={fullfor.lagrer}
                onClick={() => void fullfor.kjor(() => handlinger.fullforBursdag(p.personId, aar))}
              >
                Fullfør bursdag {aar}
              </Button>
            </div>
            <Lagringsmelding {...fullfor} />
          </div>
        )}
        {budsjettAapen && bAnl ? (
          <BudsjettSkjema nokkel={nBudsjett} anledning={bAnl} handlinger={handlinger} />
        ) : (
          nBudsjett !== "" &&
          bAnl && (
            <div className={styles.handlinger}>
              <button
                type="button"
                className={styles.tekstKnapp}
                onClick={() =>
                  lager.sett(nBudsjett, {
                    art: "budsjett",
                    personId: p.personId,
                    grunn: bAnl,
                    felt: budsjettUtkast(bAnl.mottakere[p.personId]!.budsjett),
                  })
                }
              >
                Endre budsjett for bursdag {aar}
              </button>
            </div>
          )
        )}
      </section>
    </Card>
  );
}

interface RegFelt {
  personId: string;
  anledning: "bursdag" | "jul";
  tekst: string;
  belop: string;
  status: GaveStatus;
  kjopsdato: string;
}

const tomtSkjema: RegFelt = {
  personId: "",
  anledning: "bursdag",
  tekst: "",
  belop: "",
  status: "gitt",
  kjopsdato: "",
};

/** Skjemaet som utkast til en registrering (sammenlignes med et frosset forsøk). */
const somUtkast = (felt: RegFelt, ore: number | undefined) => ({
  personId: felt.personId,
  tekst: felt.tekst,
  status: felt.status,
  planlagtOre: ore,
  kjopsdato: felt.kjopsdato,
});

/**
 * Eksplisitt etterregistrering av en gave (typisk en bursdagsgave som
 * allerede er gitt). Skjemaet har én gave-id per åpning, så en retry av
 * samme registrering ikke gir duplikat; er den lagrede posten endret,
 * gir det konflikt og utkastet beholdes.
 *
 * Et sendt forsøk fryses (review 5984223179): får det ukjent utfall, eller
 * gjenstår bursdagen, sender «Lagre» og «Fullfør bursdag» nøyaktig det
 * samme forsøket — samme gave, samme bursdag og budsjettøyeblikksbilde,
 * samme innlogging — selv om skjemaet eller registeret er endret. Endringer
 * i skjemaet blir stående som utkast.
 */
function Registrering({
  aar,
  personer,
  julStartet,
  handlinger,
}: {
  aar: number;
  personer: Person[];
  julStartet: boolean;
  handlinger: GaverHandlinger;
}) {
  const feltId = useId();
  const l = useLagring();
  const [apen, setApen] = useState(false);
  const [gaveId, setGaveId] = useState("");
  const [felt, setFelt] = useState<RegFelt>(tomtSkjema);
  const [visFeil, setVisFeil] = useState(false);
  const [kvittering, setKvittering] = useState<string | null>(null);
  /** Gaven er lagret, bursdagen gjenstår (review 5821211956). */
  const [delvis, setDelvis] = useState<{
    personId: string;
    tekst: string;
    /** Bursdagen ble sendt uten svar: den kan være lagret eller ikke (#20 7021325054). */
    ukjent: boolean;
  } | null>(null);
  const fullfor = useLagring();
  /** Det sendte, frosne forsøket mens utfallet er uavklart eller bursdagen gjenstår. */
  const [forsok, setForsok] = useState<Registreringsforsok | null>(null);
  const forsokRef = useRef<Registreringsforsok | null>(null);
  const settForsok = (f: Registreringsforsok | null) => {
    forsokRef.current = f;
    setForsok(f);
  };
  /** Forsøket er lagret, men skjemaet ble endret mens det var uavklart. */
  const [lagretMedAvvik, setLagretMedAvvik] = useState<string | null>(null);
  const feltRef = useRef(felt);
  feltRef.current = felt;
  const sett = (endring: Partial<RegFelt>) => setFelt((f) => ({ ...f, ...endring }));

  const valgbare = personer
    .filter((p) => !p.arkivert)
    .sort((a, b) => a.navn.localeCompare(b.navn, "nb") || a.id.localeCompare(b.id));
  const anledningNavn = (a: RegFelt["anledning"]) => (a === "bursdag" ? "Bursdag" : "Jul");

  const apne = () => {
    setGaveId(handlinger.nyGaveId());
    setFelt(tomtSkjema);
    setVisFeil(false);
    setKvittering(null);
    setDelvis(null);
    settForsok(null);
    setLagretMedAvvik(null);
    l.nullstill();
    fullfor.nullstill();
    setApen(true);
  };

  const ore = tolkPlanBelop(felt.belop);
  const ugyldig = !felt.personId
    ? "Velg hvem gaven er til."
    : !felt.tekst.trim()
      ? "Skriv hva gaven er."
      : ore === null
        ? "Skriv beløpet i kroner, for eksempel 350, eller la feltet stå tomt."
        : felt.anledning === "jul" && !julStartet
          ? `Start juleplanleggingen for ${aar} under «Jul ${aar}» først.`
          : null;

  /** Skjemaet avviker fra det frosne forsøket (det som faktisk sendes ved nytt forsøk). */
  const avviker = (f: Registreringsforsok, x: RegFelt) => {
    const u = somUtkast(x, tolkPlanBelop(x.belop) ?? undefined);
    const nokkel_ = (v: {
      personId: string;
      tekst: string;
      status: string;
      planlagtOre?: number | undefined;
      kjopsdato?: string | undefined;
    }) => JSON.stringify([v.personId, v.tekst, v.status, v.planlagtOre ?? null, v.kjopsdato]);
    return x.anledning !== f.anledningValg.type || nokkel_(u) !== nokkel_(f.utkast);
  };

  const lagre = async () => {
    setVisFeil(true);
    const frosset = forsokRef.current;
    if (!frosset && (ugyldig || ore === null)) return;
    let gjenstar: { ukjent: boolean } | null = null;
    let sendt: Registreringsforsok | null = null;
    const ok = await l.kjor(async () => {
      const f =
        frosset ??
        handlinger.lagRegistrering(
          gaveId,
          {
            personId: felt.personId,
            tekst: felt.tekst,
            status: felt.status,
            planlagtOre: ore ?? undefined,
            kjopsdato: felt.kjopsdato,
          },
          { type: felt.anledning, aar },
        );
      sendt = f;
      try {
        await handlinger.sendRegistrering(f);
      } catch (e) {
        const navn = e instanceof Error ? e.name : "";
        // Gaven er lagret; bare bursdagen gjenstår. Ingen ny registrering.
        if (navn === "AnledningGjenstar") {
          settForsok(f);
          gjenstar = { ukjent: (e as Error & { ukjent?: boolean }).ukjent === true };
          return;
        }
        // Uavklart: det samme forsøket sendes ved neste «Lagre». Var et
        // tidligere forsøk uavklart, er det fortsatt det — også ved konflikt
        // (`tidligereUkjent`) eller stopp ved byttet innlogging — og det
        // frosne forsøket med sin opprinnelige innlogging beholdes
        // (review 5984516377). Bare et første forsøk med avgjort utfall
        // slippes, så neste «Lagre» bygger fra skjemaet.
        settForsok(navn === "UkjentSkriveUtfall" || frosset ? f : null);
        throw e;
      }
    });
    const f = sendt as Registreringsforsok | null;
    if (ok && gjenstar && f) {
      setDelvis({
        personId: f.utkast.personId,
        tekst: f.utkast.tekst.trim(),
        ukjent: (gjenstar as { ukjent: boolean }).ukjent,
      });
      return;
    }
    if (ok && f) {
      settForsok(null);
      // Et sent svar skal ikke ta med seg et endret utkast (review 5984223179).
      if (avviker(f, feltRef.current)) {
        setLagretMedAvvik(f.utkast.tekst.trim());
        return;
      }
      ferdig(f.utkast.personId, f.utkast.tekst.trim(), f.anledningValg.type);
    }
  };

  const ferdig = (personId: string, tekst: string, anledning: RegFelt["anledning"]) => {
    const navn = personer.find((p) => p.id === personId)?.navn ?? "";
    setKvittering(`Registrert: ${tekst} til ${navn} (${anledningNavn(anledning)} ${aar}).`);
    setDelvis(null);
    settForsok(null);
    setLagretMedAvvik(null);
    setApen(false);
  };

  const fullforBursdag = async () => {
    const f = forsokRef.current;
    if (!delvis || !f) return;
    // Det frosne forsøket: samme bursdag og budsjettøyeblikksbilde, samme innlogging.
    const ok = await fullfor.kjor(() => handlinger.fullforRegistrering(f));
    // Et utkast endret mens forsøket var uavklart, skal ikke forsvinne (review 5984516377).
    if (ok && avviker(f, feltRef.current)) {
      setDelvis(null);
      settForsok(null);
      setLagretMedAvvik(f.utkast.tekst.trim());
      return;
    }
    if (ok) ferdig(delvis.personId, delvis.tekst, "bursdag");
  };

  if (!apen) {
    return (
      <div className={styles.seksjon}>
        <div className={styles.handlinger}>
          <Button size="compact" onClick={apne}>
            Registrer gave
          </Button>
        </div>
        {kvittering && (
          <p className={styles.dempet} role="status">
            {kvittering}
          </p>
        )}
      </div>
    );
  }

  if (delvis) {
    // Gaven er lagret: bare fullføring av bursdagen, aldri en ny registrering.
    return (
      <Card>
        <section className={styles.skjema} aria-label="Registrer gave">
          <div className={styles.feil} role="alert">
            {delvis.ukjent ? (
              <p className={styles.tekst}>
                <strong>Gaven er lagret. Vi vet ikke om bursdagen ble lagret.</strong> «
                {delvis.tekst}» er registrert, men svaret for bursdag {aar} uteble. «Fullfør
                bursdag» oppretter den bare hvis den mangler; ikke registrer gaven på nytt.
              </p>
            ) : (
              <p className={styles.tekst}>
                <strong>Gaven er lagret. Bursdagen gjenstår.</strong> «{delvis.tekst}» er
                registrert, men bursdag {aar} ble ikke lagret. Fullfør bursdagen her; ikke registrer
                gaven på nytt.
              </p>
            )}
          </div>
          {forsok && avviker(forsok, felt) && (
            <p className={styles.dempet}>
              Endringene i skjemaet er ikke lagret. De står igjen etter at bursdagen er fullført.
            </p>
          )}
          <Lagringsmelding {...fullfor} />
          <div className={styles.handlinger}>
            <Button size="compact" loading={fullfor.lagrer} onClick={() => void fullforBursdag()}>
              Fullfør bursdag {aar}
            </Button>
            <button type="button" className={styles.tekstKnapp} onClick={() => setApen(false)}>
              Lukk
            </button>
          </div>
          <p className={styles.dempet}>
            Lukker du nå, teller gaven likevel, og bursdagen kan fullføres fra personens kort.
          </p>
        </section>
      </Card>
    );
  }

  return (
    <Card>
      <form
        className={styles.skjema}
        aria-label="Registrer gave"
        onSubmit={(e) => {
          e.preventDefault();
          void lagre();
        }}
      >
        <p className={styles.dempet}>
          For gaver som allerede er kjøpt eller gitt, for eksempel bursdagsgaver tidligere i år.
          Anledningen avgjør hvilket år gaven teller i; kjøpsdatoen er bare til informasjon.
        </p>
        <div className={styles.rutenett}>
          <div className={styles.felt}>
            <label htmlFor={`${feltId}-person`}>Mottaker</label>
            <select
              id={`${feltId}-person`}
              className={styles.select}
              value={felt.personId}
              onChange={(e) => sett({ personId: e.target.value })}
            >
              <option value="">Velg person</option>
              {valgbare.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.navn}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.felt}>
            <label htmlFor={`${feltId}-anledning`}>Anledning</label>
            <select
              id={`${feltId}-anledning`}
              className={styles.select}
              value={felt.anledning}
              onChange={(e) => sett({ anledning: e.target.value as RegFelt["anledning"] })}
            >
              <option value="bursdag">Bursdag {aar}</option>
              <option value="jul">
                Jul {aar}
                {!julStartet && " (ikke startet)"}
              </option>
            </select>
          </div>
          <div className={styles.felt}>
            <label htmlFor={`${feltId}-tekst`}>Gave</label>
            <input
              id={`${feltId}-tekst`}
              className={styles.input}
              value={felt.tekst}
              onChange={(e) => sett({ tekst: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className={styles.felt}>
            <label htmlFor={`${feltId}-belop`}>Beløp (valgfritt)</label>
            <input
              id={`${feltId}-belop`}
              className={`${styles.input} ${styles.belopInput}`}
              inputMode="decimal"
              placeholder="kr"
              value={felt.belop}
              onChange={(e) => sett({ belop: e.target.value })}
            />
          </div>
          <div className={styles.felt}>
            <label htmlFor={`${feltId}-status`}>Status</label>
            <select
              id={`${feltId}-status`}
              className={styles.select}
              value={felt.status}
              onChange={(e) => sett({ status: e.target.value as GaveStatus })}
            >
              {statusValg().map((s) => (
                <option key={s} value={s}>
                  {STATUS_TEKST[s]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.felt}>
            <label htmlFor={`${feltId}-kjopsdato`}>Kjøpsdato (valgfritt)</label>
            <input
              id={`${feltId}-kjopsdato`}
              type="date"
              className={styles.input}
              value={felt.kjopsdato}
              onChange={(e) => sett({ kjopsdato: e.target.value })}
            />
          </div>
        </div>
        {visFeil && !forsok && ugyldig && <p className={styles.feil}>{ugyldig}</p>}
        {forsok && !lagretMedAvvik && avviker(forsok, felt) && (
          <p className={styles.dempet}>
            «Lagre» sender det første forsøket uendret («{forsok.utkast.tekst.trim()}»). Endringene
            dine står i skjemaet, men lagres ikke med det.
          </p>
        )}
        {lagretMedAvvik !== null ? (
          <>
            <div className={styles.feil} role="alert">
              <p className={styles.tekst}>
                «{lagretMedAvvik}» er registrert slik den først ble sendt. Endringene i skjemaet er
                ikke lagret; endre gaven fra personens kort.
              </p>
            </div>
            <div className={styles.handlinger}>
              <button type="button" className={styles.tekstKnapp} onClick={() => setApen(false)}>
                Lukk
              </button>
            </div>
          </>
        ) : (
          <>
            <Lagringsmelding {...l} onForkast={() => setApen(false)} />
            <div className={styles.handlinger}>
              <Button size="compact" loading={l.lagrer} onClick={() => void lagre()}>
                Lagre
              </Button>
              <button type="button" className={styles.tekstKnapp} onClick={() => setApen(false)}>
                Avbryt
              </button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}
