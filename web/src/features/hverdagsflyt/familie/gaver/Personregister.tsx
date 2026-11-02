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
import type { GaverHandlinger, PersonUtkast } from "@hooks/useGaver";
import { julTekst } from "./julTekst";
import { useLagring } from "./lagring";
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
  const [nyId, setNyId] = useState<string | null>(null);
  const [visArkiverte, setVisArkiverte] = useState(false);
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
        {nyId === null && (
          <Button size="compact" onClick={() => setNyId(handlinger.nyPersonId())}>
            Legg til person
          </Button>
        )}
      </div>
      {nyId !== null && (
        <PersonSkjema
          id={nyId}
          grunn={null}
          gjeldende={personer.find((p) => p.id === nyId) ?? null}
          grupper={grupper}
          handlinger={handlinger}
          onFerdig={() => setNyId(null)}
        />
      )}
      {aktive.length === 0 && nyId === null && (
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
            onClick={() => setVisArkiverte((v) => !v)}
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
  const [redigerer, setRedigerer] = useState(false);
  const [visIdeer, setVisIdeer] = useState(false);
  const [nyIde, setNyIde] = useState<string | null>(null);
  const l = useLagring();
  const ideer = lopendeIdeer(person.id, gaver);
  const mottaker = jul?.mottakere[person.id];
  const erMottaker = !!mottaker && !mottaker.fjernet;

  if (redigerer) {
    return (
      <li className={styles.rad}>
        <div style={{ flexBasis: "100%" }}>
          <PersonSkjema
            id={person.id}
            grunn={person}
            gjeldende={person}
            grupper={grupper}
            handlinger={handlinger}
            onFerdig={() => setRedigerer(false)}
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
          onClick={() => setVisIdeer((v) => !v)}
          aria-label={`Ideer for ${person.navn} (${ideer.length})`}
        >
          Ideer ({ideer.length})
        </button>
        <button
          type="button"
          className={styles.tekstKnapp}
          onClick={() => setRedigerer(true)}
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
          {nyIde !== null ? (
            <GaveSkjema
              id={nyIde}
              grunn={null}
              gjeldende={gaver.find((g) => g.id === nyIde) ?? null}
              personId={person.id}
              handlinger={handlinger}
              onFerdig={() => setNyIde(null)}
            />
          ) : (
            <div>
              <Button
                size="compact"
                variant="secondary"
                onClick={() => setNyIde(handlinger.nyGaveId())}
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

type AktivValg = "arv" | "ja" | "nei";

/** Ny person (`grunn = null`) eller redigering. `gjeldende` = siste lagrede versjon. */
export function PersonSkjema({
  id,
  grunn: startGrunn,
  gjeldende,
  grupper,
  handlinger,
  onFerdig,
}: {
  id: string;
  grunn: Person | null;
  gjeldende: Person | null;
  grupper: Grupper;
  handlinger: GaverHandlinger;
  onFerdig: () => void;
}) {
  const feltId = useId();
  const fra = (p: Person | null) => ({
    navn: p?.navn ?? "",
    gruppe: (p?.gruppe ?? "naer") as GruppeId,
    fodselsdato: fodselsdatoTekst(p?.fodselsdato),
    notat: p?.notat ?? "",
    aktiv: (typeof p?.unntak.jul?.aktiv === "boolean"
      ? p.unntak.jul.aktiv
        ? "ja"
        : "nei"
      : "arv") as AktivValg,
    budsjett: budsjettUtkast(p?.unntak.jul?.budsjett),
  });
  const [utkast, setUtkast] = useState(() => fra(startGrunn));
  const [grunn, setGrunn] = useState<Person | null>(startGrunn);
  const [valideringsfeil, setValideringsfeil] = useState<string | null>(null);
  const l = useLagring();
  const sett = <K extends keyof typeof utkast>(k: K, v: (typeof utkast)[K]) =>
    setUtkast((u) => ({ ...u, [k]: v }));

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
                setUtkast(fra(gjeldende));
                setGrunn(gjeldende);
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
