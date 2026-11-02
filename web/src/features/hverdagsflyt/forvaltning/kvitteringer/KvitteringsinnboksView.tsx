import { useRef, useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { Modal } from "@components/Modal";
import { RoomHeader } from "@components/RoomHeader";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { calculateSplitTotal } from "@domain/forsoning/kvittering";
import {
  KONFLIKT_TEKST,
  type Konflikt,
  type TvungetHandling,
  kobleKvittering,
} from "@domain/forsoning/kvitteringSkriving";
import {
  foreslattTransaksjon,
  getDisplayDescription,
  type KvitteringStatusTone,
  kvitteringStatus,
} from "@domain/forsoning/kvitteringsinnboks";
import type {
  Eierandel,
  HendelseRecord,
  KvitteringRecord,
  MalPost,
  TransaksjonRecord,
} from "@app-types/forsoning";
import styles from "./KvitteringsinnboksScreen.module.css";
import { NyKvitteringPanel, RedigerKvittering } from "./KvitteringPaneler";
import {
  type LagreVarelinjer,
  type VarelinjeStatus,
  VarelinjerRedigering,
  VarelinjerVisning,
} from "./Varelinjer";
import { KvitteringVedlegg } from "./KvitteringVedlegg";

export interface KvitteringsinnboksViewProps {
  /** Alle kvitteringer (også forkastede og ferdige) — kun til «N registrert». */
  alle: KvitteringRecord[];
  /** Kvitteringene som krever en beslutning, med forslag beregnet i minnet. */
  aktive: KvitteringRecord[];
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  /** Kvitteringens plasserbare poster (kostnad + inntekt). */
  poster?: MalPost[];
  /** Den felles forsoningsporten (R3b-3). Av: ren visning, som i R2. */
  skrivingAktiv?: boolean;
  onUtfor?: (endring: Beslutningsendring) => Promise<void>;
  /** Lagrer beskrivende varelinjer (#59, C). Uten den vises de bare. */
  onLagreVarelinjer?: LagreVarelinjer;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 2,
  }).format(n);
const fmtD = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" })
    : "—";
const eiereTekst = (eiere: Eierandel[] | undefined) =>
  (eiere && eiere.length > 0 ? eiere : [{ person: "Felles", prosent: 100 }])
    .map((e) => e.person + (e.prosent < 100 ? ` ${e.prosent}%` : ""))
    .join(", ");

const TONE_CLASS: Record<KvitteringStatusTone, string | undefined> = {
  ferdig: styles.toneFerdig,
  koblet: styles.toneVent,
  foreslatt: styles.toneVent,
  ikke_koblet: styles.toneDempet,
};

const REN: VarelinjeStatus = { ulagret: false, lagrer: false };

/**
 * Kvitteringsinnboks (§Issue #34 R2), portert fra legacy
 * `KvitteringInnboksScreen`/`KvitteringDetalj` (`index.html` ~5528–6471):
 * samme utvalg (ikke forkastet, uten ferdig hendelse), samme sortering,
 * statustekst og forslag.
 *
 * Med forsoningsporten på (R3b-3): ny kvittering, kobling til foreslått
 * transaksjon med legacy sine konflikter og valg, redigering og forkasting.
 * Porten er av til R3b-cutover (ADR 0002); da er skjermen ren visning og
 * legacy er eneste skriver. Bildeopplasting til Google Drive er ikke portert.
 */
export function KvitteringsinnboksView({
  alle,
  aktive,
  transaksjoner,
  hendelser,
  poster = [],
  skrivingAktiv = false,
  onUtfor,
  onLagreVarelinjer,
}: KvitteringsinnboksViewProps) {
  const [apenId, setApenIdRa] = useState<string | null>(null);
  // Om vinduet ble åpnet fra innboksen (økonomisk redigering) eller fra
  // «ferdig behandlede» (bare varelinjer). Låst ved åpning, så vinduet ikke
  // bytter innhold under brukeren hvis kvitteringen blir ferdig koblet.
  const [apenRediger, setApenRediger] = useState(false);
  const setApenId = (id: string | null, rediger = false) => {
    setApenIdRa(id);
    setApenRediger(rediger);
    setVakt(null);
    setKvitteringLagret(false);
    meldVarelinjer(REN);
  };
  // Lukkevern (#105, review 5732762680): varelinjeutkastet eies av
  // varelinjeeditoren. Ingen vei ut av vinduet (Lagre endringer, Forkast,
  // Lukk, ✕, bakgrunnen) får kaste et ulagret utkast eller en pågående
  // lagring stille. Varelinjer lagres aldri som bieffekt; brukeren lagrer
  // dem selv eller forkaster dem eksplisitt.
  const [vlStatus, setVlStatus] = useState<VarelinjeStatus>(REN);
  const vlStatusRef = useRef<VarelinjeStatus>(REN);
  const meldVarelinjer = (s: VarelinjeStatus) => {
    vlStatusRef.current = s;
    setVlStatus(s);
    if (!s.ulagret && !s.lagrer) setVakt(null);
  };
  const [vakt, setVakt] = useState<"lukk" | "lagret" | "forkastet" | null>(null);
  const [kvitteringLagret, setKvitteringLagret] = useState(false);
  const provLukk = (grunn: "lukk" | "lagret" | "forkastet") => {
    if (grunn === "lagret") setKvitteringLagret(true);
    const s = vlStatusRef.current;
    if (s.ulagret || s.lagrer) {
      setVakt(grunn);
      return;
    }
    setApenId(null);
  };
  // Fra ALLE kvitteringer, ikke bare de aktive: blir den åpne kvitteringen
  // ferdig koblet eller forkastet på en annen enhet, forsvinner ikke vinduet
  // (og et ulagret varelinjeutkast) under brukeren (#59, C).
  const apen = apenId ? alle.find((r) => r.id === apenId) : undefined;
  const [visFerdige, setVisFerdige] = useState(false);
  const aktiveIder = new Set(aktive.map((r) => r.id));
  const ferdige = alle.filter((r) => !r.forkastet && !aktiveIder.has(r.id));
  const kanSkrive = skrivingAktiv && !!onUtfor;
  const [visNy, setVisNy] = useState(false);
  // Legacy `konflikter`: ett objekt per kvittering, vist inline i raden.
  const [konflikter, setKonflikter] = useState<Record<string, Konflikt>>({});
  const [radFeil, setRadFeil] = useState<string | null>(null);
  const [kobler, setKobler] = useState<string | null>(null);

  const koble = async (r: KvitteringRecord, transactionId: string, valg: TvungetHandling) => {
    if (!onUtfor) return;
    const utfall = kobleKvittering(
      { transaksjoner, hendelser, receipts: alle },
      r,
      transactionId,
      valg,
      {
        newId: () => crypto.randomUUID(),
        naa: new Date().toISOString(),
      },
    );
    if (!utfall.konflikt && !utfall.endring) return;
    const settKonflikt = (k: Konflikt | null) =>
      setKonflikter((prev) => {
        const n = { ...prev };
        if (k) n[r.id] = k;
        else delete n[r.id];
        return n;
      });
    setRadFeil(null);
    if (!utfall.endring) {
      settKonflikt(utfall.konflikt);
      return;
    }
    setKobler(r.id);
    try {
      await onUtfor(utfall.endring);
      settKonflikt(utfall.konflikt);
    } catch (err) {
      console.error("[Kvitteringsinnboks] Kobling feilet:", err);
      setRadFeil(r.id);
    } finally {
      setKobler(null);
    }
  };

  return (
    <div>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Kvitteringer"
        description={`${alle.length} registrert`}
      />

      {kanSkrive ? (
        <div className={styles.verktoy}>
          <Button variant={visNy ? "secondary" : "primary"} onClick={() => setVisNy((v) => !v)}>
            {visNy ? "✕ Lukk" : "＋ Ny kvittering"}
          </Button>
        </div>
      ) : (
        <div className={styles.notis} role="note">
          Kun visning. Kvitteringer registreres, redigeres, kobles og forkastes fortsatt i den gamle
          appen.
        </div>
      )}

      {kanSkrive && visNy && (
        <NyKvitteringPanel poster={poster} onUtfor={onUtfor!} onLukk={() => setVisNy(false)} />
      )}

      {aktive.length === 0 && !visNy && (
        <div className={styles.tom}>
          {alle.length === 0
            ? "Ingen kvitteringer registrert ennå."
            : "Ingen kvitteringer krever oppmerksomhet nå."}
        </div>
      )}

      {aktive.length > 0 && (
        <Card>
          {aktive.map((r) => {
            const status = kvitteringStatus(r, hendelser);
            const forslag = foreslattTransaksjon(r, transaksjoner);
            const antallSplitter = (r.splits || []).length;
            const konflikt = konflikter[r.id];
            return (
              <div key={r.id} className={styles.radBoks}>
                <button type="button" className={styles.rad} onClick={() => setApenId(r.id, true)}>
                  <span className={styles.ikon} aria-hidden>
                    <Icon name="receipt-text" size={18} />
                  </span>
                  <span className={styles.radTekst}>
                    <span className={styles.leverandor}>{r.merchant || "(ukjent leverandør)"}</span>
                    <span className={styles.radInfo}>
                      {fmtD(r.purchaseDate)} · {antallSplitter} splitt
                      {antallSplitter !== 1 ? "er" : ""} ·{" "}
                      <span className={TONE_CLASS[status.tone]}>{status.tekst}</span>
                    </span>
                  </span>
                  <span className={styles.belop}>{fmt(r.total || 0)}</span>
                  <Icon name="chevron-right" size={16} />
                </button>
                {forslag && !konflikt && (
                  <div className={styles.forslag}>
                    <span className={styles.forslagTekst}>
                      <span className={styles.forslagTittel}>Foreslått match</span>
                      <span>
                        {fmtD(forslag.dato)} · {forslag.tekst} · {fmt(forslag.belop || 0)}
                      </span>
                    </span>
                    {kanSkrive && (
                      <button
                        type="button"
                        className={styles.primar}
                        aria-label={`Koble ${r.merchant || "(ukjent leverandør)"}`}
                        disabled={kobler === r.id}
                        onClick={() => void koble(r, forslag.id, null)}
                      >
                        Koble
                      </button>
                    )}
                  </div>
                )}
                {konflikt && (
                  <div
                    className={konflikt.kunLenke ? styles.konfliktLenke : styles.konflikt}
                    role="status"
                  >
                    <span>
                      {(konflikt.kode && KONFLIKT_TEKST[konflikt.kode]) ||
                        "Kunne ikke fullføre koblingen."}
                    </span>
                    {konflikt.kode === "transaksjon_har_avvikende_actual" && (
                      <span className={styles.knapper}>
                        <button
                          type="button"
                          className={styles.primar}
                          disabled={kobler === r.id}
                          onClick={() => void koble(r, konflikt.transactionId, "bruk_kvittering")}
                        >
                          Bruk kvitteringens fordeling
                        </button>
                        <button
                          type="button"
                          className={styles.sekundar}
                          disabled={kobler === r.id}
                          onClick={() =>
                            void koble(r, konflikt.transactionId, "behold_eksisterende")
                          }
                        >
                          Behold eksisterende
                        </button>
                      </span>
                    )}
                    {konflikt.kunLenke && (
                      <button
                        type="button"
                        className={styles.sekundar}
                        disabled={kobler === r.id}
                        onClick={() => void koble(r, konflikt.transactionId, null)}
                      >
                        Prøv igjen
                      </button>
                    )}
                  </div>
                )}
                {radFeil === r.id && (
                  <div className={styles.konflikt} role="alert">
                    ⚠ Noe gikk galt. Se konsollen for detaljer.
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {ferdige.length > 0 && (
        <div className={styles.verktoy} style={{ justifyContent: "flex-start", marginTop: 14 }}>
          <button
            type="button"
            className={styles.sekundar}
            aria-expanded={visFerdige}
            onClick={() => setVisFerdige((v) => !v)}
          >
            {visFerdige ? "Skjul ferdig behandlede" : `Vis ferdig behandlede (${ferdige.length})`}
          </button>
        </div>
      )}
      {visFerdige && ferdige.length > 0 && (
        <Card>
          {ferdige.map((r) => (
            <div key={r.id} className={styles.radBoks}>
              <button type="button" className={styles.rad} onClick={() => setApenId(r.id)}>
                <span className={styles.ikon} aria-hidden>
                  <Icon name="receipt-text" size={18} />
                </span>
                <span className={styles.radTekst}>
                  <span className={styles.leverandor}>{r.merchant || "(ukjent leverandør)"}</span>
                  <span className={styles.radInfo}>
                    {fmtD(r.purchaseDate)} · <span className={styles.toneFerdig}>Ferdig</span>
                    {(r.varelinjer?.length ?? 0) > 0 && ` · ${r.varelinjer!.length} varelinjer`}
                  </span>
                </span>
                <span className={styles.belop}>{fmt(r.total || 0)}</span>
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          ))}
        </Card>
      )}

      {apen && (
        <Modal title={apen.merchant || "(ukjent leverandør)"} onClose={() => provLukk("lukk")}>
          {vakt && (vlStatus.ulagret || vlStatus.lagrer) && (
            <div className={styles.notis} role="alert">
              {vakt === "lagret" && "Endringene på kvitteringen er lagret. "}
              {vakt === "forkastet" && "Kvitteringen er forkastet. "}
              {vlStatus.lagrer
                ? "Varelinjene lagres nå. Vinduet lukkes ikke før lagringen er ferdig."
                : "Varelinjene du har skrevet, er ikke lagret. Lagre dem under, eller forkast dem."}
              <div className={styles.handlinger}>
                <Button variant="secondary" onClick={() => setVakt(null)}>
                  Fortsett med varelinjene
                </Button>
                <Button
                  variant="destructive"
                  disabled={vlStatus.lagrer}
                  onClick={() => setApenId(null)}
                >
                  Forkast varelinjene og lukk
                </Button>
              </div>
            </div>
          )}
          {kvitteringLagret && !vakt && (
            <div className={styles.notis} role="status">
              Endringene på kvitteringen er lagret.
            </div>
          )}
          {apen.forkastet && (
            <div className={styles.notis} role="status">
              Denne kvitteringen er forkastet, kanskje på en annen enhet. Det du har skrevet, står
              til du lukker vinduet.
            </div>
          )}
          {kanSkrive && apenRediger ? (
            <>
              <RedigerKvittering
                key={apen.id}
                r={apen}
                snapshot={{ transaksjoner, hendelser, receipts: alle }}
                poster={poster}
                onUtfor={onUtfor!}
                onLukk={() => provLukk("lukk")}
                onLagret={provLukk}
              />
              {onLagreVarelinjer ? (
                <VarelinjerRedigering
                  key={`vl-${apen.id}`}
                  r={apen}
                  lagre={onLagreVarelinjer}
                  onStatus={meldVarelinjer}
                />
              ) : (
                <VarelinjerVisning r={apen} />
              )}
            </>
          ) : (
            <>
              <KvitteringDetalj r={apen} />
              {kanSkrive && onLagreVarelinjer ? (
                <VarelinjerRedigering
                  key={`vl-${apen.id}`}
                  r={apen}
                  lagre={onLagreVarelinjer}
                  onStatus={meldVarelinjer}
                />
              ) : (
                <VarelinjerVisning r={apen} />
              )}
              <div className={styles.handlinger}>
                <Button variant="secondary" onClick={() => provLukk("lukk")}>
                  Lukk
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function KvitteringDetalj({ r }: { r: KvitteringRecord }) {
  const splitter = r.splits || [];
  const splitTotal = calculateSplitTotal(r);
  const diff = (r.total || 0) - splitTotal;
  return (
    <div>
      <KvitteringVedlegg r={r} />
      <dl className={styles.felter}>
        <div>
          <dt>Leverandør</dt>
          <dd>{r.merchant || "—"}</dd>
        </div>
        <div>
          <dt>Dato</dt>
          <dd>{fmtD(r.purchaseDate)}</dd>
        </div>
        <div>
          <dt>Totalbeløp</dt>
          <dd>{fmt(r.total || 0)}</dd>
        </div>
        <div>
          <dt>Behandling</dt>
          <dd>
            {r.allocationMode === "single"
              ? "Én post for hele kvitteringen"
              : r.allocationMode === "split"
                ? "Splittet på flere poster"
                : "Ikke valgt"}
          </dd>
        </div>
      </dl>

      {(r.allocationMode === "single" || r.allocationMode === "split") && splitter.length > 0 && (
        <ul className={styles.splitter} aria-label="Fordeling">
          {(r.allocationMode === "single" ? splitter.slice(0, 1) : splitter).map((sp, idx) => (
            <li key={idx} className={styles.splitt}>
              <span className={styles.splittTopp}>
                <span>{sp.targetName}</span>
                <span className={styles.belop}>{fmt(sp.amount || 0)}</span>
              </span>
              {getDisplayDescription(sp) && (
                <span className={styles.dempet}>{getDisplayDescription(sp)}</span>
              )}
              <span className={styles.dempet}>{eiereTekst(sp.eiere)}</span>
            </li>
          ))}
        </ul>
      )}

      {r.allocationMode === "split" && (
        <div className={diff === 0 ? styles.toneFerdig : styles.toneAvvik}>
          Splittsum: {fmt(splitTotal)} {diff !== 0 && `· gjenstår ${fmt(diff)}`}
        </div>
      )}
    </div>
  );
}
