import { useMemo, useState } from "react";
import { Card } from "@components/Card";
import { RoomHeader } from "@components/RoomHeader";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { finnHendelseForTransaksjon } from "@domain/forsoning/fordeling";
import {
  KONTOER,
  type PostGrupper,
  SEKSJON_LABEL,
  type Seksjon,
  type TilstandKategori,
  UKLAR_AARSAK_LABEL,
  arbeidsko,
  beskrivTilstand,
  erUplassert,
  filtrerAlleTransaksjoner,
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
import { KorrigerHendelseModal } from "../korrigering/KorrigerHendelseModal";
import { BeslutningPanel } from "./BeslutningPanel";
import { ImportPanel } from "./ImportPanel";
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
}

// Legacy `fmtD`/`fmtB` (~6553): dag + kort måned, hele kroner.
const fmtD = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";
const fmtB = (n: number) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n);

const SEKSJONER: Seksjon[] = ["vurdering", "forslag", "paavent"];

const KATEGORI_CLASS: Record<TilstandKategori, string | undefined> = {
  ferdig: styles.toneFerdig,
  pa_vent: styles.toneVent,
  forslag: styles.toneVent,
  matchet_uten_hendelse: styles.toneAvvik,
  krever_vurdering: styles.toneAvvik,
  intern: styles.toneNoytral,
  ignorert: styles.toneDempet,
  uferdig: styles.toneDempet,
};

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
}: TransaksjonsoversiktViewProps) {
  const [verktoy, setVerktoy] = useState<null | "import" | "manuell">(
    startMedImport ? "import" : null,
  );
  const kanBehandle = skrivingAktiv && !!onUtfor;
  const [apenId, setApenId] = useState<string | null>(null);
  const [modus, setModus] = useState<"behandling" | "alle">("behandling");
  const [seksjon, setSeksjon] = useState<Seksjon>(startSeksjon);
  const [valgtKonto, setValgtKonto] = useState("alle");
  const [maaned, setMaaned] = useState("alle");
  const [konto, setKonto] = useState("alle");
  const [sok, setSok] = useState("");
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
  const filtrert = useMemo(
    () => filtrerAlleTransaksjoner(transaksjoner, { maaned, konto, sok }),
    [transaksjoner, maaned, konto, sok],
  );
  const synlige = filtrerPaKonto(ko[seksjon], valgtKonto);

  return (
    <div>
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
          <div className={styles.verktoy}>
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
        </>
      )}

      {transaksjoner.length === 0 ? (
        <div className={styles.tom}>Ingen transaksjoner importert ennå.</div>
      ) : (
        <>
          <div className={styles.modusvelger} role="group" aria-label="Visning">
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
                          <KoRad t={t} hendelser={hendelser} receipts={receipts} rules={rules} />
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
                      />
                    ),
                  )}
                </Card>
              )}
            </>
          )}

          {modus === "alle" && (
            <>
              <div className={styles.filtre}>
                <select
                  aria-label="Måned"
                  className={styles.valg}
                  value={maaned}
                  onChange={(e) => setMaaned(e.target.value)}
                >
                  {maaneder.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Konto"
                  className={styles.valg}
                  value={konto}
                  onChange={(e) => setKonto(e.target.value)}
                >
                  {KONTOER.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="search"
                aria-label="Søk i tekst"
                className={styles.sok}
                placeholder="Søk i tekst…"
                value={sok}
                onChange={(e) => setSok(e.target.value)}
              />
              <div className={styles.antall}>
                {filtrert.length} av {transaksjoner.length} transaksjoner
              </div>

              {filtrert.length === 0 ? (
                <div className={styles.tom}>Ingen transaksjoner matcher filtrene.</div>
              ) : (
                <Card>
                  {filtrert.map((t) => {
                    const tilstand = beskrivTilstand(t, hendelser, rules, grupper);
                    return (
                      <div key={t.id} className={styles.rad}>
                        <div className={styles.radTopp}>
                          <span className={styles.tekst}>{t.tekst || "(uten tekst)"}</span>
                          <span className={t.retning === "inn" ? styles.belopInn : styles.belop}>
                            {t.retning === "inn" ? "+" : "-"}
                            {fmtB(t.belop)} kr
                          </span>
                        </div>
                        <div className={styles.radInfo}>
                          {fmtD(t.dato)} · {normaliserKonto(t)}
                        </div>
                        <div className={KATEGORI_CLASS[tilstand.kategori]}>
                          <span className={styles.tilstand}>{tilstand.tekst}</span>
                        </div>
                        {tilstand.detaljer.map((d, i) => (
                          <div key={i} className={styles.detalj}>
                            {d}
                          </div>
                        ))}
                        {kanBehandle &&
                          (tilstand.kategori === "ferdig" || tilstand.kategori === "pa_vent") && (
                            <button
                              type="button"
                              className={styles.korrigerKnapp}
                              aria-label={`Korriger kobling ${t.tekst || "(uten tekst)"}`}
                              onClick={() =>
                                setKorrigerHendelseId(
                                  finnHendelseForTransaksjon(hendelser, t.id)?.id ?? null,
                                )
                              }
                            >
                              Korriger kobling
                            </button>
                          )}
                      </div>
                    );
                  })}
                </Card>
              )}
            </>
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
}: {
  t: TransaksjonRecord;
  hendelser: HendelseRecord[];
  receipts: KvitteringRecord[];
  rules: RegelRecord[];
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
      </span>
      <span className={inn ? styles.belopInn : styles.belopUt}>{fmtB(t.belop)}</span>
    </div>
  );
}
