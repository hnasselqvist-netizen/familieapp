import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@components/Card";
import { RoomHeader } from "@components/RoomHeader";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import {
  type KontrollFilter,
  type Sortering,
  filtrerKontrollrader,
  kontrollrader,
} from "@domain/forsoning/kontrollrader";
import {
  type OversiktTilstand,
  STANDARD_TILSTAND,
  erstatterHistorikk,
} from "@domain/forsoning/oversiktUrl";
import { finnHendelseForTransaksjon } from "@domain/forsoning/fordeling";
import { PANEL_FLATE, useMediaQuery } from "@hooks/useMediaQuery";
import {
  KONTOER,
  type PostGrupper,
  SEKSJON_LABEL,
  type Seksjon,
  UKLAR_AARSAK_LABEL,
  arbeidsko,
  erUplassert,
  finnMuligDublett,
  filtrerPaKonto,
  loesEffektivStatus,
  maanedAlternativer,
  radKvittering,
} from "@domain/forsoning/transaksjonsoversikt";
import type { LiquidityPost } from "@app-types/liquidity";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import type { KontrollMerke, Transaksjonskontroll } from "@app-types/kvalitetssikring";
import { BeslutningPanel } from "./BeslutningPanel";
import { ImportPanel } from "./ImportPanel";
import { KontrollOversikt } from "./KontrollOversikt";
import { ManuellRegistreringPanel } from "./ManuellRegistreringPanel";
import { TransaksjonDetalj, type VentendeForkast } from "./TransaksjonDetalj";
import styles from "./TransaksjonsoversiktScreen.module.css";

export interface TransaksjonsoversiktViewProps extends PostGrupper {
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  receipts: KvitteringRecord[];
  rules: RegelRecord[];
  /** Likviditetsprognosens poster — importens «forslag til match» (R3b-2). */
  liquidityPosts?: LiquidityPost[];
  /** Den felles forsoningsporten (`hooks/forsoningAktivering.ts`) — `false` til R3b-cutover. */
  skrivingAktiv?: boolean;
  /** Skriver en beslutning (R3b-1). Brukes bare når `skrivingAktiv`. */
  onUtfor?: (endring: Beslutningsendring) => Promise<void>;
  /** Køen som åpnes først, f.eks. fra Forvaltning-forsiden (`?ko=forslag`). */
  startSeksjon?: Seksjon;
  /** Åpner importpanelet direkte, f.eks. fra Lønnsdagsrunden (`?verktoy=import`). */
  startMedImport?: boolean;
  /** «Kvalitetssikret» per transaksjons-ID (#59, 6542594363). */
  kontroller?: ReadonlyMap<string, Transaksjonskontroll>;
  onSettKvalitetssikring?: (
    transaksjonId: string,
    grunnlag: string,
    forventet: KontrollMerke | null,
    kvalitetssikret: boolean,
  ) => Promise<void>;
  /**
   * Visning, filtre, sortering og valgt transaksjon (#59, PC-2). Gitt =
   * styrt av forelderen (URL-en); ellers eier viewet tilstanden selv.
   */
  tilstand?: OversiktTilstand;
  /** `replace`: et søk i gang fortsetter — ingen ny historikkoppføring. */
  onTilstand?: (ny: OversiktTilstand, valg: { replace: boolean }) => void;
  /**
   * Meldes synkront når en korrigering åpnes eller avsluttes, så forelderen
   * kan holde igjen navigasjon (tilbake/frem, lenker) som ville forkastet
   * utkastet i stillhet.
   */
  onKorrigerer?: (aktiv: boolean) => void;
  /** Holdt igjen navigasjon som venter på brukerens valg, eller `null`. */
  navigasjonVenter?: { fortsett: () => void; forkast: () => void } | null;
}

// Legacy `fmtD`/`fmtB` (~6553): dag + kort måned, hele kroner.
const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";
const fmtB = (n: number) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n);

const SEKSJONER: Seksjon[] = ["vurdering", "forslag", "paavent"];
const INGEN_KONTROLLER: ReadonlyMap<string, Transaksjonskontroll> = new Map();

/**
 * Transaksjoner — ren visning (§Issue #34 R3-les), portert fra legacy
 * `BankimportScreen` (`index.html` ~6483–8330): arbeidskøen «Til
 * behandling» (samme tre faner, tellere og kontofilter) og
 * kontrolloversikten «Alle transaksjoner» (samme filtre, sortering og
 * tilstandstekster). Ingen import, plassering, på vent, intern
 * overføring, ignorering, kvittering, korrigering eller «Kjør regler» —
 * de skriver forsoningsnodene og blir i legacy til R3b-cutover (ADR 0002).
 */
export function TransaksjonsoversiktView({
  transaksjoner,
  hendelser,
  receipts,
  rules,
  budgetGroups,
  incomeGroups,
  sparingGroups,
  liquidityPosts = [],
  skrivingAktiv = false,
  onUtfor,
  startSeksjon = "vurdering",
  startMedImport = false,
  kontroller = INGEN_KONTROLLER,
  onSettKvalitetssikring,
  tilstand: styrt,
  onTilstand,
  onKorrigerer,
  navigasjonVenter = null,
}: TransaksjonsoversiktViewProps) {
  const [verktoy, setVerktoy] = useState<null | "import" | "manuell">(
    startMedImport ? "import" : null,
  );
  const kanBehandle = skrivingAktiv && !!onUtfor;
  const [apenId, setApenId] = useState<string | null>(null);
  const [seksjon, setSeksjon] = useState<Seksjon>(startSeksjon);
  const [valgtKonto, setValgtKonto] = useState("alle");
  // Visning, filter, sortering og valg (PC-1/PC-2) ligger over layouten —
  // i URL-en når forelderen styrer — så de overlever modusbytte,
  // layoutbytte (tabell/kort, panel/ark), korrigering og reload.
  const [egen, setEgen] = useState<OversiktTilstand>(STANDARD_TILSTAND);
  const tilstand = styrt ?? egen;
  const settTilstand = (ny: OversiktTilstand) => {
    if (onTilstand) onTilstand(ny, { replace: erstatterHistorikk(tilstand, ny) });
    else setEgen(ny);
  };
  const modus = tilstand.visning;
  const { filter, sortering, valgt } = tilstand;
  const setModus = (m: "behandling" | "alle") =>
    settTilstand({ ...tilstand, visning: m, valgt: m === "alle" ? valgt : null });
  const setFilter = (f: KontrollFilter) => settTilstand({ ...tilstand, filter: f });
  const setSortering = (s: Sortering) => settTilstand({ ...tilstand, sortering: s });

  // Detaljpanelet (PC-2): én aktiv detalj og ett korrigeringsskjema. Et
  // ulagret utkast forkastes aldri i stillhet ved lukking eller radbytte.
  const side = useMediaQuery(PANEL_FLATE);
  const [korrigerer, setKorrigererLokal] = useState(false);
  const setKorrigerer = (aktiv: boolean) => {
    onKorrigerer?.(aktiv);
    setKorrigererLokal(aktiv);
  };
  const [ventende, setVentende] = useState<
    null | { type: "lukk" } | { type: "bytt"; id: string; korriger: boolean }
  >(null);
  const fokusTilbake = useRef<string | null>(null);
  const aapne = (id: string | null, korriger = false) => {
    setVentende(null);
    // Utkastet er forkastet (eller fantes ikke) før navigasjonen, så
    // forelderens navigasjonsvakt ikke holder igjen et valg brukeren har tatt.
    setKorrigerer(false);
    if (id === null && valgt) fokusTilbake.current = valgt;
    settTilstand({ ...tilstand, visning: "alle", valgt: id });
    if (korriger) setKorrigerer(true);
  };
  const velg = (id: string, korriger = false) => {
    if (utkast && id !== valgt) setVentende({ type: "bytt", id, korriger });
    else if (id === valgt) setKorrigerer(korriger || korrigerer);
    else aapne(id, korriger);
  };
  const lukk = () => (utkast ? setVentende({ type: "lukk" }) : aapne(null));
  // Fokus tilbake til raden som åpnet detaljene.
  useEffect(() => {
    if (valgt || !fokusTilbake.current) return;
    const knapp = document.querySelector<HTMLElement>(
      `[data-velg-id="${CSS.escape(fokusTilbake.current)}"]`,
    );
    fokusTilbake.current = null;
    knapp?.focus();
  }, [valgt]);

  const grupper = useMemo(
    () => ({ budgetGroups, incomeGroups, sparingGroups }),
    [budgetGroups, incomeGroups, sparingGroups],
  );
  const ko = useMemo(
    () => arbeidsko(transaksjoner, hendelser, rules),
    [transaksjoner, hendelser, rules],
  );
  const maaneder = useMemo(() => maanedAlternativer(transaksjoner), [transaksjoner]);
  const rader = useMemo(
    () => kontrollrader(transaksjoner, hendelser, receipts, rules, grupper, kontroller),
    [transaksjoner, hendelser, receipts, rules, grupper, kontroller],
  );
  const synlige = filtrerPaKonto(ko[seksjon], valgtKonto);
  const valgtRad = valgt ? rader.find((r) => r.id === valgt) : undefined;
  const valgtT = valgt ? transaksjoner.find((t) => t.id === valgt) : undefined;
  const valgtHendelse = (valgtT && finnHendelseForTransaksjon(hendelser, valgtT.id)) || undefined;
  const skjultAvFilter = !!valgtRad && !filtrerKontrollrader([valgtRad], filter).length;
  // Forsvinner hendelsen (slettet et annet sted), finnes det ikke noe utkast
  // å verne: panelet sier fra, og verken radbytte eller navigasjon holdes igjen.
  const utkast = korrigerer && !!valgtHendelse;
  useEffect(() => {
    if (korrigerer && !utkast) onKorrigerer?.(false);
  }, [korrigerer, utkast, onKorrigerer]);
  const ventendeVisning: VentendeForkast | null = navigasjonVenter
    ? { type: "naviger" }
    : !ventende
      ? null
      : ventende.type === "lukk"
        ? { type: "lukk" }
        : {
            type: "bytt",
            tekst: rader.find((r) => r.id === ventende.id)?.tekst || "(uten tekst)",
          };

  // Den brede flaten (PC-1) er for kontrolloversikten. Køene og
  // verktøyene beholder kolonnebredden de er laget for.
  return (
    <div className={modus === "alle" ? undefined : styles.smalFlate}>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Transaksjoner"
        description={`${transaksjoner.length} importert`}
      />

      {!kanBehandle && (
        <div className={styles.notis} role="note">
          Kun visning. Import, plassering, på vent, intern overføring, kvitteringer og korrigering
          gjøres fortsatt i den gamle appen.
        </div>
      )}

      {kanBehandle && (
        <>
          <div className={`${styles.verktoy} ${styles.smalFlate}`}>
            <button
              type="button"
              aria-pressed={verktoy === "import"}
              className={styles.sekundar}
              onClick={() => setVerktoy(verktoy === "import" ? null : "import")}
            >
              {verktoy === "import" ? "✕ Lukk" : "＋ Importer fil"}
            </button>
            <button
              type="button"
              aria-pressed={verktoy === "manuell"}
              className={styles.sekundar}
              onClick={() => setVerktoy(verktoy === "manuell" ? null : "manuell")}
            >
              + Registrer manuelt
            </button>
          </div>
          <div className={styles.smalFlate}>
            {verktoy === "import" && (
              <ImportPanel
                transaksjoner={transaksjoner}
                rules={rules}
                liquidityPosts={liquidityPosts}
                onUtfor={onUtfor!}
                onFerdig={() => {
                  setVerktoy(null);
                  setModus("behandling");
                  setSeksjon("vurdering");
                }}
              />
            )}
            {verktoy === "manuell" && (
              <ManuellRegistreringPanel
                budgetGroups={budgetGroups}
                incomeGroups={incomeGroups}
                sparingGroups={sparingGroups}
                onUtfor={onUtfor!}
                onLukk={() => setVerktoy(null)}
              />
            )}
          </div>
        </>
      )}

      {transaksjoner.length === 0 ? (
        <div className={styles.tom}>Ingen transaksjoner importert ennå.</div>
      ) : (
        <>
          <div
            className={`${styles.modusvelger} ${styles.smalFlate}`}
            role="group"
            aria-label="Visning"
          >
            <button
              type="button"
              aria-pressed={modus === "behandling"}
              className={modus === "behandling" ? styles.modusAktiv : styles.modus}
              onClick={() => setModus("behandling")}
            >
              Til behandling
            </button>
            <button
              type="button"
              aria-pressed={modus === "alle"}
              className={modus === "alle" ? styles.modusAktiv : styles.modus}
              onClick={() => setModus("alle")}
            >
              Alle transaksjoner
            </button>
          </div>

          {modus === "behandling" && (
            <>
              <div className={styles.chips} role="group" aria-label="Konto">
                {KONTOER.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    aria-pressed={valgtKonto === k.id}
                    className={valgtKonto === k.id ? styles.chipAktiv : styles.chip}
                    onClick={() => setValgtKonto(k.id)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              <div className={styles.faner} role="tablist" aria-label="Arbeidskø">
                {SEKSJONER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={seksjon === s}
                    className={seksjon === s ? styles.faneAktiv : styles.fane}
                    onClick={() => setSeksjon(s)}
                  >
                    {SEKSJON_LABEL[s]}
                    {ko[s].length > 0 && <span className={styles.teller}>{ko[s].length}</span>}
                  </button>
                ))}
              </div>

              {synlige.length === 0 ? (
                <div className={styles.tom}>Ingen hendelser i denne kategorien.</div>
              ) : (
                <Card>
                  {synlige.map((t) =>
                    kanBehandle ? (
                      <div key={t.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          className={styles.koRadKnapp}
                          aria-expanded={apenId === t.id}
                          onClick={() => setApenId(apenId === t.id ? null : t.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setApenId(apenId === t.id ? null : t.id);
                            }
                          }}
                        >
                          <KoRad
                            t={t}
                            hendelser={hendelser}
                            receipts={receipts}
                            rules={rules}
                            dublett={
                              seksjon === "paavent"
                                ? finnMuligDublett(t, transaksjoner, hendelser, rules)
                                : null
                            }
                          />
                        </div>
                        {apenId === t.id && (
                          <BeslutningPanel
                            t={t}
                            transaksjoner={transaksjoner}
                            hendelser={hendelser}
                            rules={rules}
                            budgetGroups={budgetGroups}
                            incomeGroups={incomeGroups}
                            sparingGroups={sparingGroups}
                            onUtfor={onUtfor!}
                            onLukk={() => setApenId(null)}
                          />
                        )}
                      </div>
                    ) : (
                      <KoRad
                        key={t.id}
                        t={t}
                        hendelser={hendelser}
                        receipts={receipts}
                        rules={rules}
                        dublett={
                          seksjon === "paavent"
                            ? finnMuligDublett(t, transaksjoner, hendelser, rules)
                            : null
                        }
                      />
                    ),
                  )}
                </Card>
              )}
            </>
          )}

          {modus === "alle" && (
            <div className={valgt && side ? styles.medPanel : undefined}>
              <div className={styles.listeKolonne}>
                <KontrollOversikt
                  rader={rader}
                  maaneder={maaneder}
                  filter={filter}
                  onFilter={setFilter}
                  sortering={sortering}
                  onSortering={setSortering}
                  kanBehandle={kanBehandle}
                  valgtId={valgt}
                  onVelg={(id) => velg(id)}
                  onKorriger={(hendelseId) => {
                    const r = rader.find((x) => x.hendelseId === hendelseId);
                    if (r) velg(r.id, true);
                  }}
                  onKvalitetssikring={
                    kanBehandle && onSettKvalitetssikring
                      ? (r, kvalitetssikret) =>
                          onSettKvalitetssikring(
                            r.id,
                            r.kontroll.grunnlag,
                            r.kontroll.gjeldende,
                            kvalitetssikret,
                          )
                      : undefined
                  }
                />
              </div>
              {valgt && (
                <TransaksjonDetalj
                  id={valgt}
                  rad={valgtRad}
                  skjultAvFilter={skjultAvFilter}
                  t={valgtT}
                  hendelse={valgtHendelse}
                  rules={rules}
                  receipts={receipts}
                  side={side}
                  korrigering={
                    kanBehandle ? { transaksjoner, rules, ...grupper, onUtfor: onUtfor! } : null
                  }
                  korrigerer={korrigerer}
                  onKorriger={() => setKorrigerer(true)}
                  onAvsluttKorrigering={() => setKorrigerer(false)}
                  ventende={ventendeVisning}
                  onAvvisForkast={() =>
                    navigasjonVenter ? navigasjonVenter.fortsett() : setVentende(null)
                  }
                  onBekreftForkast={() => {
                    if (navigasjonVenter) {
                      setVentende(null);
                      setKorrigerer(false);
                      navigasjonVenter.forkast();
                    } else if (ventende?.type === "bytt") aapne(ventende.id, ventende.korriger);
                    else aapne(null);
                  }}
                  onLukk={lukk}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Radhodet fra legacy `VisRad` (~7356–7400), uten detaljpanelet (det er beslutningsflaten). */
function KoRad({
  t,
  hendelser,
  receipts,
  rules,
  dublett = null,
}: {
  t: TransaksjonRecord;
  hendelser: HendelseRecord[];
  receipts: KvitteringRecord[];
  rules: RegelRecord[];
  /** «På vent» (#66): en mulig tvilling, så brukeren kan se og ignorere dubletter. */
  dublett?: ReturnType<typeof finnMuligDublett>;
}) {
  const s = loesEffektivStatus(t, hendelser, rules);
  const kv = radKvittering(t, hendelser, receipts);
  const nk = normaliserKonto(t);
  const inn = t.retning === "inn";
  return (
    <div className={t.status === "krever_vurdering" ? styles.koRadVurdering : styles.koRad}>
      <span className={inn ? styles.fortegnInn : styles.fortegnUt} aria-hidden>
        {inn ? "+" : "-"}
      </span>
      <span className={styles.koTekst}>
        <span className={styles.tekst}>
          {t.tekst || "(ukjent)"}
          {(s.erPlassert || s.erPaaVent) && (
            <span className={s.erPaaVent ? styles.merkeVent : styles.merkeFerdig}>
              {s.erPaaVent ? "På vent" : "Plassert"}
            </span>
          )}
          {erUplassert(s) && <span className={styles.merkeVent}>ikke fordelt</span>}
          {s.erFlerbruk && <span className={styles.merkeVent}>flerbruk</span>}
          {kv.lagtTil && <span className={styles.merkeFerdig}>Kvittering lagt til</span>}
          {!kv.lagtTil && kv.koblet && <span className={styles.merkeFerdig}>Kvittering</span>}
        </span>
        <span className={styles.radInfo}>
          {fmtD(t.dato)}
          {nk ? " · " + nk : ""}
          {s.visningNavn ? " · →" + s.visningNavn : ""}
          {s.erPaaVent ? " · " + (UKLAR_AARSAK_LABEL[s.paaVentAarsak ?? ""] || "venter") : ""}
        </span>
        {dublett && (
          <span className={styles.dublett}>
            Mulig dublett av «{dublett.tvilling.tekst || "(ukjent)"}»
            {dublett.plassert ? " (plassert)" : ""}. Ignorer den hvis det stemmer.
          </span>
        )}
      </span>
      <span className={inn ? styles.belopInn : styles.belopUt}>{fmtB(t.belop)}</span>
    </div>
  );
}
