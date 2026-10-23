import { useState } from "react";
import {
  type Duplikatgruppe,
  finnDuplikatgrupper,
  lagPlan,
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
 */
export function Duplikater({
  rader,
  onSlaaSammen,
  onAngre,
}: {
  rader: readonly ShoppingItem[];
  onSlaaSammen: (plan: SammenslaingsPlan) => Promise<Sammenslaingsutfall>;
  onAngre: (beholdId: string, opId: string) => Promise<Sammenslaingsutfall>;
}) {
  const grupper = finnDuplikatgrupper(rader);
  const sammenslatte = rader.filter((r) => r.sammenslaing);
  const [melding, setMelding] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);

  if (grupper.length === 0 && sammenslatte.length === 0 && !melding) return null;

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
    <details className={styles.panel}>
      <summary className={styles.tittel}>Mulige duplikater ({grupper.length})</summary>
      {melding && (
        <p className={styles.melding} role="status">
          {melding}
        </p>
      )}
      {grupper.map((g) => (
        <Gruppe
          key={g.nokkel}
          gruppe={g}
          lagrer={lagrer}
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
      {sammenslatte.length > 0 && (
        <div className={styles.gruppe} role="group" aria-label="Sammenslåtte rader">
          <p className={styles.gruppeTittel}>Sammenslåtte rader</p>
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
      )}
    </details>
  );
}

function Gruppe({
  gruppe,
  lagrer,
  onSlaaSammen,
}: {
  gruppe: Duplikatgruppe;
  lagrer: boolean;
  onSlaaSammen: (plan: SammenslaingsPlan) => Promise<void>;
}) {
  const [valgt, setValgt] = useState<Set<string>>(new Set());
  const [behold, setBehold] = useState<string | null>(null);
  const [mengdeValg, setMengdeValg] = useState<"sum" | "behold" | null>(null);
  // opId lages når forhåndsvisningen står, så dobbeltklikk/retry gir samme operasjon.
  const [opId, setOpId] = useState(() => crypto.randomUUID());

  const valgte = gruppe.rader.filter((r) => valgt.has(r.id));
  const beholdGyldig = behold !== null && valgt.has(behold);
  const vurdering = beholdGyldig && valgte.length >= 2 ? vurderMengder(valgte, behold) : null;
  const navn = gruppe.rader[0]!.name;
  const tittel =
    gruppe.type === "sterk" ? `Samme vare: ${navn}` : `Likt navn, kanskje ikke samme vare: ${navn}`;

  const nullstill = () => {
    setMengdeValg(null);
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

  const effektivtValg: "sum" | "behold" | null =
    vurdering?.type === "ingen" ? "behold" : vurdering?.type === "tall" ? mengdeValg : null;
  const planResultat =
    beholdGyldig && effektivtValg
      ? lagPlan(valgte, behold, effektivtValg, opId, new Date().toISOString())
      : null;

  return (
    <div className={styles.gruppe} role="group" aria-label={tittel}>
      <p className={styles.gruppeTittel}>{tittel}</p>
      {gruppe.type === "kandidat" && (
        <p className={styles.hint}>
          Radene peker på ulike varer. Ta bare med rader du vet er samme vare.
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
              {r.name} · {mengdeTekst(r.amount)} · {r.cat}
              {r.itemId ? "" : " · ingen vare"}
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

      {vurdering && behold && (
        <div className={styles.forhandsvisning} aria-label={`Forhåndsvisning: ${navn}`}>
          {vurdering.type === "blokkert" ? (
            <p className={styles.blokkert}>{vurdering.grunn}</p>
          ) : (
            <>
              {vurdering.type === "tall" && (
                <fieldset className={styles.mengdevalg}>
                  <legend>Mengde</legend>
                  <label>
                    <input
                      type="radio"
                      name={`mengde-${gruppe.nokkel}`}
                      checked={mengdeValg === "sum"}
                      onChange={() => setMengdeValg("sum")}
                    />{" "}
                    Legg sammen: {vurdering.sum}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`mengde-${gruppe.nokkel}`}
                      checked={mengdeValg === "behold"}
                      onChange={() => setMengdeValg("behold")}
                    />{" "}
                    Behold én: {mengdeTekst(vurdering.behold)}
                  </label>
                </fieldset>
              )}
              {planResultat?.kan && (
                <p className={styles.resultat}>
                  Resultat: {navn} · {mengdeTekst(planResultat.plan.resultatMengde)}.{" "}
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
