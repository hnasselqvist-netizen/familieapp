import { useState } from "react";
import {
  type Duplikatgruppe,
  finnDuplikatgrupper,
  lagPlan,
  stabil,
  synlig,
  vurderMengder,
} from "@domain/shopping/handlelisteDuplikater";
import type { Sammenslaingsutfall } from "@hooks/useShoppingList";
import type { SammenslaingsPlan } from "@domain/shopping/handlelisteDuplikater";
import type { ShoppingItem } from "@app-types/shopping";
import styles from "./Duplikater.module.css";

function mengdeTekst(m: string): string {
  return m.trim() === "" ? "ingen mengde" : m;
}

function utfallTekst(u: Sammenslaingsutfall, angring: boolean): string {
  if (u.utfall === "anvendt")
    return angring ? "Sammenslåingen er angret." : "Radene er slått sammen.";
  if (u.utfall === "allerede") {
    return angring
      ? "Var allerede angret. Ingen ny endring."
      : "Var allerede slått sammen. Ingen ny endring.";
  }
  if (u.utfall === "ukjent") {
    return angring
      ? "Vi vet ikke om angringen ble lagret."
      : "Vi vet ikke om sammenslåingen ble lagret.";
  }
  if (u.utfall === "ubekreftet") return u.grunn ?? "Ikke bekreftet.";
  if (u.utfall === "avvist") return "Ingen tilgang til å lagre. Ingenting er endret.";
  if (u.utfall === "ikkeLest") {
    return "Kunne ikke lese handlelisten. Ingenting er endret — prøv igjen.";
  }
  return `Ikke lagret: ${u.grunn ?? "listen er endret."} Se forslaget på nytt.`;
}

/**
 * En operasjon med ukjent utfall. Radene den gjelder er sperret for nye
 * operasjoner til den er avklart (review 5884178972).
 */
interface Ventende {
  opId: string;
  hva: string;
  tekst: string;
  /** Radene operasjonen gjelder (mål og kilder). */
  rader: string[];
  /** «Prøv igjen»: samme operasjon som gjentak — avgjøres bare mot historikken, skriver aldri. */
  gjenta: () => Promise<Sammenslaingsutfall>;
  /**
   * «Send på nytt» etter kontroll av listen: samme plan og `opId` som vanlig
   * operasjon. Historikken hindrer fortsatt dobbel virkning.
   */
  send: () => Promise<Sammenslaingsutfall>;
  /** «Send på nytt» er trykket: venter på eksplisitt bekreftelse. */
  bekreftNy?: boolean;
  /** «Lukk» er trykket: venter på eksplisitt bekreftelse før sperren oppheves. */
  bekreftLukk?: boolean;
}

/**
 * Grunnen ved et oppfølgingskall som ikke bekreftet noe. Sier aldri
 * «ingenting er endret»: det opprinnelige forsøket kan være lagret.
 */
function oppfolgingsTekst(u: Sammenslaingsutfall, angring: boolean): string {
  switch (u.utfall) {
    case "avvist":
      return "databasen nektet tilgang denne gangen.";
    case "ikkeLest":
      return "handlelisten kunne ikke leses denne gangen.";
    case "ukjent":
      return "svaret uteble igjen.";
    case "konflikt":
      return `${u.grunn ?? "listen er endret."} Se listen.`;
    default:
      return utfallTekst(u, angring);
  }
}

/**
 * Behandler et utfall for en operasjon som kan bli ventende (review
 * 5883585162 pkt. 1, 5884370283). Første innsending: `ukjent` gjør den
 * ventende, et avslag har ikke skrevet noe og vises som melding. Ethvert
 * OPPFØLGINGSKALL på samme `opId` — «Prøv igjen» og eksplisitt «Send på
 * nytt» — fjerner forsøket bare ved et bekreftende utfall
 * (`anvendt`/`allerede`); alt annet holder det og sperren.
 */
function ventendeEtter(
  liste: Ventende[],
  post: Omit<Ventende, "tekst" | "bekreftNy" | "bekreftLukk">,
  u: Sammenslaingsutfall,
  gjentak: boolean,
  angring: boolean,
): { liste: Ventende[]; melding: string | null } {
  const oppfolging = gjentak || liste.some((v) => v.opId === post.opId);
  const uten = liste.filter((v) => v.opId !== post.opId);
  if (u.utfall === "anvendt" || u.utfall === "allerede") {
    return {
      liste: uten,
      melding: gjentak
        ? angring
          ? "Angringen er bekreftet lagret. Ingen ny endring."
          : "Sammenslåingen er bekreftet lagret. Ingen ny endring."
        : utfallTekst(u, angring),
    };
  }
  if (u.utfall === "ukjent" || oppfolging) {
    const tekst = oppfolging
      ? `Fortsatt ikke bekreftet: ${oppfolgingsTekst(u, angring)}`
      : `${utfallTekst(u, angring)} «Prøv igjen» sender den samme operasjonen, så den aldri utføres to ganger.`;
    return {
      liste: [...uten, { ...post, tekst, bekreftNy: false, bekreftLukk: false }],
      melding: null,
    };
  }
  return { liste: uten, melding: utfallTekst(u, angring) };
}

function VentendeListe({
  ventende,
  lagrer,
  onGjenta,
  onSend,
  onVeksleBekreft,
  onVeksleLukk,
  onLukk,
}: {
  ventende: readonly Ventende[];
  lagrer: boolean;
  onGjenta: (v: Ventende) => void;
  onSend: (v: Ventende) => void;
  onVeksleBekreft: (v: Ventende) => void;
  onVeksleLukk: (v: Ventende) => void;
  /** Bekreftet «Lukk»: fjerner forsøket og opphever sperren. */
  onLukk: (v: Ventende) => void;
}) {
  return (
    <>
      {ventende.map((v) => (
        <div
          key={v.opId}
          className={styles.panel}
          role="alert"
          aria-label={`Ikke bekreftet: ${v.hva}`}
        >
          <p className={styles.blokkert}>
            {v.hva}: {v.tekst}
          </p>
          {v.bekreftLukk ? (
            <>
              <p className={styles.blokkert}>
                Sjekk listen først. Lukker du varselet, oppheves sperren på radene, og forsøket kan
                ikke lenger avklares herfra.
              </p>
              <button
                type="button"
                className={styles.knapp}
                disabled={lagrer}
                onClick={() => onLukk(v)}
              >
                Jeg har sjekket listen — lukk og opphev sperren
              </button>{" "}
              <button
                type="button"
                className={styles.knapp}
                disabled={lagrer}
                onClick={() => onVeksleLukk(v)}
              >
                Ikke lukk
              </button>
            </>
          ) : v.bekreftNy ? (
            <>
              <p className={styles.blokkert}>
                Sjekk listen først. Ser den allerede riktig ut, ble forrige forsøk lagret — da skal
                du ikke sende på nytt.
              </p>
              <button
                type="button"
                className={styles.knapp}
                disabled={lagrer}
                onClick={() => onSend(v)}
              >
                Jeg har sjekket listen — send på nytt
              </button>{" "}
              <button
                type="button"
                className={styles.knapp}
                disabled={lagrer}
                onClick={() => onVeksleBekreft(v)}
              >
                Ikke send
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.knapp}
                disabled={lagrer}
                onClick={() => onGjenta(v)}
              >
                Prøv igjen
              </button>{" "}
              <button
                type="button"
                className={styles.knapp}
                disabled={lagrer}
                onClick={() => onVeksleBekreft(v)}
              >
                Send på nytt
              </button>{" "}
              <button
                type="button"
                className={styles.knapp}
                disabled={lagrer}
                onClick={() => onVeksleLukk(v)}
              >
                Lukk
              </button>
            </>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * Mulige duplikater i handlelisten (Mat #20). Ingenting er forhåndsvalgt:
 * Helen krysser av radene som skal med, velger hvilken som beholdes og
 * (når mengdene er rene tall) om de skal legges sammen. Forhåndsvisningen
 * viser originalradene og det presise resultatet før noe lagres.
 *
 * Bare NYE sammenslåinger ligger bak aktiveringsporten. Angring av
 * eksisterende sammenslåinger er egen komponent (`Sammenslatte`) og vises
 * alltid når slike rader finnes — også etter en tilbakerulling av porten
 * (ADR 0003 §Tilbakerulling).
 */
export function Duplikater({
  rader,
  vareNavn = () => undefined,
  onSlaaSammen,
}: {
  rader: readonly ShoppingItem[];
  /** Navnet på en vare i varebasen, for forståelige etiketter (aldri rå ID-er). */
  vareNavn?: (itemId: string) => string | undefined;
  onSlaaSammen: (plan: SammenslaingsPlan, gjentak?: boolean) => Promise<Sammenslaingsutfall>;
}) {
  const grupper = finnDuplikatgrupper(rader);
  const [melding, setMelding] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);
  // Planer med ukjent utfall — utenfor den flyktige gruppen, så de overlever
  // at gruppen forsvinner (review 5883585162 pkt. 1).
  const [ventende, setVentende] = useState<Ventende[]>([]);

  if (grupper.length === 0 && !melding && ventende.length === 0) return null;
  // Rader i et ubekreftet forsøk kan ikke tas med i en ny sammenslåing.
  const sperret = new Set(ventende.flatMap((v) => v.rader));

  const utfor = async (
    post: Omit<Ventende, "tekst" | "bekreftNy" | "bekreftLukk">,
    kall: () => Promise<Sammenslaingsutfall>,
    gjentak: boolean,
  ) => {
    setLagrer(true);
    try {
      const u = await kall();
      const r = ventendeEtter(ventende, post, u, gjentak, false);
      setVentende(r.liste);
      setMelding(r.melding);
    } catch (e) {
      console.error(e);
      setMelding("Kunne ikke lagre. Prøv igjen.");
    } finally {
      setLagrer(false);
    }
  };

  // Meldingen står utenfor <details>: når siste gruppe forsvinner etter en
  // sammenslåing, ville den ellers havnet i et lukket panel.
  return (
    <>
      {melding && (
        <p className={styles.melding} role="status">
          {melding}
        </p>
      )}
      <VentendeListe
        ventende={ventende}
        lagrer={lagrer}
        onGjenta={(v) => void utfor(v, v.gjenta, true)}
        onSend={(v) => void utfor(v, v.send, false)}
        onVeksleBekreft={(v) =>
          setVentende((l) =>
            l.map((x) => (x.opId === v.opId ? { ...x, bekreftNy: !x.bekreftNy } : x)),
          )
        }
        onVeksleLukk={(v) =>
          setVentende((l) =>
            l.map((x) => (x.opId === v.opId ? { ...x, bekreftLukk: !x.bekreftLukk } : x)),
          )
        }
        onLukk={(v) => setVentende((l) => l.filter((x) => x.opId !== v.opId))}
      />
      {grupper.length > 0 && (
        <details className={styles.panel}>
          <summary className={styles.tittel}>Mulige duplikater ({grupper.length})</summary>
          {grupper.map((g) => (
            <Gruppe
              key={g.nokkel}
              gruppe={g}
              lagrer={lagrer}
              sperret={sperret}
              vareNavn={vareNavn}
              onSlaaSammen={(plan) =>
                utfor(
                  {
                    opId: plan.opId,
                    hva: `Sammenslåing av ${plan.kildeIds.length + 1} rader «${plan.sett[plan.beholdId]?.name ?? ""}»`,
                    rader: [plan.beholdId, ...plan.kildeIds],
                    // Den innsendte planen, uendret: samme plan og opId ved «Prøv igjen».
                    gjenta: () => onSlaaSammen(plan, true),
                    send: () => onSlaaSammen(plan),
                  },
                  () => onSlaaSammen(plan),
                  false,
                )
              }
            />
          ))}
        </details>
      )}
    </>
  );
}

/**
 * Sammenslåtte rader med «Angre» (Mat #20). Uavhengig av aktiveringsporten
 * for nye sammenslåinger: finnes det rader med sammenslåingshistorikk, kan
 * de alltid angres eksakt.
 */
export function Sammenslatte({
  rader,
  onAngre,
}: {
  rader: readonly ShoppingItem[];
  onAngre: (beholdId: string, opId: string, gjentak?: boolean) => Promise<Sammenslaingsutfall>;
}) {
  const sammenslatte = rader.filter((r) => r.sammenslaing);
  const [melding, setMelding] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);
  // Angringer med ukjent utfall: opprinnelig mål og opId, uavhengig av raden.
  const [ventende, setVentende] = useState<Ventende[]>([]);

  if (sammenslatte.length === 0 && !melding && ventende.length === 0) return null;

  const utfor = async (
    post: Omit<Ventende, "tekst" | "bekreftNy" | "bekreftLukk">,
    kall: () => Promise<Sammenslaingsutfall>,
    gjentak: boolean,
  ) => {
    setLagrer(true);
    try {
      const u = await kall();
      const r = ventendeEtter(ventende, post, u, gjentak, true);
      setVentende(r.liste);
      setMelding(r.melding);
    } catch (e) {
      console.error(e);
      setMelding("Kunne ikke angre. Prøv igjen.");
    } finally {
      setLagrer(false);
    }
  };
  const angre = (r: ShoppingItem) => {
    const beholdId = r.id;
    const opId = r.sammenslaing!.opId;
    return utfor(
      {
        opId,
        hva: `Angring av sammenslåingen «${r.name}»`,
        rader: [beholdId],
        // Opprinnelig mål og opId, også om raden senere forsvinner eller endres.
        gjenta: () => onAngre(beholdId, opId, true),
        send: () => onAngre(beholdId, opId),
      },
      () => onAngre(beholdId, opId),
      false,
    );
  };

  return (
    <div className={styles.panel} role="group" aria-label="Sammenslåtte rader">
      <p className={styles.gruppeTittel}>Sammenslåtte rader</p>
      {melding && (
        <p className={styles.melding} role="status">
          {melding}
        </p>
      )}
      <VentendeListe
        ventende={ventende}
        lagrer={lagrer}
        onGjenta={(v) => void utfor(v, v.gjenta, true)}
        onSend={(v) => void utfor(v, v.send, false)}
        onVeksleBekreft={(v) =>
          setVentende((l) =>
            l.map((x) => (x.opId === v.opId ? { ...x, bekreftNy: !x.bekreftNy } : x)),
          )
        }
        onVeksleLukk={(v) =>
          setVentende((l) =>
            l.map((x) => (x.opId === v.opId ? { ...x, bekreftLukk: !x.bekreftLukk } : x)),
          )
        }
        onLukk={(v) => setVentende((l) => l.filter((x) => x.opId !== v.opId))}
      />
      {sammenslatte.map((r) => (
        <div key={r.id} className={styles.rad}>
          <span>
            {r.name} · {mengdeTekst(r.amount)} · slått sammen fra {r.sammenslaing!.antallKilder}{" "}
            {r.sammenslaing!.antallKilder === 1 ? "rad" : "rader"}
          </span>
          <button
            type="button"
            className={styles.knapp}
            // En ubekreftet angring av samme rad avklares i varselet, ikke her.
            disabled={lagrer || ventende.some((v) => v.rader.includes(r.id))}
            aria-label={`Angre sammenslåing av ${r.name}`}
            onClick={() => void angre(r)}
          >
            Angre
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Forståelige varenavn per rad i gruppen — aldri rå database-ID-er. Har
 * gruppen flere ulike varer, nummereres de i rekkefølge («Melk (vare 1)»,
 * «Melk (vare 2)»), så to varer med samme navn kan skilles.
 */
function vareEtiketter(
  rader: readonly ShoppingItem[],
  vareNavn: (itemId: string) => string | undefined,
): Map<string | null, string> {
  const ider = [...new Set(rader.map((r) => r.itemId).filter((x): x is string => !!x))];
  const etiketter = new Map<string | null, string>([[null, "ingen vare"]]);
  ider.forEach((id, i) => {
    const navn = vareNavn(id) ?? "ukjent vare";
    etiketter.set(id, ider.length > 1 ? `vare: ${navn} (vare ${i + 1})` : `vare: ${navn}`);
  });
  return etiketter;
}

function Gruppe({
  gruppe,
  lagrer,
  sperret,
  vareNavn,
  onSlaaSammen,
}: {
  gruppe: Duplikatgruppe;
  lagrer: boolean;
  /** Rader i et ubekreftet forsøk — kan ikke velges før forsøket er avklart. */
  sperret: ReadonlySet<string>;
  vareNavn: (itemId: string) => string | undefined;
  onSlaaSammen: (plan: SammenslaingsPlan) => Promise<void>;
}) {
  const [valgt, setValgt] = useState<Set<string>>(new Set());
  const [behold, setBehold] = useState<string | null>(null);
  const [mengdeValg, setMengdeValg] = useState<"sum" | "behold" | null>(null);
  // Grunnlaget (det Helen så) da mengden ble valgt. Endres en involvert rad
  // på en annen klient etterpå, gjelder ikke valget lenger.
  const [valgGrunnlag, setValgGrunnlag] = useState<string | null>(null);
  // opId lages når forhåndsvisningen står, så dobbeltklikk/retry gir samme operasjon.
  const [opId, setOpId] = useState(() => crypto.randomUUID());

  const valgte = gruppe.rader.filter((r) => valgt.has(r.id) && !sperret.has(r.id));
  const beholdt = valgte.find((r) => r.id === behold) ?? null;
  const vurdering = beholdt && valgte.length >= 2 ? vurderMengder(valgte, beholdt.id) : null;
  const grunnlag = beholdt
    ? stabil({ behold: beholdt.id, rader: valgte.map((r) => [r.id, synlig(r)]) })
    : null;
  const gyldigValg = mengdeValg && valgGrunnlag === grunnlag ? mengdeValg : null;
  const endretEtterValg = mengdeValg !== null && valgGrunnlag !== grunnlag;
  const etiketter = vareEtiketter(gruppe.rader, vareNavn);
  const etikett = (r: ShoppingItem) => etiketter.get(r.itemId ?? null) ?? "ingen vare";
  const navn = gruppe.rader[0]!.name;
  const tittel =
    gruppe.type === "sterk" ? `Samme vare: ${navn}` : `Likt navn, kanskje ikke samme vare: ${navn}`;

  const nullstill = () => {
    setMengdeValg(null);
    setValgGrunnlag(null);
    setOpId(crypto.randomUUID());
  };
  const veksle = (id: string) => {
    const ny = new Set(valgt);
    if (ny.has(id)) ny.delete(id);
    else ny.add(id);
    setValgt(ny);
    if (behold !== null && !ny.has(behold)) setBehold(null);
    nullstill();
  };
  const velgMengde = (v: "sum" | "behold") => {
    setMengdeValg(v);
    setValgGrunnlag(grunnlag);
    setOpId(crypto.randomUUID());
  };

  const planResultat =
    beholdt && gyldigValg
      ? lagPlan(valgte, beholdt.id, gyldigValg, opId, new Date().toISOString())
      : null;

  return (
    <div className={styles.gruppe} role="group" aria-label={tittel}>
      <p className={styles.gruppeTittel}>{tittel}</p>
      {gruppe.rader.some((r) => sperret.has(r.id)) && (
        <p className={styles.hint}>
          En tidligere sammenslåing av disse radene venter på avklaring. Bruk varselet over før du
          velger dem på nytt.
        </p>
      )}
      {gruppe.type === "kandidat" && (
        <p className={styles.hint}>
          Radene peker på ulike varer, eller mangler vare. Ta bare med rader du vet er samme vare.
        </p>
      )}
      {gruppe.rader.map((r) => (
        <div key={r.id} className={styles.rad}>
          <label className={styles.valg}>
            <input
              type="checkbox"
              checked={valgt.has(r.id) && !sperret.has(r.id)}
              disabled={sperret.has(r.id)}
              onChange={() => veksle(r.id)}
              aria-label={`Ta med ${r.name} (${mengdeTekst(r.amount)})`}
            />
            <span>
              {r.name} · {mengdeTekst(r.amount)} · {r.cat} · {etikett(r)}
            </span>
          </label>
          <label className={styles.valg}>
            <input
              type="radio"
              name={`behold-${gruppe.nokkel}`}
              checked={behold === r.id}
              disabled={!valgt.has(r.id)}
              onChange={() => {
                setBehold(r.id);
                nullstill();
              }}
              aria-label={`Behold ${r.name} (${mengdeTekst(r.amount)})`}
            />
            <span>Behold</span>
          </label>
        </div>
      ))}

      {vurdering && beholdt && (
        <div className={styles.forhandsvisning} aria-label={`Forhåndsvisning: ${navn}`}>
          {vurdering.type === "blokkert" ? (
            <p className={styles.blokkert}>{vurdering.grunn}</p>
          ) : (
            <>
              <fieldset className={styles.mengdevalg}>
                <legend>Mengde</legend>
                {vurdering.type === "tall" ? (
                  <>
                    <label>
                      <input
                        type="radio"
                        name={`mengde-${gruppe.nokkel}`}
                        checked={gyldigValg === "sum"}
                        onChange={() => velgMengde("sum")}
                      />{" "}
                      Legg sammen: {vurdering.sum}
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`mengde-${gruppe.nokkel}`}
                        checked={gyldigValg === "behold"}
                        onChange={() => velgMengde("behold")}
                      />{" "}
                      Behold én: {mengdeTekst(vurdering.behold)}
                    </label>
                  </>
                ) : (
                  <label>
                    <input
                      type="radio"
                      name={`mengde-${gruppe.nokkel}`}
                      checked={gyldigValg === "behold"}
                      onChange={() => velgMengde("behold")}
                    />{" "}
                    Uten mengde
                  </label>
                )}
              </fieldset>
              {endretEtterValg && (
                <p className={styles.blokkert} role="alert">
                  En av radene er endret etter at du valgte. Se over resultatet og velg på nytt.
                </p>
              )}
              {planResultat?.kan && (
                <p className={styles.resultat}>
                  Resultat: {beholdt.name} · {beholdt.cat} · {etikett(beholdt)} ·{" "}
                  {mengdeTekst(planResultat.plan.resultatMengde)}.{" "}
                  {planResultat.plan.kildeIds.length}{" "}
                  {planResultat.plan.kildeIds.length === 1 ? "rad fjernes" : "rader fjernes"} og kan
                  hentes tilbake med «Angre».
                </p>
              )}
              {planResultat && !planResultat.kan && (
                <p className={styles.blokkert}>{planResultat.grunn}</p>
              )}
              <button
                type="button"
                className={styles.bekreft}
                disabled={lagrer || !planResultat?.kan}
                onClick={() => {
                  if (planResultat?.kan) {
                    void onSlaaSammen(planResultat.plan).then(() => {
                      setValgt(new Set());
                      setBehold(null);
                      nullstill();
                    });
                  }
                }}
              >
                {lagrer ? "Lagrer…" : `Slå sammen ${valgte.length} rader`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
