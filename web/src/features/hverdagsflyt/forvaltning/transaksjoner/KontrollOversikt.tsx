import { type ReactNode, useState } from "react";
import { KONTROLLSTATUS_LABEL, type Kontrollstatus } from "@domain/forsoning/kvalitetssikring";
import { Card } from "@components/Card";
import {
  type KontrollFilter,
  type KontrollFordeling,
  type KontrollRad,
  type SorterKolonne,
  STANDARD_SORTERING,
  type Sortering,
  UTEN_EIER,
  filterValg,
  filtrerKontrollrader,
  sorterKontrollrader,
  summerUtvalg,
} from "@domain/forsoning/kontrollrader";
import { KONTOER, type TilstandKategori } from "@domain/forsoning/transaksjonsoversikt";
import { BRED_FLATE, useMediaQuery } from "@hooks/useMediaQuery";
import styles from "./TransaksjonsoversiktScreen.module.css";
import tabell from "./KontrollOversikt.module.css";
import { MassekontrollPanel } from "./MassekontrollPanel";

const KATEGORI_LABEL: Record<TilstandKategori, string> = {
  ferdig: "Ferdig",
  pa_vent: "På vent",
  forslag: "Forslag",
  krever_vurdering: "Krever vurdering",
  matchet_uten_hendelse: "Matchet uten hendelse",
  uferdig: "Uferdig",
  intern: "Intern overføring",
  ignorert: "Ignorert",
};

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

const KONTROLL_CLASS: Record<Kontrollstatus, string | undefined> = {
  ikke_kontrollert: styles.toneDempet,
  kvalitetssikret: styles.toneFerdig,
  endret_etter_kontroll: styles.toneAvvik,
};

const tall = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Eksakt beløp med øre og eksplisitt fortegn (+ inn, - ut). */
const fmtOre = (ore: number) => `${ore < 0 ? "-" : "+"}${tall.format(Math.abs(ore) / 100)} kr`;
/** `ÅÅÅÅ-MM-DD…` → `DD.MM.ÅÅÅÅ`, uten tidssone-tolkning. */
const fmtDato = (dato: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dato);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : dato || "—";
};
const eierTekst = (f: KontrollFordeling) =>
  f.eiere.length === 0
    ? "—"
    : f.eiere.map((e) => (e.prosent < 100 ? `${e.person} ${e.prosent} %` : e.person)).join(", ");

const KOLONNER: { id: SorterKolonne; navn: string; tall?: boolean }[] = [
  { id: "dato", navn: "Dato" },
  { id: "tekst", navn: "Tekst" },
  { id: "konto", navn: "Konto" },
  { id: "belop", navn: "Beløp", tall: true },
  { id: "post", navn: "Post" },
  { id: "eier", navn: "Kostnadseier" },
  { id: "status", navn: "Status" },
];

const MOBIL_SORTERING: { id: string; label: string; s: Sortering }[] = [
  { id: "dato-ned", label: "Nyeste først", s: { kolonne: "dato", synkende: true } },
  { id: "dato-opp", label: "Eldste først", s: { kolonne: "dato", synkende: false } },
  { id: "belop-opp", label: "Største utgift først", s: { kolonne: "belop", synkende: false } },
  { id: "belop-ned", label: "Største inntekt først", s: { kolonne: "belop", synkende: true } },
  { id: "tekst-opp", label: "Tekst A–Å", s: { kolonne: "tekst", synkende: false } },
];

export interface KontrollOversiktProps {
  rader: KontrollRad[];
  maaneder: { id: string; label: string }[];
  filter: KontrollFilter;
  onFilter: (f: KontrollFilter) => void;
  sortering: Sortering;
  onSortering: (s: Sortering) => void;
  kanBehandle: boolean;
  onKorriger: (hendelseId: string) => void;
  /**
   * Merker/opphever «kvalitetssikret» (#59, 6542594363). Mangler den,
   * vises bare status. Løses først når lagringen er bekreftet.
   */
  onKvalitetssikring?: (rad: KontrollRad, kvalitetssikret: boolean) => Promise<void>;
}

/**
 * «Alle transaksjoner» (#59, PC-1): kombinerte filtre, sortering og
 * antall/sum for utvalget, vist som semantisk tabell på bred flate og som
 * kort på smal — fra SAMME radmodell (`kontrollrader`). Bare én av dem
 * rendres, så ingen kontroller finnes to ganger. Filter og sortering eies
 * av forelderen og overlever layoutbytte og korrigering.
 */
export function KontrollOversikt({
  rader,
  maaneder,
  filter,
  onFilter,
  sortering,
  onSortering,
  kanBehandle,
  onKorriger,
  onKvalitetssikring,
}: KontrollOversiktProps) {
  const bred = useMediaQuery(BRED_FLATE);
  const valg = filterValg(rader);
  const utvalg = sorterKontrollrader(filtrerKontrollrader(rader, filter), sortering);
  const sum = summerUtvalg(utvalg);
  const sett = (endring: Partial<KontrollFilter>) => onFilter({ ...filter, ...endring });

  const [lagrer, setLagrer] = useState<ReadonlySet<string>>(() => new Set());
  const [kontrollFeil, setKontrollFeil] = useState<Record<string, string>>({});
  const settKontroll = async (r: KontrollRad, kvalitetssikret: boolean) => {
    if (!onKvalitetssikring) return;
    setLagrer((s) => new Set(s).add(r.id));
    setKontrollFeil((f) => {
      const n = { ...f };
      delete n[r.id];
      return n;
    });
    try {
      await onKvalitetssikring(r, kvalitetssikret);
    } catch (err) {
      console.error("[Kvalitetssikring] Lagring feilet:", err);
      setKontrollFeil((f) => ({
        ...f,
        [r.id]:
          err instanceof Error && err.name === "KontrollEndretAvAndre"
            ? err.message
            : "Kontrollen ble ikke lagret. Prøv igjen.",
      }));
    } finally {
      setLagrer((s) => {
        const n = new Set(s);
        n.delete(r.id);
        return n;
      });
    }
  };

  /**
   * Avhuking for «kvalitetssikret» (#59, 6544187094 / 6544189632): én boks
   * per transaksjon. Avhuket = kvalitetssikret på dagens grunnlag; tom boks
   * = ikke kontrollert, eller «Endret etter kontroll» (vises som tekst). Et
   * nytt avhuk bekrefter dagens grunnlag; fjernet hake opphever. Boksen er
   * styrt av lagret status, så haken vises først når lagringen er bekreftet.
   * Hvem og når lagres i kontrollsporet, men vises ikke.
   */
  const kontroll = (r: KontrollRad) => {
    const k = r.kontroll;
    const navn = r.tekst || "(uten tekst)";
    const opptatt = lagrer.has(r.id);
    const avhuket = k.status === "kvalitetssikret";
    return (
      <div className={tabell.kontroll}>
        <label
          className={tabell.avhuking}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className={tabell.boks}
            checked={avhuket}
            disabled={!onKvalitetssikring || opptatt}
            aria-busy={opptatt}
            aria-label={`Kvalitetssikret: ${navn}`}
            onChange={(e) => void settKontroll(r, e.target.checked)}
          />
          {!bred && <span>Kvalitetssikret</span>}
        </label>
        {opptatt && <span className={styles.radInfo}>Lagrer…</span>}
        {k.status === "endret_etter_kontroll" && (
          <span className={KONTROLL_CLASS[k.status]}>{KONTROLLSTATUS_LABEL[k.status]}</span>
        )}
        {kontrollFeil[r.id] && (
          <span className={styles.toneAvvik} role="alert">
            {kontrollFeil[r.id]}
          </span>
        )}
      </div>
    );
  };

  const korriger = (r: KontrollRad) =>
    kanBehandle && r.kanKorrigeres && r.hendelseId ? (
      <button
        type="button"
        className={styles.korrigerKnapp}
        aria-label={`Korriger kobling ${r.tekst || "(uten tekst)"}`}
        onClick={() => onKorriger(r.hendelseId!)}
      >
        Korriger kobling
      </button>
    ) : null;

  const ekstraFiltre = (
    <>
      <select
        aria-label="Kostnadseier"
        className={styles.valg}
        value={filter.eier}
        onChange={(e) => sett({ eier: e.target.value })}
      >
        <option value="alle">Alle kostnadseiere</option>
        {valg.eiere.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value={UTEN_EIER}>Uten fordeling</option>
      </select>
      <select
        aria-label="Post"
        className={styles.valg}
        value={filter.post}
        onChange={(e) => sett({ post: e.target.value })}
      >
        <option value="alle">Alle poster</option>
        {valg.poster.map((p) => (
          <option key={p.id} value={p.id}>
            {p.navn}
          </option>
        ))}
      </select>
      <select
        aria-label="Status"
        className={styles.valg}
        value={filter.status}
        onChange={(e) => sett({ status: e.target.value })}
      >
        <option value="alle">Alle statuser</option>
        {(Object.keys(KATEGORI_LABEL) as TilstandKategori[]).map((k) => (
          <option key={k} value={k}>
            {KATEGORI_LABEL[k]}
          </option>
        ))}
      </select>
      {!bred && (
        <select
          aria-label="Sorter"
          className={styles.valg}
          value={
            MOBIL_SORTERING.find(
              (m) => m.s.kolonne === sortering.kolonne && m.s.synkende === sortering.synkende,
            )?.id ?? ""
          }
          onChange={(e) => {
            const m = MOBIL_SORTERING.find((x) => x.id === e.target.value);
            if (m) onSortering(m.s);
          }}
        >
          {!MOBIL_SORTERING.some(
            (m) => m.s.kolonne === sortering.kolonne && m.s.synkende === sortering.synkende,
          ) && <option value="">Egendefinert sortering</option>}
          {MOBIL_SORTERING.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
  // Søk og aktive filtre som tekst, for bekreftelsen av «alle treff».
  const beskrivelse = [
    filter.sok.trim() && `søk «${filter.sok.trim()}»`,
    filter.maaned !== "alle" &&
      (maaneder.find((m) => m.id === filter.maaned)?.label ?? filter.maaned),
    filter.konto !== "alle" &&
      `konto ${KONTOER.find((k) => k.id === filter.konto)?.label ?? filter.konto}`,
    filter.eier !== "alle" &&
      (filter.eier === UTEN_EIER ? "uten fordeling" : `eier ${filter.eier}`),
    filter.post !== "alle" &&
      `post ${valg.poster.find((p) => p.id === filter.post)?.navn ?? filter.post}`,
    filter.status !== "alle" &&
      `status ${KATEGORI_LABEL[filter.status as TilstandKategori] ?? filter.status}`,
    filter.kontroll !== "alle" &&
      `kontroll ${KONTROLLSTATUS_LABEL[filter.kontroll as Kontrollstatus] ?? filter.kontroll}`,
  ].filter((x): x is string => !!x);
  const flereAktive =
    filter.eier !== "alle" ||
    filter.post !== "alle" ||
    filter.status !== "alle" ||
    sortering.kolonne !== STANDARD_SORTERING.kolonne ||
    sortering.synkende !== STANDARD_SORTERING.synkende;

  return (
    <>
      <div className={styles.filtre}>
        <select
          aria-label="Måned"
          className={styles.valg}
          value={filter.maaned}
          onChange={(e) => sett({ maaned: e.target.value })}
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
          value={filter.konto}
          onChange={(e) => sett({ konto: e.target.value })}
        >
          {KONTOER.map((k) => (
            <option key={k.id} value={k.id}>
              {k.id === "alle" ? "Alle kontoer" : k.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Kontroll"
          className={styles.valg}
          value={filter.kontroll}
          onChange={(e) => sett({ kontroll: e.target.value })}
        >
          <option value="alle">Alle kontrollstatuser</option>
          {(Object.keys(KONTROLLSTATUS_LABEL) as Kontrollstatus[]).map((k) => (
            <option key={k} value={k}>
              {KONTROLLSTATUS_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      {bred ? (
        <div className={styles.filtre}>{ekstraFiltre}</div>
      ) : (
        <FlereFiltre iBruk={flereAktive}>{ekstraFiltre}</FlereFiltre>
      )}
      <input
        type="search"
        aria-label="Søk i tekst"
        className={styles.sok}
        placeholder="Søk i tekst…"
        value={filter.sok}
        onChange={(e) => sett({ sok: e.target.value })}
      />
      {onKvalitetssikring && (
        <MassekontrollPanel
          utvalg={utvalg}
          rader={rader}
          beskrivelse={beskrivelse}
          onKvalitetssikring={onKvalitetssikring}
        />
      )}
      <div className={styles.antall} role="status">
        <span>
          {sum.antall} av {rader.length} transaksjoner
        </span>
        <span className={tabell.sum}>
          {" "}
          · inn {fmtOre(sum.innOre)} · ut {fmtOre(-sum.utOre)} · netto {fmtOre(sum.nettoOre)}
        </span>
      </div>

      {utvalg.length === 0 ? (
        <div className={styles.tom}>Ingen transaksjoner matcher filtrene.</div>
      ) : bred ? (
        <div className={tabell.ramme}>
          <table className={tabell.tabell}>
            <caption className={tabell.skjult}>
              Alle transaksjoner, sortert etter{" "}
              {KOLONNER.find((k) => k.id === sortering.kolonne)?.navn.toLowerCase()}
              {sortering.synkende ? " synkende" : " stigende"}
            </caption>
            <thead>
              <tr>
                {KOLONNER.map((k) => {
                  const aktiv = sortering.kolonne === k.id;
                  return (
                    <th
                      key={k.id}
                      scope="col"
                      className={k.tall ? tabell.tall : undefined}
                      aria-sort={
                        aktiv ? (sortering.synkende ? "descending" : "ascending") : undefined
                      }
                    >
                      <button
                        type="button"
                        className={tabell.sorter}
                        onClick={() =>
                          onSortering({
                            kolonne: k.id,
                            synkende: aktiv ? !sortering.synkende : k.id === "dato",
                          })
                        }
                      >
                        {k.navn}
                        <span aria-hidden className={tabell.pil}>
                          {aktiv ? (sortering.synkende ? "▼" : "▲") : ""}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th scope="col">Kvalitetssikret</th>
                {kanBehandle && (
                  <th scope="col">
                    <span className={tabell.skjult}>Handling</span>
                  </th>
                )}
              </tr>
            </thead>
            {utvalg.map((r) => {
              // Én <tbody> per transaksjon, og én underrad per splitt: post
              // og kostnadseier for samme fordeling står alltid i SAMME <tr>,
              // så de holder høyden sammen selv når teksten brytes (review
              // 6542071615). Transaksjonsfeltene spenner over underradene.
              const deler: (KontrollFordeling | null)[] =
                r.fordelinger.length > 0 ? r.fordelinger : [null];
              const span = deler.length;
              return (
                <tbody key={r.id} className={tabell.transaksjon}>
                  {deler.map((f, i) => (
                    <tr key={i}>
                      {i === 0 && (
                        <>
                          <td rowSpan={span} className={tabell.nowrap}>
                            {fmtDato(r.dato)}
                          </td>
                          <td rowSpan={span}>
                            <span className={styles.tekst}>{r.tekst || "(uten tekst)"}</span>
                            {r.kvittering && <span className={tabell.merke}>Kvittering</span>}
                          </td>
                          <td rowSpan={span}>{r.konto || "—"}</td>
                          <td
                            rowSpan={span}
                            className={`${tabell.tall} ${r.belopOre >= 0 ? styles.belopInn : styles.belop}`}
                          >
                            {fmtOre(r.belopOre)}
                          </td>
                        </>
                      )}
                      <td className={tabell.del}>
                        {f ? (
                          <>
                            {f.postTekst}
                            {span > 1 && (
                              <span className={styles.radInfo}> · {fmtOre(f.belopOre)}</span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={tabell.del}>{f ? eierTekst(f) : "—"}</td>
                      {i === 0 && (
                        <>
                          <td rowSpan={span} className={KATEGORI_CLASS[r.kategori]}>
                            {r.statusTekst}
                          </td>
                          <td rowSpan={span}>{kontroll(r)}</td>
                          {kanBehandle && (
                            <td rowSpan={span} className={tabell.handling}>
                              {korriger(r)}
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      ) : (
        <Card>
          {utvalg.map((r) => (
            <div key={r.id} className={styles.rad}>
              <div className={styles.radTopp}>
                <span className={styles.tekst}>{r.tekst || "(uten tekst)"}</span>
                <span className={r.belopOre >= 0 ? styles.belopInn : styles.belop}>
                  {fmtOre(r.belopOre)}
                </span>
              </div>
              <div className={styles.radInfo}>
                {fmtDato(r.dato)} · {r.konto || "—"}
                {r.kvittering ? " · Kvittering" : ""}
              </div>
              <div className={KATEGORI_CLASS[r.kategori]}>
                <span className={styles.tilstand}>{r.statusTekst}</span>
              </div>
              {r.fordelinger.map((f, i) => (
                <div key={i} className={styles.detalj}>
                  {f.postTekst}
                  {r.fordelinger.length > 1 ? ` · ${fmtOre(f.belopOre)}` : ""} · {eierTekst(f)}
                </div>
              ))}
              {kontroll(r)}
              {korriger(r)}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

/**
 * Mobil: de sjeldnere filtrene bak én lavmælt bryter. Åpen fra start når
 * noe der er i bruk (også etter et layoutbytte); deretter styrer brukeren.
 */
function FlereFiltre({ iBruk, children }: { iBruk: boolean; children: ReactNode }) {
  const [apen, setApen] = useState(iBruk);
  return (
    <details className={tabell.flere} open={apen} onToggle={(e) => setApen(e.currentTarget.open)}>
      <summary>Flere filtre og sortering{iBruk ? " (i bruk)" : ""}</summary>
      <div className={styles.filtre}>{children}</div>
    </details>
  );
}
