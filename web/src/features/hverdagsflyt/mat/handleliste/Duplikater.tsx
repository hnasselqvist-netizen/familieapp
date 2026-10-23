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
  return `Ikke lagret: ${u.grunn ?? "listen er endret."} Se forslaget på nytt.`;
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
  onSlaaSammen: (plan: SammenslaingsPlan) => Promise<Sammenslaingsutfall>;
}) {
  const grupper = finnDuplikatgrupper(rader);
  const [melding, setMelding] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);

  if (grupper.length === 0 && !melding) return null;

  // Meldingen står utenfor <details>: når siste gruppe forsvinner etter en
  // sammenslåing, ville den ellers havnet i et lukket panel.
  return (
    <>
      {melding && (
        <p className={styles.melding} role="status">
          {melding}
        </p>
      )}
      {grupper.length > 0 && (
        <details className={styles.panel}>
          <summary className={styles.tittel}>Mulige duplikater ({grupper.length})</summary>
          {grupper.map((g) => (
            <Gruppe
              key={g.nokkel}
              gruppe={g}
              lagrer={lagrer}
              vareNavn={vareNavn}
              onSlaaSammen={async (plan) => {
                setLagrer(true);
                try {
                  setMelding(utfallTekst(await onSlaaSammen(plan), false));
                } catch (e) {
                  console.error(e);
                  setMelding("Kunne ikke lagre. Prøv igjen.");
                } finally {
                  setLagrer(false);
                }
              }}
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
  onAngre: (beholdId: string, opId: string) => Promise<Sammenslaingsutfall>;
}) {
  const sammenslatte = rader.filter((r) => r.sammenslaing);
  const [melding, setMelding] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);

  if (sammenslatte.length === 0 && !melding) return null;

  const angre = async (r: ShoppingItem) => {
    setLagrer(true);
    try {
      setMelding(utfallTekst(await onAngre(r.id, r.sammenslaing!.opId), true));
    } catch (e) {
      console.error(e);
      setMelding("Kunne ikke angre. Prøv igjen.");
    } finally {
      setLagrer(false);
    }
  };

  return (
    <div className={styles.panel} role="group" aria-label="Sammenslåtte rader">
      <p className={styles.gruppeTittel}>Sammenslåtte rader</p>
      {melding && (
        <p className={styles.melding} role="status">
          {melding}
        </p>
      )}
      {sammenslatte.map((r) => (
        <div key={r.id} className={styles.rad}>
          <span>
            {r.name} · {mengdeTekst(r.amount)} · slått sammen fra {r.sammenslaing!.antallKilder}{" "}
            {r.sammenslaing!.antallKilder === 1 ? "rad" : "rader"}
          </span>
          <button
            type="button"
            className={styles.knapp}
            disabled={lagrer}
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
  vareNavn,
  onSlaaSammen,
}: {
  gruppe: Duplikatgruppe;
  lagrer: boolean;
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

  const valgte = gruppe.rader.filter((r) => valgt.has(r.id));
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
              checked={valgt.has(r.id)}
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
