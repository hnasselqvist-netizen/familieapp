import { useMemo, useState } from "react";
import { Card } from "@components/Card";
import { RoomHeader } from "@components/RoomHeader";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import {
  type KontrollFilter,
  STANDARD_SORTERING,
  type Sortering,
  TOMT_FILTER,
  kontrollrader,
} from "@domain/forsoning/kontrollrader";
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
import { KorrigerHendelseModal } from "../korrigering/KorrigerHendelseModal";
import { BeslutningPanel } from "./BeslutningPanel";
import { ImportPanel } from "./ImportPanel";
import { KontrollOversikt } from "./KontrollOversikt";
import { ManuellRegistreringPanel } from "./ManuellRegistreringPanel";
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
}: TransaksjonsoversiktViewProps) {
  const [verktoy, setVerktoy] = useState<null | "import" | "manuell">(
    startMedImport ? "import" : null,
  );
  const kanBehandle = skrivingAktiv && !!onUtfor;
  const [apenId, setApenId] = useState<string | null>(null);
  const [modus, setModus] = useState<"behandling" | "alle">("behandling");
  const [seksjon, setSeksjon] = useState<Seksjon>(startSeksjon);
  const [valgtKonto, setValgtKonto] = useState("alle");
  // «Alle transaksjoner» (PC-1): filter og sortering eies her, så de
  // overlever modusbytte, layoutbytte (tabell/kort) og korrigering.
  const [filter, setFilter] = useState<KontrollFilter>(TOMT_FILTER);
  const [sortering, setSortering] = useState<Sortering>(STANDARD_SORTERING);
  // Legacy `korrigerHendelseId` (~6506): «Korriger kobling» i «Alle transaksjoner» (R3b-4).
  const [korrigerHendelseId, setKorrigerHendelseId] = useState<string | null>(null);
  const hendelseSomKorrigeres = korrigerHendelseId
    ? hendelser.find((h) => h.id === korrigerHendelseId)
    : undefined;

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
            <KontrollOversikt
              rader={rader}
              maaneder={maaneder}
              filter={filter}
              onFilter={setFilter}
              sortering={sortering}
              onSortering={setSortering}
              kanBehandle={kanBehandle}
              onKorriger={setKorrigerHendelseId}
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
          )}
        </>
      )}
      {kanBehandle && hendelseSomKorrigeres && (
        <KorrigerHendelseModal
          hendelse={hendelseSomKorrigeres}
          transaksjoner={transaksjoner}
          rules={rules}
          {...grupper}
          onUtfor={onUtfor!}
          onLagret={() => setKorrigerHendelseId(null)}
          onClose={() => setKorrigerHendelseId(null)}
        />
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
