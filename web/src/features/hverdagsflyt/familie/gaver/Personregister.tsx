import { useId, useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import {
  type Anledning,
  type Gave,
  type Gruppe,
  type GruppeId,
  type GruppeStandard,
  type Person,
  type PersonUnntak,
  GRUPPER,
} from "@app-types/gaver";
import {
  budsjettTekst,
  effektivStandard,
  fodselsdatoTekst,
  gruppeNavn,
  julAnledningId,
  lopendeIdeer,
  tolkFodselsdato,
  type Grupper,
} from "@domain/gaver/gaver";
import { GaveRad, GaveSkjema } from "./GaveListe";
import { apneGave, apnePerson, personFelt } from "./apne";
import type { GaverHandlinger, PersonUtkast } from "@hooks/useGaver";
import { julTekst } from "./julTekst";
import { useLagring } from "./lagring";
import { type AktivValg, type PersonFelt, nokkel, useUtkastLager, useVert } from "./utkast";
import { BudsjettFelt, Lagringsmelding } from "./Skjemadeler";
import {
  type BudsjettUtkast,
  budsjettUtkast,
  tilBudsjettvalg,
  tilFastBudsjett,
} from "./budsjettUtkast";
import styles from "./Gaver.module.css";

interface RegisterKontekst {
  grupper: Grupper;
  gaver: Gave[];
  /** Årets julanledning, hvis planleggingen er startet. */
  jul: Anledning | undefined;
  aar: number;
  handlinger: GaverHandlinger;
}

export function Personregister({
  personer,
  grupper,
  gaver,
  anledninger,
  aar,
  handlinger,
}: {
  personer: Person[];
  grupper: Grupper;
  gaver: Gave[];
  anledninger: Anledning[];
  aar: number;
  handlinger: GaverHandlinger;
}) {
  const ktx: RegisterKontekst = {
    grupper,
    gaver,
    jul: anledninger.find((a) => a.id === julAnledningId(aar)),
    aar,
    handlinger,
  };
  const lager = useUtkastLager();
  useVert(nokkel.nyPerson);
  const nyApen = lager.poster.has(nokkel.nyPerson);
  const [visArkiverteValgt, setVisArkiverte] = useState(false);
  // Et åpent utkast for en arkivert person holder listen åpen.
  const visArkiverte =
    visArkiverteValgt || personer.some((p) => p.arkivert && lager.poster.has(nokkel.person(p.id)));
  const aktive = personer.filter((p) => !p.arkivert);
  const arkiverte = personer.filter((p) => p.arkivert);

  return (
    <div className={styles.seksjon}>
      <Card>
        <div className={styles.kort}>
          <h2 className={styles.kortTittel}>Gruppenes standard for jul</h2>
          <p className={styles.dempet}>
            Personene arver dette fra gruppen sin, med mindre du gir en person et eget valg.
            Budsjettet er planlagt beløp per mottaker. Endringer gjelder for juleplanlegging som
            startes senere; en plan som er startet, beholder tallene sine.
          </p>
          <ul className={styles.liste}>
            {GRUPPER.map((g) => (
              <GruppeRad key={g.id} id={g.id} gruppe={grupper[g.id]} handlinger={handlinger} />
            ))}
          </ul>
        </div>
      </Card>

      <div className={styles.kortHode}>
        <h2 className={styles.seksjonTittel}>Personer</h2>
        {!nyApen && (
          <Button
            size="compact"
            onClick={() => apnePerson(lager, nokkel.nyPerson, null, handlinger.nyPersonId())}
          >
            Legg til person
          </Button>
        )}
      </div>
      {nyApen && (
        <PersonSkjema
          nokkel={nokkel.nyPerson}
          gjeldende={(() => {
            const p = lager.poster.get(nokkel.nyPerson);
            return (p && personer.find((x) => x.id === (p as { id: string }).id)) ?? null;
          })()}
          grupper={grupper}
          handlinger={handlinger}
        />
      )}
      {aktive.length === 0 && !nyApen && (
        <p className={styles.tom}>
          Ingen personer er registrert ennå. Legg til dem dere gir gaver til.
        </p>
      )}
      {GRUPPER.map((g) => {
        const iGruppen = aktive
          .filter((p) => p.gruppe === g.id)
          .sort((a, b) => a.navn.localeCompare(b.navn, "nb"));
        if (iGruppen.length === 0) return null;
        return (
          <Card key={g.id}>
            <div className={styles.kort}>
              <h3 className={styles.kortTittel}>{g.navn}</h3>
              <ul className={styles.liste}>
                {iGruppen.map((p) => (
                  <PersonRad key={p.id} person={p} ktx={ktx} />
                ))}
              </ul>
            </div>
          </Card>
        );
      })}
      {arkiverte.length > 0 && (
        <div className={styles.seksjon}>
          <button
            type="button"
            className={styles.tekstKnapp}
            aria-expanded={visArkiverte}
            onClick={() => setVisArkiverte(!visArkiverte)}
          >
            {visArkiverte ? "Skjul arkiverte" : `Vis arkiverte (${arkiverte.length})`}
          </button>
          {visArkiverte && (
            <Card variant="neutral">
              <div className={styles.kort}>
                <p className={styles.dempet}>
                  Arkiverte personer tas ikke med i ny planlegging. Gavene og historikken deres er
                  beholdt.
                </p>
                <ul className={styles.liste}>
                  {arkiverte.map((p) => (
                    <PersonRad key={p.id} person={p} ktx={ktx} />
                  ))}
                </ul>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function GruppeRad({
  id,
  gruppe,
  handlinger,
}: {
  id: GruppeId;
  gruppe: Gruppe | undefined;
  handlinger: GaverHandlinger;
}) {
  const lagret: GruppeStandard = gruppe?.standard.jul ?? {};
  const [redigerer, setRedigerer] = useState(false);
  const [aktiv, setAktiv] = useState(lagret.aktiv ?? true);
  const [budsjett, setBudsjett] = useState<BudsjettUtkast>(budsjettUtkast(lagret.budsjett));
  const [grunn, setGrunn] = useState(gruppe?.versjon ?? 0);
  const [ugyldig, setUgyldig] = useState(false);
  const l = useLagring();
  const feltId = useId();

  const apne = () => {
    setAktiv(lagret.aktiv ?? true);
    setBudsjett(budsjettUtkast(lagret.budsjett));
    setGrunn(gruppe?.versjon ?? 0);
    l.nullstill();
    setRedigerer(true);
  };

  const lagre = async (grunnVersjon: number) => {
    const b = tilFastBudsjett(budsjett);
    setUgyldig(b === null);
    if (b === null) return;
    const ok = await l.kjor(() =>
      handlinger.lagreGruppeStandard(id, { aktiv, budsjett: b }, grunnVersjon),
    );
    if (ok) setRedigerer(false);
  };

  return (
    <li className={styles.rad}>
      <div className={styles.radTekst}>
        <strong>{gruppeNavn(id)}</strong>
        <span className={styles.dempet}>
          {(lagret.aktiv ?? true) ? "Med i jul" : "Ikke med i jul"} · budsjett{" "}
          {budsjettTekst(lagret.budsjett ?? { type: "ikke_satt" }).toLowerCase()}
        </span>
      </div>
      {!redigerer ? (
        <button type="button" className={styles.tekstKnapp} onClick={apne}>
          Endre
        </button>
      ) : (
        <div className={styles.skjema} style={{ flexBasis: "100%" }}>
          <label className={styles.avkrysning} htmlFor={`${feltId}-aktiv`}>
            <input
              id={`${feltId}-aktiv`}
              type="checkbox"
              checked={aktiv}
              onChange={(e) => setAktiv(e.target.checked)}
            />
            Med i jul som standard
          </label>
          <BudsjettFelt etikett="Budsjett per mottaker" verdi={budsjett} onChange={setBudsjett} />
          {ugyldig && <p className={styles.feil}>Skriv et beløp i kroner, for eksempel 500.</p>}
          <Lagringsmelding
            {...l}
            onLagreLikevel={() => {
              setGrunn(gruppe?.versjon ?? 0);
              void lagre(gruppe?.versjon ?? 0);
            }}
            onForkast={apne}
          />
          <div className={styles.handlinger}>
            <Button size="compact" loading={l.lagrer} onClick={() => void lagre(grunn)}>
              Lagre
            </Button>
            <button type="button" className={styles.tekstKnapp} onClick={() => setRedigerer(false)}>
              Avbryt
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function PersonRad({ person, ktx }: { person: Person; ktx: RegisterKontekst }) {
  const { grupper, gaver, jul, aar, handlinger } = ktx;
  const lager = useUtkastLager();
  const nPerson = nokkel.person(person.id);
  const nIde = nokkel.nyIde(person.id);
  useVert(nPerson, nIde);
  const [visIdeerValgt, setVisIdeer] = useState(false);
  const l = useLagring();
  const ideer = lopendeIdeer(person.id, gaver);
  const redigerer = lager.poster.has(nPerson);
  const nyIdeApen = lager.poster.has(nIde);
  // Åpne utkast holder idélisten åpen, så de ikke skjules.
  const visIdeer =
    visIdeerValgt || nyIdeApen || ideer.some((g) => lager.poster.has(nokkel.gave(g.id)));
  const mottaker = jul?.mottakere[person.id];
  const erMottaker = !!mottaker && !mottaker.fjernet;

  if (redigerer) {
    return (
      <li className={styles.rad}>
        <div style={{ flexBasis: "100%" }}>
          <PersonSkjema
            nokkel={nPerson}
            gjeldende={person}
            grupper={grupper}
            handlinger={handlinger}
          />
        </div>
      </li>
    );
  }
  const fd = fodselsdatoTekst(person.fodselsdato);
  return (
    <li className={styles.rad}>
      <div className={styles.radTekst}>
        <strong>{person.navn}</strong>
        <span className={styles.dempet}>
          {[fd && `Født ${fd}`, person.notat].filter(Boolean).join(" · ")}
        </span>
        <span className={styles.dempet}>{julTekst(person, grupper)}</span>
      </div>
      <div className={styles.handlinger}>
        <button
          type="button"
          className={styles.tekstKnapp}
          aria-expanded={visIdeer}
          onClick={() => setVisIdeer(!visIdeer)}
          aria-label={`Ideer for ${person.navn} (${ideer.length})`}
        >
          Ideer ({ideer.length})
        </button>
        <button
          type="button"
          className={styles.tekstKnapp}
          onClick={() => apnePerson(lager, nPerson, person)}
          aria-label={`Rediger ${person.navn}`}
        >
          Rediger
        </button>
        <button
          type="button"
          className={styles.tekstKnapp}
          disabled={l.lagrer}
          onClick={() => void l.kjor(() => handlinger.arkiverPerson(person, !person.arkivert))}
          aria-label={`${person.arkivert ? "Gjenopprett" : "Arkiver"} ${person.navn}`}
        >
          {person.arkivert ? "Gjenopprett" : "Arkiver"}
        </button>
      </div>
      <Lagringsmelding {...l} />
      {visIdeer && (
        <section
          className={styles.seksjon}
          style={{ flexBasis: "100%" }}
          aria-label={`Løpende ideer for ${person.navn}`}
        >
          <p className={styles.dempet}>
            Løpende ideer hører til personen, ikke til en bestemt anledning.
            {erMottaker
              ? ` Bruk en idé til jul ${aar} når du vil planlegge med den.`
              : jul
                ? ` ${person.navn} er ikke på listen for jul ${aar}; legg til personen der for å bruke en idé til jul.`
                : ` Når juleplanleggingen for ${aar} er startet, kan en idé brukes til jul.`}
          </p>
          {ideer.length > 0 && (
            <ul className={styles.liste}>
              {ideer.map((g) => (
                <GaveRad
                  key={g.id}
                  gave={g}
                  handlinger={handlinger}
                  ekstra={
                    erMottaker && jul
                      ? {
                          tekst: `Bruk til jul ${aar}`,
                          utfor: () => handlinger.flyttGave(g, jul.id),
                        }
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
          {nyIdeApen ? (
            <GaveSkjema
              nokkel={nIde}
              gjeldende={(() => {
                const p = lager.poster.get(nIde);
                return (p && gaver.find((g) => g.id === (p as { id: string }).id)) ?? null;
              })()}
              handlinger={handlinger}
            />
          ) : (
            <div>
              <Button
                size="compact"
                variant="secondary"
                onClick={() =>
                  apneGave(lager, nIde, null, person.id, undefined, handlinger.nyGaveId())
                }
              >
                Ny idé til {person.navn}
              </Button>
            </div>
          )}
        </section>
      )}
    </li>
  );
}

/** Ny person (`grunn = null`) eller redigering. `gjeldende` = siste lagrede versjon. */
/**
 * Ny person (`grunn = null`) eller redigering. Utkastet og grunnlaget ligger
 * i utkastlageret under `nokkel`; `gjeldende` er siste lagrede versjon.
 */
export function PersonSkjema({
  nokkel: n,
  gjeldende,
  grupper,
  handlinger,
}: {
  nokkel: string;
  gjeldende: Person | null;
  grupper: Grupper;
  handlinger: GaverHandlinger;
}) {
  const feltId = useId();
  const lager = useUtkastLager();
  const [valideringsfeil, setValideringsfeil] = useState<string | null>(null);
  const l = useLagring();
  const post = lager.poster.get(n);
  if (!post || post.art !== "person") return null;
  const { felt: utkast, grunn, id } = post;
  const sett = <K extends keyof PersonFelt>(k: K, v: PersonFelt[K]) =>
    lager.oppdater(n, (p) => (p.art === "person" ? { ...p, felt: { ...p.felt, [k]: v } } : p));
  const setGrunn = (g: Person | null) =>
    lager.oppdater(n, (p) => (p.art === "person" ? { ...p, grunn: g } : p));
  const onFerdig = () => lager.fjern(n);
  const startGrunn = grunn;

  const arvet = effektivStandard({ gruppe: utkast.gruppe, unntak: {} }, grupper, "jul");

  const lagre = async (mot: Person | null) => {
    if (!utkast.navn.trim()) return setValideringsfeil("Skriv inn et navn.");
    const fd = tolkFodselsdato(utkast.fodselsdato);
    if (fd === null) return setValideringsfeil("Fødselsdato skrives som dd.mm eller dd.mm.åååå.");
    const budsjett = tilBudsjettvalg(utkast.budsjett);
    if (budsjett === null)
      return setValideringsfeil("Skriv budsjettet i kroner, for eksempel 500.");
    setValideringsfeil(null);
    const jul: PersonUnntak = {};
    if (utkast.aktiv !== "arv") jul.aktiv = utkast.aktiv === "ja";
    if (budsjett.type !== "arv") jul.budsjett = budsjett;
    const ny: PersonUtkast = {
      navn: utkast.navn,
      gruppe: utkast.gruppe,
      fodselsdato: fd,
      notat: utkast.notat,
      jul,
    };
    const ok = await l.kjor(() => handlinger.lagrePerson(id, ny, mot));
    if (ok) onFerdig();
  };

  return (
    <form
      className={styles.skjema}
      aria-label={startGrunn ? `Rediger ${startGrunn.navn}` : "Ny person"}
      onSubmit={(e) => {
        e.preventDefault();
        void lagre(grunn);
      }}
    >
      <div className={styles.rutenett}>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-navn`}>Navn</label>
          <input
            id={`${feltId}-navn`}
            className={styles.input}
            value={utkast.navn}
            onChange={(e) => sett("navn", e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-gruppe`}>Gruppe</label>
          <select
            id={`${feltId}-gruppe`}
            className={styles.select}
            value={utkast.gruppe}
            onChange={(e) => sett("gruppe", e.target.value as GruppeId)}
          >
            {GRUPPER.map((g) => (
              <option key={g.id} value={g.id}>
                {g.navn}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-fd`}>Fødselsdato (valgfritt)</label>
          <input
            id={`${feltId}-fd`}
            className={styles.input}
            placeholder="dd.mm eller dd.mm.åååå"
            value={utkast.fodselsdato}
            onChange={(e) => sett("fodselsdato", e.target.value)}
          />
        </div>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-notat`}>Notat (valgfritt)</label>
          <input
            id={`${feltId}-notat`}
            className={styles.input}
            value={utkast.notat}
            onChange={(e) => sett("notat", e.target.value)}
          />
        </div>
        <div className={styles.felt}>
          <label htmlFor={`${feltId}-aktiv`}>Med i jul</label>
          <select
            id={`${feltId}-aktiv`}
            className={styles.select}
            value={utkast.aktiv}
            onChange={(e) => sett("aktiv", e.target.value as AktivValg)}
          >
            <option value="arv">Som gruppen ({arvet.aktiv ? "ja" : "nei"})</option>
            <option value="ja">Ja</option>
            <option value="nei">Nei</option>
          </select>
        </div>
        <BudsjettFelt
          etikett="Budsjett for jul"
          verdi={utkast.budsjett}
          onChange={(v) => sett("budsjett", v)}
          arvTekst={`Som gruppen (${budsjettTekst(arvet.budsjett).toLowerCase()})`}
        />
      </div>
      {valideringsfeil && <p className={styles.feil}>{valideringsfeil}</p>}
      <Lagringsmelding
        {...l}
        onLagreLikevel={
          gjeldende
            ? () => {
                setGrunn(gjeldende);
                void lagre(gjeldende);
              }
            : undefined
        }
        onForkast={
          gjeldende
            ? () => {
                lager.sett(n, { ...post, grunn: gjeldende, felt: personFelt(gjeldende) });
                l.nullstill();
              }
            : undefined
        }
      />
      <div className={styles.handlinger}>
        <Button size="compact" loading={l.lagrer} onClick={() => void lagre(grunn)}>
          Lagre
        </Button>
        <button type="button" className={styles.tekstKnapp} onClick={onFerdig}>
          Avbryt
        </button>
      </div>
    </form>
  );
}
