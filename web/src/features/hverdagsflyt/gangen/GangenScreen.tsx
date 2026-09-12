import { Icon } from "@components/Icon";
import { useAuthUser } from "@hooks/useAuthUser";
import { useGangenSignals } from "@hooks/useGangenSignals";
import { useMeals } from "@hooks/useMeals";
import { useShoppingList } from "@hooks/useShoppingList";
import { dayKeyForDato } from "@domain/meals/planningPeriod";
import { getWeekKey } from "@domain/shared/weekKey";
import branchTopLeft from "../../../../../assets/illustrations/branch-top-left.webp";
import heartHanddrawn from "../../../../../assets/illustrations/heart-handdrawn-terracotta-transparent.webp";
import leafSprig from "../../../../../assets/illustrations/leaf-sprig.webp";
import shelfVaseCandle from "../../../../../assets/illustrations/shelf-vase-candle.webp";
import styles from "./GangenScreen.module.css";

interface Viktigst {
  linje1: string;
  linje2: string;
  href: string;
  ikon: "clipboard-check" | "receipt-text" | "soup";
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
 */
export function GangenScreen() {
  const user = useAuthUser();
  const signals = useGangenSignals();
  const weekKey = getWeekKey(new Date());
  const { meals } = useMeals(weekKey);
  const { shopping } = useShoppingList();

  const coreLoaded =
    signals.status === "loaded" && meals.status === "loaded" && shopping.status === "loaded";

  if (!coreLoaded) {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingIcon}>🏡</div>
        <div className={styles.loadingText}>Laster…</div>
      </div>
    );
  }

  const dagKey = dayKeyForDato(new Date());
  const middagIDagPlanlagt = !!meals.data[dagKey];

  const handlelisteRem = shopping.data.filter((i) => !i.done).length;
  const handlelisteHar = shopping.data.length > 0;

  const time = new Date().getHours();
  const hilsen =
    time >= 5 && time < 11
      ? "God morgen"
      : time >= 11 && time < 17
        ? "God ettermiddag"
        : "God kveld";
  const navn = user?.displayName ? user.displayName.split(" ")[0] : null;

  const { trengerVurdering, kvitteringerKlareForKobling } = signals.data;

  const viktigst: Viktigst[] = [];
  if (trengerVurdering > 0) {
    viktigst.push({
      linje1: trengerVurdering === 1 ? "Én transaksjon" : `${trengerVurdering} transaksjoner`,
      linje2: "venter på vurdering",
      href: "/forvaltning",
      ikon: "clipboard-check",
    });
  }
  if (kvitteringerKlareForKobling > 0) {
    viktigst.push({
      linje1:
        kvitteringerKlareForKobling === 1
          ? "Én kvittering"
          : `${kvitteringerKlareForKobling} kvitteringer`,
      linje2: "venter på kobling",
      href: "/forvaltning",
      ikon: "receipt-text",
    });
  }
  if (!middagIDagPlanlagt) {
    viktigst.push({
      linje1: "Middagen i dag",
      linje2: "er ikke planlagt ennå",
      href: "/mat/plan",
      ikon: "soup",
    });
  }
  const viktigstVist = viktigst.slice(0, 3);

  const viOrdner: string[] = [];
  if (middagIDagPlanlagt) viOrdner.push("Middagen er planlagt.");
  if (handlelisteHar && handlelisteRem === 0) viOrdner.push("Handlelisten er klar.");
  if (trengerVurdering === 0) viOrdner.push("Ingen nye vurderinger venter.");

  const datoStr = new Date().toLocaleDateString("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const datoStrKapitalisert = datoStr.charAt(0).toUpperCase() + datoStr.slice(1);

  return (
    <div className={styles.root}>
      <div className={styles.branchLayer}>
        <img src={branchTopLeft} alt="" aria-hidden="true" className={styles.branchImg} />
      </div>

      <div className={styles.entryBlock}>
        <img src={shelfVaseCandle} alt="" aria-hidden="true" className={styles.shelfImg} />

        <div className={styles.dateRow}>
          <div className={styles.dateText}>{datoStrKapitalisert}</div>
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
              <div key={p.href + p.ikon}>
                <a href={p.href} className={styles.viktigstRow}>
                  <div className={styles.viktigstIconCircle}>
                    <Icon name={p.ikon} color="#3b352f" size={19} />
                  </div>
                  <div className={styles.viktigstText}>
                    <div className={styles.viktigstLinje1}>{p.linje1}</div>
                    <div className={styles.viktigstLinje2}>{p.linje2}</div>
                  </div>
                  <Icon name="chevron-right" color="#3b352f" size={18} />
                </a>
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
