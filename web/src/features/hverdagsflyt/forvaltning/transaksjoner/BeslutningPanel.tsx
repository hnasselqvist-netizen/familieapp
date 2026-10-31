import { useMemo, useState } from "react";
import { BUDGET_EIER } from "@domain/budsjettfamilie/budsjettfamilie";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import {
  type Beslutningsendring,
  brukOgUtvidRegel,
  lagreBehandling,
  lagreInternOverforing,
  merkFlerbruk,
  settStatus,
  utvidRegelForslag,
} from "@domain/forsoning/beslutning";
import { jevnFordelEiere } from "@domain/forsoning/fordeling";
import { ansvarTekst, kontoForLaering, kontoNavn } from "@domain/forsoning/regelsenter";
import { belopMatcherIOre, normaliserTransaksjonstekst } from "@domain/forsoning/tekst";
import {
  finnInterneOverforingsKandidater,
  kontoUlik,
  retningMotsatt,
} from "@domain/forsoning/internOverforing";
import {
  type PlasseringsPost,
  type UtkastLinje,
  allePoster,
  finnKandidater,
  restPaaSisteLinje,
  startFordelinger,
} from "@domain/forsoning/plasseringsvalg";
import { type PostGrupper, loesEffektivStatus } from "@domain/forsoning/transaksjonsoversikt";
import type {
  Eierandel,
  HendelseRecord,
  MalPost,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { KontoVilkarValg } from "@components/KontoVilkarValg";
import styles from "./TransaksjonsoversiktScreen.module.css";

export interface BeslutningPanelProps extends PostGrupper {
  t: TransaksjonRecord;
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  rules: RegelRecord[];
  /** Skriver endringen (felles helnode-skriver bak forsoningsporten). */
  onUtfor: (endring: Beslutningsendring) => Promise<void>;
  onLukk: () => void;
}

const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";
const fmtB = (n: number) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n);
const fmt = (n: number) => `${fmtB(n)} kr`;

const PAA_VENT_VALG: [string, string][] = [
  ["venter_paa_kvittering", "🧾 Venter på kvittering"],
  ["maa_splittes", "✂️ Må splittes"],
  ["maa_avklares", "🤔 Må avklares"],
  ["annet", "💭 Annet"],
];

/**
 * Beslutningspanelet for én transaksjon i arbeidskøen (§Issue #34 R3b-1),
 * portert fra legacy VisRad (`index.html` ~7176–7870): plassering med
 * kandidater og søk, splitt med restbeløp på siste linje, ansvar per linje,
 * «Lær denne koblingen» med «bruk og utvid», på vent med årsak, intern
 * overføring med motpart, «Merk flerbruk», Ignorer og Lagre.
 *
 * Vises bare når forsoningsporten er på (R3b-cutover). Ikke portert:
 * «Legg til kvittering» (base64 i `receipts`) under på vent — åpent valg i
 * `docs/arkitektur/r3b-cutover.md` §7.
 */
export function BeslutningPanel({
  t,
  transaksjoner,
  hendelser,
  rules,
  budgetGroups,
  incomeGroups,
  sparingGroups,
  onUtfor,
  onLukk,
}: BeslutningPanelProps) {
  const grupper = useMemo(
    () => ({ budgetGroups, incomeGroups, sparingGroups }),
    [budgetGroups, incomeGroups, sparingGroups],
  );
  const effektivStatus = loesEffektivStatus(t, hendelser, rules);
  const [type, setType] = useState<null | "uklar" | "intern_overforing">(
    effektivStatus.erPaaVent ? "uklar" : null,
  );
  const [fordelinger, setFordelinger] = useState<UtkastLinje[]>(() =>
    startFordelinger(t, effektivStatus.harHendelse, grupper, () => crypto.randomUUID()),
  );
  const [visLeggTil, setVisLeggTil] = useState(false);
  const [laer, setLaer] = useState(false);
  const [bareKonto, setBareKonto] = useState(false);
  const [uklar, setUklar] = useState<string | null>(effektivStatus.paaVentAarsak ?? null);
  const [motpart, setMotpart] = useState<TransaksjonRecord | null>(null);
  const [sok, setSok] = useState("");
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState(false);

  const poster = useMemo(() => allePoster(grupper, new Date().getMonth()), [grupper]);
  const valgte = new Set(fordelinger.map((f) => f.post.id));
  const sokNorm = sok.trim().toLowerCase();
  const kandidater =
    type === null ? finnKandidater(t, poster).filter((k) => !valgte.has(k.id)) : [];
  const sokTreff = sokNorm
    ? poster.filter((p) => p.name.toLowerCase().includes(sokNorm) && !valgte.has(p.id))
    : [];
  const overforingKandidater =
    type === "intern_overforing" ? finnInterneOverforingsKandidater(t, transaksjoner) : [];
  const overforingSokTreff =
    type === "intern_overforing" && sokNorm
      ? transaksjoner.filter(
          (o) =>
            o.id !== t.id &&
            !o.motpartTransaksjonId &&
            (o.tekst || "").toLowerCase().includes(sokNorm),
        )
      : [];
  const visPicker = type === null && (fordelinger.length === 0 || visLeggTil);
  const fordeltSum = fordelinger.reduce((s, f) => s + (f.belop || 0), 0);
  const kanLagre =
    type === "uklar" || (type === "intern_overforing" && !!motpart) || fordelinger.length > 0;
  const kontoILaering = kontoForLaering(t);
  const laerKonto = laer && bareKonto ? kontoILaering : null;
  const utvid = laer ? utvidRegelForslag(rules, t, fordelinger, transaksjoner, laerKonto) : null;
  const naa = () => new Date().toISOString();

  const utfor = async (endring: Beslutningsendring, lukk: boolean) => {
    setLagrer(true);
    setFeil(false);
    try {
      await onUtfor(endring);
      if (lukk) onLukk();
    } catch (err) {
      console.error("[Beslutning] Feilet:", err);
      setFeil(true);
    } finally {
      setLagrer(false);
    }
  };

  const leggTil = (post: MalPost) => {
    const nye = [
      ...fordelinger,
      { id: crypto.randomUUID(), post, belop: 0, eiere: jevnFordelEiere([post.eier || "Felles"]) },
    ];
    setFordelinger(restPaaSisteLinje(nye, t.belop || 0));
    setVisLeggTil(false);
    setSok("");
  };
  const oppdaterBelop = (idx: number, belop: number) =>
    setFordelinger(
      restPaaSisteLinje(
        fordelinger.map((f, i) => (i !== idx ? f : { ...f, belop })),
        t.belop || 0,
      ),
    );
  const fjern = (idx: number) => {
    const nye = fordelinger.filter((_, i) => i !== idx);
    setFordelinger(nye.length > 0 ? restPaaSisteLinje(nye, t.belop || 0) : nye);
  };
  const settEiere = (idx: number, eiere: Eierandel[]) =>
    setFordelinger(fordelinger.map((f, i) => (i !== idx ? f : { ...f, eiere })));

  const lagre = () => {
    if (type === "intern_overforing" && motpart) {
      void utfor(lagreInternOverforing(t.id, motpart.id, naa()), true);
      return;
    }
    void utfor(
      lagreBehandling(
        { transaksjoner, hendelser, rules },
        t.id,
        {
          type: type === "uklar" ? "uklar" : "plassert",
          fordelinger,
          laer,
          laerKonto,
          uklarValg: uklar,
        },
        { newId: () => crypto.randomUUID(), naa: naa() },
      ),
      true,
    );
  };

  const postRad = (p: PlasseringsPost, info: string) => (
    <button key={p.id} type="button" className={styles.valgRad} onClick={() => leggTil(p)}>
      <span className={styles.valgTekst}>
        <span className={styles.valgNavn}>{p.name}</span>
        <span className={styles.radInfo}>{info}</span>
      </span>
      <span className={styles.valgHandling}>Velg</span>
    </button>
  );

  return (
    <div className={styles.panel} role="group" aria-label={`Behandle ${t.tekst || "transaksjon"}`}>
      <div className={styles.panelHode}>
        <div className={t.retning === "inn" ? styles.panelBelopInn : styles.panelBelop}>
          {t.retning === "inn" ? "+" : ""}
          {fmtB(t.belop)} kr
        </div>
        <div className={styles.panelTekst}>{t.tekst || "(ukjent)"}</div>
        <div className={styles.radInfo}>
          {fmtD(t.dato)}
          {normaliserKonto(t) ? " · " + normaliserKonto(t) : ""}
        </div>
      </div>

      {type === null && (
        <div className={styles.panelSeksjon}>
          {fordelinger.map((f, idx) => {
            const flere = fordelinger.length > 1;
            const siste = flere && idx === fordelinger.length - 1;
            return (
              <div key={f.id} className={styles.fordeling}>
                <div className={styles.fordelingTopp}>
                  <span className={styles.valgTekst}>
                    <span className={styles.fordelingNavn}>{f.post.name}</span>
                    <span className={styles.radInfo}>{f.post.gruppe}</span>
                  </span>
                  {flere &&
                    (siste ? (
                      <span className={styles.belopVis}>{fmtB(f.belop || 0)}</span>
                    ) : (
                      <BelopFelt
                        verdi={f.belop}
                        etikett={`Beløp for ${f.post.name}`}
                        onSave={(v) => oppdaterBelop(idx, v)}
                      />
                    ))}
                  <button type="button" className={styles.lenkeKnapp} onClick={() => fjern(idx)}>
                    {flere ? "✕" : "Endre"}
                  </button>
                </div>
                <div className={styles.chips} role="group" aria-label={`Ansvar for ${f.post.name}`}>
                  {BUDGET_EIER.map((person) => {
                    const valgt = f.eiere.find((e) => e.person === person);
                    return (
                      <button
                        key={person}
                        type="button"
                        aria-pressed={!!valgt}
                        className={valgt ? styles.chipAktiv : styles.chip}
                        onClick={() => {
                          const naaListe = f.eiere.map((e) => e.person);
                          const erValgt = naaListe.includes(person);
                          if (erValgt && naaListe.length === 1) return;
                          settEiere(
                            idx,
                            jevnFordelEiere(
                              erValgt
                                ? naaListe.filter((p) => p !== person)
                                : [...naaListe, person],
                            ),
                          );
                        }}
                      >
                        {person}
                        {valgt && f.eiere.length > 1 ? ` ${valgt.prosent}%` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {fordelinger.length > 1 && (
            <div
              className={
                Math.round(fordeltSum * 100) === Math.round((t.belop || 0) * 100)
                  ? styles.radInfo
                  : styles.toneVent
              }
            >
              Fordelt: {fmt(fordeltSum)} av {fmt(t.belop || 0)}
            </div>
          )}

          {visPicker && (
            <>
              {kandidater.length > 0 && (
                <div className={styles.valgListe} aria-label="Forslag">
                  {kandidater
                    .slice(0, 5)
                    .map((k) =>
                      postRad(
                        k,
                        `${k.gruppe}${k._tekstMatch && k._belopMatch ? " · tekst+belop" : k._tekstMatch ? " · tekst" : " · belop"}`,
                      ),
                    )}
                </div>
              )}
              <input
                type="search"
                className={styles.sok}
                aria-label="Søk blant poster"
                placeholder="Søk blant budsjett-/inntekts-/spareposter…"
                autoComplete="off"
                value={sok}
                onChange={(e) => setSok(e.target.value)}
              />
              {sokTreff.length > 0 && (
                <div className={styles.valgListe}>
                  {sokTreff.slice(0, 20).map((p) => postRad(p, p.gruppe ?? ""))}
                </div>
              )}
              {sokNorm && sokTreff.length === 0 && (
                <div className={styles.radInfo}>Ingen treff.</div>
              )}
              {fordelinger.length > 0 && (
                <button
                  type="button"
                  className={styles.lenkeKnapp}
                  onClick={() => {
                    setVisLeggTil(false);
                    setSok("");
                  }}
                >
                  Avbryt
                </button>
              )}
            </>
          )}

          {!visPicker && fordelinger.length > 0 && (
            <>
              <button type="button" className={styles.sekundar} onClick={() => setVisLeggTil(true)}>
                ✂️ Del opp i flere plasseringer
              </button>
              <label className={styles.laer}>
                <input type="checkbox" checked={laer} onChange={(e) => setLaer(e.target.checked)} />
                <span>
                  <span className={styles.valgNavn}>Lær denne koblingen</span>
                  <span className={styles.radInfo}>
                    Fremtidige hendelser fra samme mønster kobles automatisk.
                    {fordelinger.length > 0 &&
                      ` Regelen husker posten og ansvaret: ${fordelinger[0]!.post.name} · ${ansvarTekst(fordelinger[0]!.eiere)}.`}
                  </span>
                </span>
              </label>
              {laer && kontoILaering && (
                <KontoVilkarValg
                  kontoNavn={kontoNavn(kontoILaering)}
                  bareKonto={bareKonto}
                  onChange={setBareKonto}
                />
              )}
            </>
          )}

          {utvid && utvid.utvidetMonster && (
            <div className={styles.utvid}>
              <div>
                Fins allerede en regel for <b>{utvid.regel.targetName}</b>: «{utvid.regel.pattern}».
                Utvidet til «{utvid.utvidetMonster}» vil også treffe {utvid.brukAntall} observasjon
                {utvid.brukAntall !== 1 ? "er" : ""}.
              </div>
              <button
                type="button"
                className={styles.sekundar}
                disabled={lagrer}
                onClick={() => void utfor(brukOgUtvidRegel(utvid, naa()), false)}
              >
                Bruk og utvid eksisterende regel
              </button>
            </div>
          )}

          {fordelinger.length === 0 && (
            <div className={styles.sekundarer}>
              <button type="button" className={styles.sekundar} onClick={() => setType("uklar")}>
                ⏸️ Sett denne på vent i stedet
              </button>
              <button
                type="button"
                className={styles.sekundar}
                onClick={() => setType("intern_overforing")}
              >
                ↔️ Registrer som intern overføring
              </button>
            </div>
          )}
        </div>
      )}

      {type === "intern_overforing" && (
        <div className={styles.panelSeksjon}>
          <button
            type="button"
            className={styles.lenkeKnapp}
            onClick={() => {
              setType(null);
              setMotpart(null);
              setSok("");
            }}
          >
            ← Tilbake til plassering
          </button>
          <div className={styles.seksjonTittel}>Bekreft denne interne overføringen</div>
          <div className={styles.radInfo}>
            Velg transaksjonen på den andre kontoen som representerer samme overføring.
          </div>
          {!motpart && (
            <>
              {overforingKandidater.length > 0 && (
                <div className={styles.valgListe}>
                  {overforingKandidater.slice(0, 5).map((k) => (
                    <MotpartRad key={k.transaction.id} o={k.transaction} onVelg={setMotpart} />
                  ))}
                </div>
              )}
              <input
                type="search"
                className={styles.sok}
                aria-label="Søk blant andre hendelser"
                placeholder="Søk blant andre hendelser…"
                autoComplete="off"
                value={sok}
                onChange={(e) => setSok(e.target.value)}
              />
              {overforingSokTreff.length > 0 && (
                <div className={styles.valgListe}>
                  {overforingSokTreff.slice(0, 20).map((o) => (
                    <MotpartRad
                      key={o.id}
                      o={o}
                      onVelg={(x) => {
                        setMotpart(x);
                        setSok("");
                      }}
                    />
                  ))}
                </div>
              )}
              {sokNorm && overforingSokTreff.length === 0 && (
                <div className={styles.radInfo}>Ingen treff.</div>
              )}
            </>
          )}
          {motpart && (
            <>
              <div className={styles.fordeling}>
                <div className={styles.fordelingTopp}>
                  <span className={styles.valgTekst}>
                    <span className={styles.fordelingNavn}>
                      {motpart.tekst} · {fmt(motpart.belop || 0)}
                    </span>
                    <span className={styles.radInfo}>
                      {fmtD(motpart.dato)} · {normaliserKonto(motpart)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.lenkeKnapp}
                    onClick={() => setMotpart(null)}
                  >
                    Endre
                  </button>
                </div>
              </div>
              {!(
                retningMotsatt(t, motpart) &&
                belopMatcherIOre(t.belop, motpart.belop) &&
                kontoUlik(t, motpart)
              ) && (
                <div className={styles.toneVent} role="note">
                  ⚠️ Beløp, fortegn eller konto stemmer ikke med vanlige krav for en intern
                  overføring — kontroller at dette er riktig før du lagrer.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {type === "uklar" && (
        <div className={styles.panelSeksjon}>
          <button type="button" className={styles.lenkeKnapp} onClick={() => setType(null)}>
            ← Tilbake til plassering
          </button>
          <div className={styles.seksjonTittel}>Hva mangler før denne kan plasseres?</div>
          <div className={styles.chips} role="group" aria-label="Årsak">
            {PAA_VENT_VALG.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={uklar === id}
                className={uklar === id ? styles.chipAktiv : styles.chip}
                onClick={() => setUklar(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {effektivStatus.harLaertRegel && !effektivStatus.erFlerbruk && (
        <button
          type="button"
          className={styles.lenkeKnapp}
          disabled={lagrer}
          onClick={() =>
            void utfor(merkFlerbruk(normaliserTransaksjonstekst(t.tekst), naa()), false)
          }
        >
          Merk leverandør som flerbruk (stopper autolæring)
        </button>
      )}

      {feil && <div className={styles.toneAvvik}>⚠ Noe gikk galt. Se konsollen for detaljer.</div>}

      <div className={styles.handlinger}>
        <button type="button" className={styles.sekundar} onClick={onLukk} disabled={lagrer}>
          Avbryt
        </button>
        {t.status !== "ignorert" && (
          <button
            type="button"
            className={styles.sekundar}
            disabled={lagrer}
            onClick={() => void utfor(settStatus(t.id, "ignorert"), true)}
          >
            Ignorer
          </button>
        )}
        <button
          type="button"
          className={styles.primar}
          onClick={lagre}
          disabled={!kanLagre || lagrer}
        >
          {lagrer ? "Lagrer…" : "Lagre"}
        </button>
      </div>
    </div>
  );
}

function MotpartRad({
  o,
  onVelg,
}: {
  o: TransaksjonRecord;
  onVelg: (o: TransaksjonRecord) => void;
}) {
  return (
    <button type="button" className={styles.valgRad} onClick={() => onVelg(o)}>
      <span className={styles.valgTekst}>
        <span className={styles.valgNavn}>
          {o.tekst} · {fmt(o.belop || 0)}
        </span>
        <span className={styles.radInfo}>
          {fmtD(o.dato)} · {normaliserKonto(o)}
        </span>
      </span>
      <span className={styles.valgHandling}>Velg</span>
    </button>
  );
}

/** Legacy `BelopFelt` (~9494): lagres ved blur/Enter, komma godtas. */
function BelopFelt({
  verdi,
  etikett,
  onSave,
}: {
  verdi: number;
  etikett: string;
  onSave: (v: number) => void;
}) {
  const [utkast, setUtkast] = useState(String(verdi ?? 0));
  const [forrige, setForrige] = useState(verdi);
  if (forrige !== verdi) {
    setForrige(verdi);
    setUtkast(String(verdi ?? 0));
  }
  const lagre = () => onSave(parseFloat(String(utkast).replace(",", ".")) || 0);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={etikett}
      className={styles.belopFelt}
      value={utkast}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setUtkast(e.target.value)}
      onBlur={lagre}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
