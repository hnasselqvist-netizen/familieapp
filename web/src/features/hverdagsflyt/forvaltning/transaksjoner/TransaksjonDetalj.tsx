import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import type { KontrollRad } from "@domain/forsoning/kontrollrader";
import { KONTROLLSTATUS_LABEL } from "@domain/forsoning/kvalitetssikring";
import {
  type HendelseKonflikt,
  KVITTERING_VEI_LABEL,
  kvitteringerForTransaksjon,
  regelgrunnlag,
} from "@domain/forsoning/transaksjonDetalj";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import {
  KorrigerHendelseSkjema,
  type KorrigerHendelseSkjemaProps,
} from "../korrigering/KorrigerHendelseModal";
import { KvitteringVedlegg } from "../kvitteringer/KvitteringVedlegg";
import { eierTekst, fmtDato, fmtOre } from "./kontrollFormat";
import styles from "./TransaksjonDetalj.module.css";
import type { Lagreutfall } from "./TransaksjonsoversiktView";

/** Ulagret korrigering som ville gått tapt: brukeren velger synlig. */
export type VentendeForkast = (
  | { type: "lukk" }
  | { type: "bytt"; tekst: string }
  /** Tilbake/frem, en lenke eller annen navigasjon bort fra valget. */
  | { type: "naviger" }
) & {
  /**
   * Korrigeringen lagres nå. En sendt lagring kan ikke forkastes: handlingen
   * venter på utfallet (eller avbrytes med «Bli her»).
   */
  lagrer: boolean;
};

/** Den aktive korrigeringen for denne transaksjonen. */
export interface PanelSesjon {
  id: number;
  /** Hendelsen slik den var da korrigeringen startet. */
  grunnlag: HendelseRecord;
  lagrer: boolean;
}

export interface TransaksjonDetaljProps {
  /** Stabil transaksjons-ID fra valget (URL). */
  id: string;
  /** Raden slik den er nå, uavhengig av filteret; `undefined` = finnes ikke. */
  rad: KontrollRad | undefined;
  /** Raden finnes, men filteret skjuler den i listen. */
  skjultAvFilter: boolean;
  t: TransaksjonRecord | undefined;
  hendelse: HendelseRecord | undefined;
  rules: readonly RegelRecord[];
  receipts: readonly KvitteringRecord[];
  /** `true`: sidepanel ved tabellen. `false`: ark over tabellen (dialog). */
  side: boolean;
  /** Skjemaets avhengigheter når korrigering er mulig, ellers `null`. */
  korrigering: Omit<
    KorrigerHendelseSkjemaProps,
    "hendelse" | "onLagret" | "onAvbryt" | "lagringSperret"
  > | null;
  /** Aktiv korrigering for denne transaksjonen, eller `null`. */
  sesjon: PanelSesjon | null;
  /** Grunnlaget er endret siden korrigeringen startet. */
  konflikt: HendelseKonflikt | null;
  /** Faktisk utfall av siste lagring. */
  utfall: Lagreutfall | null;
  onKorriger: () => void;
  onStartPaaNytt: () => void;
  onAvsluttKorrigering: () => void;
  ventende: VentendeForkast | null;
  onBekreftForkast: () => void;
  onAvvisForkast: () => void;
  onLukk: () => void;
}

/**
 * Detaljer for én transaksjon (#59, PC-2, ordre 6647608110): sidepanel når
 * det er plass, ellers et ark over tabellen. Elementet er det samme i
 * begge layoutene, så et breddebytte monterer ikke innholdet på nytt og et
 * korrigeringsutkast står. Tabellen bak forblir montert.
 */
const KONFLIKT_TEKST: Record<HendelseKonflikt, string> = {
  slettet: "Hendelsen finnes ikke lenger, så korrigeringen kan ikke lagres.",
  erstattet:
    "Transaksjonen har fått en annen hendelse siden du startet korrigeringen. Utkastet ditt lagres ikke over den.",
  endret:
    "Hendelsen er endret et annet sted siden du startet korrigeringen. Utkastet ditt lagres ikke over endringen.",
};

export function TransaksjonDetalj(p: TransaksjonDetaljProps) {
  const { id, rad, t, side } = p;
  const tittelId = useId();
  const overskrift = useRef<HTMLHeadingElement>(null);
  // Fokus til panelet når en (ny) transaksjon åpnes.
  useEffect(() => {
    overskrift.current?.focus();
  }, [id]);

  // Et ventende forkast-valg får fokus på det trygge valget; når valget er
  // avgjort og panelet står, går fokus tilbake til panelet (ikke tapt i body).
  const seksjon = useRef<HTMLElement>(null);
  const fortsett = useRef<HTMLButtonElement>(null);
  const harVentende = p.ventende !== null;
  const forrigeVentende = useRef(harVentende);
  useEffect(() => {
    if (harVentende) fortsett.current?.focus();
    else if (forrigeVentende.current && !seksjon.current?.contains(document.activeElement)) {
      overskrift.current?.focus();
    }
    forrigeVentende.current = harVentende;
  }, [harVentende]);

  // «Lagre» er sperret under lagring og mister fokus: fokus holdes i
  // panelet, så Escape og Tab fortsatt virker der.
  const lagrer = !!p.sesjon?.lagrer;
  useEffect(() => {
    if (!lagrer) return;
    const aktiv = document.activeElement as HTMLButtonElement | null;
    if (!seksjon.current?.contains(aktiv) || aktiv?.disabled) overskrift.current?.focus();
  }, [lagrer]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      p.onLukk();
      return;
    }
    // Arket er modalt: Tab går rundt inne i det.
    if (e.key === "Tab" && !side && seksjon.current) {
      const fokuserbare = [
        ...seksjon.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
        ),
      ];
      const forste = fokuserbare[0];
      const siste = fokuserbare[fokuserbare.length - 1];
      if (!forste || !siste) return;
      const aktiv = document.activeElement;
      if (e.shiftKey && (aktiv === forste || aktiv === overskrift.current)) {
        e.preventDefault();
        siste.focus();
      } else if (!e.shiftKey && aktiv === siste) {
        e.preventDefault();
        forste.focus();
      }
    }
  };
  const tekst = rad?.tekst || t?.tekst || "(uten tekst)";

  return (
    <section
      ref={seksjon}
      className={side ? styles.side : styles.ark}
      role={side ? "region" : "dialog"}
      aria-modal={side ? undefined : true}
      aria-labelledby={tittelId}
      data-detaljpanel=""
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (!side && e.target === e.currentTarget) p.onLukk();
      }}
    >
      <div className={styles.kort}>
        <header className={styles.topp}>
          <h2 id={tittelId} ref={overskrift} tabIndex={-1} className={styles.tittel}>
            {rad ? tekst : "Transaksjon"}
          </h2>
          <button
            type="button"
            className={styles.lukk}
            aria-label="Lukk detaljer"
            onClick={p.onLukk}
          >
            ✕
          </button>
        </header>

        {p.ventende?.lagrer && (
          <div className={styles.varsel} role="alert">
            <p>
              Korrigeringen lagres.{" "}
              {p.ventende.type === "bytt"
                ? `«${p.ventende.tekst}» åpnes når lagringen er ferdig.`
                : p.ventende.type === "naviger"
                  ? "Du går videre når lagringen er ferdig."
                  : "Detaljene lukkes når lagringen er ferdig."}
            </p>
            <div className={styles.knapper}>
              <button
                ref={fortsett}
                type="button"
                className={styles.sekundar}
                onClick={p.onAvvisForkast}
              >
                Bli her
              </button>
            </div>
          </div>
        )}
        {p.ventende && !p.ventende.lagrer && (
          <div className={styles.varsel} role="alert">
            <p>
              Du har en ulagret korrigering.{" "}
              {p.ventende.type === "bytt"
                ? `Vil du forkaste den og åpne «${p.ventende.tekst}»?`
                : p.ventende.type === "naviger"
                  ? "Vil du forkaste den og gå videre?"
                  : "Vil du forkaste den og lukke detaljene?"}
            </p>
            <div className={styles.knapper}>
              <button
                ref={fortsett}
                type="button"
                className={styles.sekundar}
                onClick={p.onAvvisForkast}
              >
                Fortsett korrigering
              </button>
              <button type="button" className={styles.primar} onClick={p.onBekreftForkast}>
                Forkast utkastet
              </button>
            </div>
          </div>
        )}

        {p.utfall && (
          <p
            className={p.utfall.type === "lagret" ? styles.dempet : styles.varselTekst}
            role="status"
          >
            {p.utfall.type === "lagret"
              ? `Korrigeringen av «${p.utfall.tekst}» er lagret.`
              : `Lagringen av korrigeringen av «${p.utfall.tekst}» feilet. Utkastet står${
                  p.utfall.byttAvbrutt ? ", og byttet ble ikke gjort" : ""
                }.`}
          </p>
        )}

        {!rad || !t ? (
          <p className={styles.dempet} role="status">
            Transaksjonen finnes ikke lenger, eller lenken er ugyldig. Ingenting annet er åpnet.
          </p>
        ) : (
          <Innhold {...p} rad={rad} t={t} />
        )}
      </div>
    </section>
  );
}

function Innhold({
  rad,
  t,
  hendelse,
  rules,
  receipts,
  skjultAvFilter,
  korrigering,
  sesjon,
  konflikt,
  onKorriger,
  onStartPaaNytt,
  onAvsluttKorrigering,
}: TransaksjonDetaljProps & { rad: KontrollRad; t: TransaksjonRecord }) {
  const regel = regelgrunnlag(t, hendelse, rules);
  const kv = kvitteringerForTransaksjon(t, hendelse ?? null, receipts);
  return (
    <>
      {skjultAvFilter && (
        <p className={styles.dempet} role="note">
          Filteret skjuler denne transaksjonen i listen.
        </p>
      )}
      <dl className={styles.felter}>
        <div>
          <dt>Banktekst</dt>
          <dd>{t.tekst || "(uten tekst)"}</dd>
        </div>
        <div>
          <dt>Dato</dt>
          <dd>{fmtDato(rad.dato)}</dd>
        </div>
        <div>
          <dt>Konto</dt>
          <dd>{rad.konto || "—"}</dd>
        </div>
        <div>
          <dt>Beløp</dt>
          <dd>
            {fmtOre(rad.belopOre)} ({rad.belopOre >= 0 ? "inn" : "ut"})
          </dd>
        </div>
        <div>
          <dt>Behandling</dt>
          <dd>{rad.statusTekst}</dd>
        </div>
        <div>
          <dt>Kvalitetssikring</dt>
          <dd>{KONTROLLSTATUS_LABEL[rad.kontroll.status]}</dd>
        </div>
      </dl>

      <h3 className={styles.underTittel}>Fordeling</h3>
      {rad.fordelinger.length === 0 ? (
        <p className={styles.dempet}>Ikke fordelt.</p>
      ) : (
        <ul className={styles.liste} aria-label="Fordeling">
          {rad.fordelinger.map((f, i) => (
            <li key={i}>
              {f.postTekst} · {fmtOre(f.belopOre)} · {eierTekst(f)}
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.underTittel}>Regel</h3>
      <div className={styles.blokk}>
        {regel.type === "regel" && (
          <>
            <p>
              «{regel.regel.pattern || regel.regel.normalizedPattern || "(uten mønster)"}» →{" "}
              {regel.regel.targetName || "—"}
            </p>
            <p className={styles.dempet}>
              Viser regelen slik den er nå. Den kan være endret siden den ble brukt.
            </p>
          </>
        )}
        {regel.type === "regel_slettet" && <p>Plassert av en regel som ikke finnes lenger.</p>}
        {regel.type === "laert_forslag" && (
          <p>
            Forslag fra læring: {regel.navn}
            {regel.gruppe ? ` (${regel.gruppe})` : ""}
            {regel.flerbruk ? " · flerbruk" : ""}
          </p>
        )}
        {regel.type === "ingen" && <p className={styles.dempet}>Ingen regel.</p>}
      </div>

      <h3 className={styles.underTittel}>Kvitteringer og vedlegg</h3>
      <div className={styles.blokk}>
        {kv.koblet.length === 0 && <p className={styles.dempet}>Ingen kvittering koblet.</p>}
        {kv.koblet.length > 1 && (
          <p className={styles.varselTekst} role="note">
            {kv.koblet.length} kvitteringer er koblet til denne transaksjonen.
          </p>
        )}
        {kv.koblet.map(({ kvittering: r, veier }) => (
          <div key={r.id} className={styles.kvittering}>
            <p>
              {r.merchant || "Kvittering"}
              {r.purchaseDate ? ` · ${fmtDato(r.purchaseDate)}` : ""}
              {typeof r.total === "number" ? ` · ${fmtOre(-Math.round(r.total * 100))}` : ""}
            </p>
            <p className={styles.dempet}>{veier.map((v) => KVITTERING_VEI_LABEL[v]).join(", ")}</p>
            <KvitteringVedlegg r={r} />
          </div>
        ))}
        {kv.forkastet > 0 && (
          <p className={styles.dempet}>
            {kv.forkastet} forkastet kvittering{kv.forkastet === 1 ? "" : "er"} vises ikke.
          </p>
        )}
      </div>

      {/* En åpen korrigering vises også når grunnlaget er endret eller borte. */}
      {korrigering && (rad.kanKorrigeres || sesjon) && (
        <div className={styles.blokk}>
          {!sesjon ? (
            hendelse && (
              <button type="button" className={styles.primar} onClick={onKorriger}>
                Korriger kobling
              </button>
            )
          ) : (
            <section aria-label="Korriger kobling" className={styles.korriger}>
              <h3 className={styles.underTittel}>Korriger kobling</h3>
              <p className={styles.dempet}>
                Endrer bare denne hendelsen. Regler endres bare hvis du huker av «Lær denne
                koblingen».
              </p>
              {konflikt && (
                <div className={styles.varsel} role="alert">
                  <p>{KONFLIKT_TEKST[konflikt]}</p>
                  <div className={styles.knapper}>
                    {konflikt !== "slettet" && (
                      <button type="button" className={styles.primar} onClick={onStartPaaNytt}>
                        Start på nytt fra gjeldende
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.sekundar}
                      onClick={onAvsluttKorrigering}
                    >
                      {konflikt === "slettet" ? "Lukk korrigeringen" : "Forkast utkastet"}
                    </button>
                  </div>
                </div>
              )}
              {/* Nøklet på sesjonen: live-endringer remonterer aldri utkastet. */}
              <KorrigerHendelseSkjema
                key={sesjon.id}
                {...korrigering}
                hendelse={sesjon.grunnlag}
                lagringSperret={!!konflikt}
                onLagret={() => undefined}
                onAvbryt={onAvsluttKorrigering}
              />
            </section>
          )}
        </div>
      )}
    </>
  );
}
