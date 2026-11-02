import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import type { Anledning, Gave, Person } from "@app-types/gaver";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import {
  type Grupper,
  type MottakerOversikt,
  anledningNavn,
  belopTekst,
  budsjettTekst,
  desemberSammenligning,
  gruppeNavn,
  historikk,
  juleoversikt,
  julAnledningId,
  kanLeggesTil,
  lopendeIdeer,
} from "@domain/gaver/gaver";
import type { GaverHandlinger } from "@hooks/useGaver";
import { GaveRad, GaveSkjema } from "./GaveListe";
import { useLagring } from "./lagring";
import { BudsjettFelt, Lagringsmelding } from "./Skjemadeler";
import { type BudsjettUtkast, budsjettUtkast, tilFastBudsjett } from "./budsjettUtkast";
import styles from "./Gaver.module.css";

export interface JulPlanProps {
  aar: number;
  personer: Person[];
  grupper: Grupper;
  anledninger: Anledning[];
  gaver: Gave[];
  budsjett: BudsjettGruppe[];
  handlinger: GaverHandlinger;
}

export function JulPlan(props: JulPlanProps) {
  const { aar, personer, anledninger, handlinger } = props;
  const anledning = anledninger.find((a) => a.id === julAnledningId(aar));
  const l = useLagring();

  if (!anledning) {
    const aktive = personer.filter((p) => !p.arkivert).length;
    return (
      <Card>
        <div className={styles.kort}>
          <h2 className={styles.kortTittel}>Juleplanlegging {aar} er ikke startet</h2>
          <p className={styles.tekst}>
            Når du starter, lages årets liste over mottakere fra personregisteret: alle som ikke er
            arkivert og er med i jul (fra gruppen eller eget valg), med budsjettet de arver. Du kan
            legge til og fjerne mottakere etterpå, og endringer i registeret senere endrer ikke
            årets liste av seg selv.
          </p>
          {aktive === 0 && (
            <p className={styles.dempet}>
              Personregisteret er tomt. Du kan starte nå og legge til mottakere etterpå, eller
              registrere personer først under «Personer».
            </p>
          )}
          <Lagringsmelding {...l} />
          <div>
            <Button loading={l.lagrer} onClick={() => void l.kjor(() => handlinger.startJul(aar))}>
              Start juleplanlegging {aar}
            </Button>
          </div>
        </div>
      </Card>
    );
  }
  return <StartetPlan {...props} anledning={anledning} />;
}

function StartetPlan({
  anledning,
  personer,
  grupper,
  anledninger,
  gaver,
  budsjett,
  handlinger,
}: JulPlanProps & { anledning: Anledning }) {
  const o = juleoversikt(anledning, personer, gaver);
  const sammenligning = desemberSammenligning(budsjett);
  const { foreslatt, ovrige } = kanLeggesTil(anledning, personer, grupper);
  const navn = anledningNavn(anledning);

  return (
    <div className={styles.seksjon}>
      <Card>
        <div className={styles.kort}>
          <h2 className={styles.kortTittel}>{navn}: oversikt</h2>
          <dl className={styles.nokkeltall}>
            <div>
              <dt>Mottakere</dt>
              <dd>{o.mottakere.length}</dd>
            </div>
            <div>
              <dt>Ferdig</dt>
              <dd>{o.antallFerdig}</dd>
            </div>
            <div>
              <dt>Mangler gave</dt>
              <dd>{o.antallMangler}</dd>
            </div>
          </dl>
          <dl className={styles.nokkeltall} style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <dt>Planlagt budsjett</dt>
              <dd>
                {o.mottakere.length > 0 && o.antallUtenBudsjett === o.mottakere.length
                  ? "Ikke satt"
                  : belopTekst(o.budsjettOre)}
              </dd>
            </div>
            <div>
              <dt>Planlagt for gaver</dt>
              <dd>{belopTekst(o.planlagtOre)}</dd>
            </div>
          </dl>
          <p className={styles.dempet}>
            «Planlagt budsjett» er summen av mottakernes budsjett
            {o.antallUtenBudsjett > 0 && ` (${o.antallUtenBudsjett} uten budsjett er ikke med)`}.
            «Planlagt for gaver» er summen av valgte ideer, kjøpte og gitte gaver
            {o.iPlanenUtenBelop > 0 && ` (${o.iPlanenUtenBelop} uten beløp er ikke med)`}. Ideer som
            ikke er valgt, er alternativer og telles ikke
            {o.alternativer > 0 && ` (${o.alternativer} nå)`}. En idé teller ikke som kjøpt. Dette
            er plan; faktisk kostnad føres i økonomien som før og vises ikke her.
          </p>
          {sammenligning.length > 0 && (
            <div className={styles.sammenligning}>
              <p className={styles.dempet}>
                <strong>Fra budsjettet i Økonomi, desember — bare til sammenligning.</strong>{" "}
                Postene fordeles ikke på mottakere og er ikke med i summene over.
              </p>
              <ul className={styles.liste}>
                {sammenligning.map((p) => (
                  <li key={p.id} className={styles.rad}>
                    <span className={styles.tekst}>{p.navn}</span>
                    <span className={styles.tall}>{belopTekst(p.budsjettOre)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      {o.mottakere.length === 0 && (
        <p className={styles.tom}>Ingen mottakere på årets liste ennå. Legg til under.</p>
      )}
      <div className={styles.mottakere}>
        {o.mottakere.map((m) => (
          <MottakerKort
            key={m.personId}
            m={m}
            anledning={anledning}
            anledninger={anledninger}
            gaver={gaver}
            handlinger={handlinger}
          />
        ))}
      </div>

      {(foreslatt.length > 0 || ovrige.length > 0) && (
        <Card variant="neutral">
          <div className={styles.kort}>
            <h2 className={styles.kortTittel}>Legg til mottakere</h2>
            {foreslatt.length > 0 && (
              <>
                <p className={styles.dempet}>
                  Med i jul etter registeret, men ikke på årets liste (for eksempel lagt til etter
                  at planleggingen startet):
                </p>
                <ul className={styles.liste}>
                  {foreslatt.map((p) => (
                    <LeggTilRad key={p.id} p={p} anledning={anledning} handlinger={handlinger} />
                  ))}
                </ul>
              </>
            )}
            {ovrige.length > 0 && (
              <details>
                <summary className={styles.dempet}>Andre personer ({ovrige.length})</summary>
                <ul className={styles.liste}>
                  {ovrige.map((p) => (
                    <LeggTilRad key={p.id} p={p} anledning={anledning} handlinger={handlinger} />
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Card>
      )}

      {o.fjernede.length > 0 && (
        <Card variant="neutral">
          <div className={styles.kort}>
            <h2 className={styles.kortTittel}>Fjernet fra årets liste</h2>
            <p className={styles.dempet}>
              Gavene er beholdt, men telles ikke i oversikten. Legg personen tilbake for å ta dem
              med igjen.
            </p>
            <ul className={styles.liste}>
              {o.fjernede.map((m) => (
                <FjernetRad
                  key={m.personId}
                  m={m}
                  anledning={anledning}
                  personer={personer}
                  handlinger={handlinger}
                />
              ))}
            </ul>
          </div>
        </Card>
      )}

      {o.utenforListen.length > 0 && (
        <Card variant="neutral">
          <div className={styles.kort}>
            <h2 className={styles.kortTittel}>Gaver for personer som ikke er på listen</h2>
            <p className={styles.dempet}>Disse telles ikke i oversikten.</p>
            {o.utenforListen.map((m) => (
              <div key={m.personId}>
                <strong className={styles.tekst}>{m.navn}</strong>
                <ul className={styles.liste}>
                  {m.gaver.map((g) => (
                    <GaveRad key={g.id} gave={g} handlinger={handlinger} kunLesing />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function LeggTilRad({
  p,
  anledning,
  handlinger,
}: {
  p: Person;
  anledning: Anledning;
  handlinger: GaverHandlinger;
}) {
  const l = useLagring();
  return (
    <li className={styles.rad}>
      <div className={styles.radTekst}>
        <strong>{p.navn}</strong>
        <span className={styles.dempet}>{gruppeNavn(p.gruppe)}</span>
      </div>
      <button
        type="button"
        className={styles.tekstKnapp}
        disabled={l.lagrer}
        onClick={() => void l.kjor(() => handlinger.leggTilMottaker(anledning, p))}
        aria-label={`Legg til ${p.navn}`}
      >
        Legg til
      </button>
      <Lagringsmelding {...l} />
    </li>
  );
}

function FjernetRad({
  m,
  anledning,
  personer,
  handlinger,
}: {
  m: MottakerOversikt;
  anledning: Anledning;
  personer: Person[];
  handlinger: GaverHandlinger;
}) {
  const l = useLagring();
  const person = personer.find((p) => p.id === m.personId);
  return (
    <li className={styles.rad}>
      <div className={styles.radTekst}>
        <strong>{m.navn}</strong>
        <span className={styles.dempet}>
          {m.gaver.length === 0 ? "Ingen gaver" : m.gaver.map((g) => g.tekst).join(", ")}
        </span>
      </div>
      {person && (
        <button
          type="button"
          className={styles.tekstKnapp}
          disabled={l.lagrer}
          onClick={() => void l.kjor(() => handlinger.leggTilMottaker(anledning, person))}
          aria-label={`Legg ${m.navn} tilbake`}
        >
          Legg tilbake
        </button>
      )}
      <Lagringsmelding {...l} />
    </li>
  );
}

function MottakerKort({
  m,
  anledning,
  anledninger,
  gaver,
  handlinger,
}: {
  m: MottakerOversikt;
  anledning: Anledning;
  anledninger: Anledning[];
  gaver: Gave[];
  handlinger: GaverHandlinger;
}) {
  const [nyGaveId, setNyGaveId] = useState<string | null>(null);
  const [bekreftFjern, setBekreftFjern] = useState(false);
  const [budsjettAapen, setBudsjettAapen] = useState(false);
  const [budsjett, setBudsjett] = useState<BudsjettUtkast>(budsjettUtkast(m.budsjett));
  // Anledningen slik den var da skjemaet ble åpnet: versjonsvakten for budsjettet.
  const [budsjettGrunn, setBudsjettGrunn] = useState<Anledning>(anledning);
  const [ugyldig, setUgyldig] = useState(false);
  const fjern = useLagring();
  const lagreBudsjett = useLagring();
  const lopende = lopendeIdeer(m.personId, gaver);
  const tidligere = historikk(m.personId, gaver, anledninger, anledning.id);
  const navn = anledningNavn(anledning);

  const lagreB = async () => {
    const b = tilFastBudsjett(budsjett);
    setUgyldig(b === null);
    if (!b) return;
    const ok = await lagreBudsjett.kjor(() =>
      handlinger.settMottakerBudsjett(budsjettGrunn, m.personId, b),
    );
    if (ok) setBudsjettAapen(false);
  };

  return (
    <Card>
      <section className={styles.kort} aria-label={m.navn}>
        <div className={styles.kortHode}>
          <h3 className={styles.kortTittel}>{m.navn}</h3>
          <span className={m.ferdig ? styles.merkeFerdig : styles.merke}>
            {m.ferdig ? "Ferdig" : "Mangler gave"}
          </span>
        </div>
        <p className={styles.dempet}>
          {m.person ? gruppeNavn(m.person.gruppe) : "Ikke i registeret"}
          {m.person?.arkivert && " · arkivert"} · budsjett{" "}
          <span className={styles.tall}>{budsjettTekst(m.budsjett).toLowerCase()}</span> · planlagt{" "}
          <span className={styles.tall}>{belopTekst(m.planlagtOre)}</span>
        </p>

        {budsjettAapen ? (
          <div className={styles.skjema}>
            <BudsjettFelt
              etikett={`Budsjett for ${navn}`}
              verdi={budsjett}
              onChange={setBudsjett}
            />
            {ugyldig && <p className={styles.feil}>Skriv et beløp i kroner, for eksempel 500.</p>}
            <Lagringsmelding
              {...lagreBudsjett}
              onLagreLikevel={() => {
                setBudsjettGrunn(anledning);
                const b = tilFastBudsjett(budsjett);
                if (b)
                  void lagreBudsjett
                    .kjor(() => handlinger.settMottakerBudsjett(anledning, m.personId, b))
                    .then((ok) => ok && setBudsjettAapen(false));
              }}
              onForkast={() => {
                setBudsjett(budsjettUtkast(m.budsjett));
                setBudsjettGrunn(anledning);
                lagreBudsjett.nullstill();
              }}
            />
            <div className={styles.handlinger}>
              <Button size="compact" loading={lagreBudsjett.lagrer} onClick={() => void lagreB()}>
                Lagre budsjett
              </Button>
              <button
                type="button"
                className={styles.tekstKnapp}
                onClick={() => setBudsjettAapen(false)}
              >
                Avbryt
              </button>
            </div>
          </div>
        ) : null}

        {m.gaver.length > 0 ? (
          <ul className={styles.liste} aria-label={`Ideer og gaver til ${m.navn}`}>
            {m.gaver.map((g) => (
              <GaveRad key={g.id} gave={g} handlinger={handlinger} />
            ))}
          </ul>
        ) : (
          <p className={styles.dempet}>Ingen ideer eller gaver for {navn} ennå.</p>
        )}

        {nyGaveId !== null ? (
          <GaveSkjema
            id={nyGaveId}
            grunn={null}
            gjeldende={null}
            personId={m.personId}
            anledningId={anledning.id}
            handlinger={handlinger}
            onFerdig={() => setNyGaveId(null)}
          />
        ) : null}

        {lopende.length > 0 && (
          <details>
            <summary className={styles.dempet}>Løpende ideer ({lopende.length})</summary>
            <ul className={styles.liste}>
              {lopende.map((g) => (
                <GaveRad
                  key={g.id}
                  gave={g}
                  handlinger={handlinger}
                  ekstra={{
                    tekst: `Bruk til ${navn}`,
                    utfor: () => handlinger.flyttGave(g, anledning.id),
                  }}
                />
              ))}
            </ul>
          </details>
        )}

        {tidligere.length > 0 && (
          <details>
            <summary className={styles.dempet}>Tidligere gaver</summary>
            <ul className={styles.liste}>
              {tidligere.map((t) => (
                <li key={t.anledning.id} className={styles.rad}>
                  <span className={styles.dempet}>
                    {anledningNavn(t.anledning)}: {t.gaver.map((g) => g.tekst).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {bekreftFjern ? (
          <div className={styles.skjema} role="group" aria-label={`Fjern ${m.navn}`}>
            <p className={styles.tekst}>
              Fjerne {m.navn} fra {navn}?{" "}
              {m.gaver.length > 0
                ? `${m.gaver.length} ${m.gaver.length === 1 ? "gave/idé beholdes" : "gaver/ideer beholdes"} og vises under «Fjernet fra årets liste», men telles ikke.`
                : "Personen er ikke slettet fra registeret."}{" "}
              Du kan legge personen tilbake.
            </p>
            <Lagringsmelding {...fjern} />
            <div className={styles.handlinger}>
              <Button
                size="compact"
                variant="destructive"
                loading={fjern.lagrer}
                onClick={() =>
                  void fjern
                    .kjor(() => handlinger.fjernMottaker(anledning, m.personId))
                    .then((ok) => ok && setBekreftFjern(false))
                }
              >
                Fjern fra årets liste
              </Button>
              <button
                type="button"
                className={styles.tekstKnapp}
                onClick={() => setBekreftFjern(false)}
              >
                Avbryt
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.handlinger}>
            {nyGaveId === null && (
              <Button
                size="compact"
                variant="secondary"
                onClick={() => setNyGaveId(handlinger.nyGaveId())}
              >
                Legg til idé eller gave
              </Button>
            )}
            {!budsjettAapen && (
              <button
                type="button"
                className={styles.tekstKnapp}
                onClick={() => {
                  setBudsjett(budsjettUtkast(m.budsjett));
                  setBudsjettGrunn(anledning);
                  lagreBudsjett.nullstill();
                  setBudsjettAapen(true);
                }}
              >
                Endre budsjett
              </button>
            )}
            <button
              type="button"
              className={styles.tekstKnapp}
              onClick={() => setBekreftFjern(true)}
            >
              Fjern fra årets liste
            </button>
          </div>
        )}
      </section>
    </Card>
  );
}
