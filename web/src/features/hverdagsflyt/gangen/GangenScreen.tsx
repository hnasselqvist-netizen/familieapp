import { Link } from "react-router-dom";
import { fraLenke } from "@components/fraLenke";
import { Icon } from "@components/Icon";
import { RoomDate } from "@components/RoomDate";
import { useAuthUser } from "@hooks/useAuthUser";
import { useGangen } from "@hooks/useGangen";
import {
  type GangenPunkt,
  dagensPunkter,
  viOrdner as byggViOrdner,
} from "@domain/gangen/dagensPunkter";
import type { DayKey } from "@app-types/meal";
import branchTopLeft from "../../../../../assets/illustrations/branch-top-left.webp";
import heartHanddrawn from "../../../../../assets/illustrations/heart-handdrawn-terracotta-transparent.webp";
import leafSprig from "../../../../../assets/illustrations/leaf-sprig.webp";
import shelfVaseCandle from "../../../../../assets/illustrations/shelf-vase-candle.webp";
import styles from "./GangenScreen.module.css";

interface Viktigst {
  linje1: string;
  linje2: string;
  href: string;
  ikon: "clipboard-check" | "receipt-text" | "soup" | "shopping-cart";
}

const fraGangen = (sti: string) => fraLenke(sti, "gangen");

/**
 * Hvert punkt tar brukeren rett dit beslutningen tas — riktig kø, riktig
 * dag — med `?fra=gangen`, slik at rommet kan tilby veien tilbake
 * (§components/Retur.tsx).
 */
function visning(p: GangenPunkt, iDag: DayKey): Viktigst {
  switch (p.art) {
    case "middag-uplanlagt":
      return {
        linje1: "Middagen i dag",
        linje2: "er ikke planlagt ennå",
        href: fraGangen(`/mat/plan?dag=${iDag}`),
        ikon: "soup",
      };
    case "middag-handle":
      return {
        linje1: p.antall === 1 ? `Én vare til ${p.middag}` : `${p.antall} varer til ${p.middag}`,
        linje2: "står på handlelisten",
        href: fraGangen("/mat/handle"),
        ikon: "shopping-cart",
      };
    case "transaksjoner":
      return {
        linje1: p.antall === 1 ? "Én transaksjon" : `${p.antall} transaksjoner`,
        linje2: "venter på vurdering",
        href: fraGangen(`/forvaltning/transaksjoner?ko=${p.ko}`),
        ikon: "clipboard-check",
      };
    case "kvitteringer":
      return {
        linje1: p.antall === 1 ? "Én kvittering" : `${p.antall} kvitteringer`,
        linje2: "venter på kobling",
        href: fraGangen("/forvaltning/kvitteringer"),
        ikon: "receipt-text",
      };
  }
}

/**
 * Gangen — Hverdagsflyts inngang, native `web/`-port av produksjonens
 * `GangenScreen` (§index.html linje 2453-2702, §Kontrolltårn-handoff,
 * Issue #20, "hovedløft: Hverdagsflyt-skall + Gangen + Kjøkken som
 * faktisk rom"). Visuell og funksjonell paritet som mål — samme
 * `--g-*`-palett, samme illustrasjoner, samme tre signaler ("Det
 * viktigste for deg nå"/"Vi ordner"/avsluttende hilsen).
 *
 * `setTab`-navigasjon er erstattet med ekte `<Link>` (§react-router-dom)
 * til de tilsvarende rutene. Profil-/utloggingsmenyen fra produksjonen
 * er allerede fjernet der (utlogging flyttet til Mer) — samme her.
 *
 * **Låst korrigering** (bekreftet av Helen): kvitteringssignalet bruker
 * nå `erKvitteringKlarForKobling` (§domain/gangen/gangen.ts) i stedet for
 * å telle enhver aktiv, ikke-ferdig kvittering — se den funksjonens
 * toppkommentar for hvorfor.
 *
 * **Gangen som dagens ene inngang** (#59, retning 1, Kontrolltårnet +
 * Helen 2026-10-07): «Det viktigste» bygges av `dagensPunkter`
 * (§domain/gangen/dagensPunkter.ts) — høyst tre punkter, middagen først,
 * og hvert punkt lenker rett til beslutningen (riktig kø, riktig dag) med
 * `?fra=gangen`, slik at rommet kan tilby veien tilbake
 * (§components/Retur.tsx). Lenkene er nå ekte `<Link>` (før en
 * `<a href>` som lastet hele appen på nytt). «Vi ordner» gjør middagen
 * konkret. Produktvalg C: ingen økonomi utover køene som venter.
 *
 * **Design-review runde 3** (§Helen-review, PR #26, §4): datoen er nå
 * det delte `RoomDate`-atomet (§components/RoomDate.tsx) i stedet for
 * lokal `toLocaleDateString`-logikk — Kjøkken-skjermene bruker samme
 * komponent via `RoomHeader` sin `date`-prop.
 */
export function GangenScreen() {
  const user = useAuthUser();
  const gangen = useGangen();

  if (gangen.status !== "loaded") {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingIcon}>🏡</div>
        <div className={styles.loadingText}>Laster…</div>
      </div>
    );
  }

  const time = new Date().getHours();
  const hilsen =
    time >= 5 && time < 11
      ? "God morgen"
      : time >= 11 && time < 17
        ? "God ettermiddag"
        : "God kveld";
  const navn = user?.displayName ? user.displayName.split(" ")[0] : null;

  const viktigstVist = dagensPunkter(gangen.data).map((p) => visning(p, gangen.data.iDag));
  const viOrdner = byggViOrdner(gangen.data);

  return (
    <div className={styles.root}>
      <div className={styles.branchLayer}>
        <img src={branchTopLeft} alt="" aria-hidden="true" className={styles.branchImg} />
      </div>

      <div className={styles.entryBlock}>
        <img src={shelfVaseCandle} alt="" aria-hidden="true" className={styles.shelfImg} />

        <div className={styles.dateRow}>
          <RoomDate />
        </div>

        <div className={styles.greetingBlock}>
          <div className={styles.eyebrow}>HJEM</div>
          <div className={styles.greeting}>
            {hilsen}
            {navn ? `, ${navn}` : ""}
          </div>
          <div className={styles.subtext}>
            Her kan du legge
            <br />
            fra deg litt av vekten.
          </div>
        </div>
      </div>

      <div className={styles.viktigstWrap}>
        <div className={styles.viktigstCard}>
          <div className={styles.viktigstHeader}>
            <div className={styles.heartCircle}>
              <Icon name="heart" color="#ecdfc8" size={17} />
            </div>
            <div className={styles.viktigstTitle}>Det viktigste for deg nå</div>
          </div>

          {viktigstVist.length > 0 ? (
            viktigstVist.map((p, i) => (
              <div key={p.href}>
                <Link to={p.href} className={styles.viktigstRow}>
                  <div className={styles.viktigstIconCircle}>
                    <Icon name={p.ikon} color="#3b352f" size={19} />
                  </div>
                  <div className={styles.viktigstText}>
                    <div className={styles.viktigstLinje1}>{p.linje1}</div>
                    <div className={styles.viktigstLinje2}>{p.linje2}</div>
                  </div>
                  <Icon name="chevron-right" color="#3b352f" size={18} />
                </Link>
                {i < viktigstVist.length - 1 && <div className={styles.viktigstDivider} />}
              </div>
            ))
          ) : (
            <div className={styles.viktigstEmpty}>Ingenting trenger deg akkurat nå.</div>
          )}
        </div>
      </div>

      {viOrdner.length > 0 && (
        <div className={styles.viOrdnerWrap}>
          <div className={styles.viOrdnerHeader}>
            <div className={styles.leafCircle}>
              <Icon name="leaf" color="#5e7457" size={16} />
            </div>
            <div className={styles.viOrdnerTitle}>Vi ordner</div>
          </div>
          <div className={styles.viOrdnerCard}>
            <img src={leafSprig} alt="" aria-hidden="true" className={styles.leafSprigImg} />
            {viOrdner.map((tekst, i) => (
              <div key={tekst}>
                <div className={styles.viOrdnerRow}>
                  <div className={styles.checkCircle}>
                    <Icon name="check" color="#ecdfc8" size={13} />
                  </div>
                  <span className={styles.viOrdnerText}>{tekst}</span>
                </div>
                {i < viOrdner.length - 1 && <div className={styles.viOrdnerDivider} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.closing} style={{ marginTop: viOrdner.length > 0 ? 13 : 16 }}>
        <span className={styles.closingText}>Resten kan vente litt.</span>
        <img src={heartHanddrawn} alt="" className={styles.closingHeart} />
      </div>
    </div>
  );
}
