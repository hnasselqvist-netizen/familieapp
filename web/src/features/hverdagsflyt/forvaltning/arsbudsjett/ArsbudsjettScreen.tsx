import { useState } from "react";
import { RoomHeader } from "@components/RoomHeader";
import { ConfirmModal } from "./ConfirmModal";
import { FordelArModal } from "./FordelArModal";
import { HelhetVisning } from "./HelhetVisning";
import { PostTable, type VarselRestenPayload } from "./PostTable";
import { YearNav } from "./YearNav";
import { useArsbudsjett, type ArsbudsjettPostType } from "@hooks/useArsbudsjett";
import type { BudsjettPost } from "@app-types/budsjettfamilie";
import styles from "./ArsbudsjettScreen.module.css";

const MONTHS = [
  "Januar",
  "Februar",
  "Mars",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n || 0);

type Visning = "helhet" | ArsbudsjettPostType;

const TABS: { id: Visning; label: string }[] = [
  { id: "helhet", label: "Helhet" },
  { id: "kostnad", label: "Kostnader" },
  { id: "inntekt", label: "Inntekter" },
  { id: "sparing", label: "Sparing" },
];

const TYPE_LABEL: Record<ArsbudsjettPostType, string> = {
  kostnad: "beløp",
  inntekt: "inntekt",
  sparing: "sparebeløp",
};

const VARSEL_TITTEL: Record<ArsbudsjettPostType, string> = {
  kostnad: "Bruk samme beløp resten av året?",
  inntekt: "Bruk samme inntekt resten av året?",
  sparing: "Bruk samme sparebeløp resten av året?",
};

interface ModalTarget {
  type: ArsbudsjettPostType;
  groupId: string;
  item: BudsjettPost;
}

/**
 * Årsbudsjett — Forvaltning-slice for planlegging av budsjettet gjennom
 * hele kalenderåret (§Issue #34, Kontrolltårn-beslutning, kommentar
 * 5819881461). 1:1-port av `ArsbudsjettScreen` (§index.html linje
 * 13428–14474). For inneværende år brukes SAMME målrettede
 * budsjettfamilie.repository-kontrakt som Budsjett/Inntekter/Sparing-
 * fanene allerede eier — ingen ny whole-node-setter. Andre år skriver til
 * `annualBudgetPlans/{år}` via `arsbudsjett.repository.ts`. Se
 * `useArsbudsjett` sin toppkommentar for hele to-veis skrivearkitekturen.
 *
 * **Ikke koblet til hovednavigasjonen** — kun nåbar direkte på
 * `/forvaltning/arsbudsjett`, per eksplisitt instruks fra Kontrolltårnet.
 */
export function ArsbudsjettScreen() {
  const arsbudsjett = useArsbudsjett();
  const [visning, setVisning] = useState<Visning>("helhet");
  const [fordelModal, setFordelModal] = useState<ModalTarget | null>(null);
  const [varselModal, setVarselModal] = useState<VarselRestenPayload | null>(null);
  const [fjernDetaljModal, setFjernDetaljModal] = useState<ModalTarget | null>(null);
  const [aktiverDetaljModal, setAktiverDetaljModal] = useState<ModalTarget | null>(null);
  const [hentDetaljerModalApen, setHentDetaljerModalApen] = useState(false);

  if (arsbudsjett.grupper.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const kostnaderForAar = arsbudsjett.hentGroups("kostnad");
  const inntekterForAar = arsbudsjett.hentGroups("inntekt");
  const sparingForAar = arsbudsjett.hentGroups("sparing");
  const grupperForVisning =
    visning === "kostnad"
      ? kostnaderForAar
      : visning === "inntekt"
        ? inntekterForAar
        : sparingForAar;

  return (
    <div>
      <RoomHeader
        eyebrow="FORVALTNING"
        title={`Årsbudsjett · ${arsbudsjett.valgtAar}`}
        description="Planlegg budsjettet for hele året. Dette er en planleggingsflate — ikke en oversikt over faktisk forbruk."
      />

      <YearNav
        valgtAar={arsbudsjett.valgtAar}
        currentBudgetYear={arsbudsjett.currentBudgetYear}
        onForrige={arsbudsjett.gaTilForrigeAar}
        onNeste={arsbudsjett.gaTilNesteAar}
      />

      {arsbudsjett.hentManglendeDetaljerKildeAar !== null && (
        <div className={styles.hentDetaljerRad}>
          <button
            type="button"
            className={styles.hentDetaljerKnapp}
            onClick={() => setHentDetaljerModalApen(true)}
          >
            Hent manglende detaljer fra {arsbudsjett.hentManglendeDetaljerKildeAar}
          </button>
        </div>
      )}

      <div className={styles.tabRad}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setVisning(tab.id)}
            className={visning === tab.id ? styles.tabAktiv : styles.tab}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visning === "helhet" && (
        <HelhetVisning
          kostnaderForAar={kostnaderForAar}
          inntekterForAar={inntekterForAar}
          sparingForAar={sparingForAar}
          valgtAar={arsbudsjett.valgtAar}
        />
      )}

      {visning !== "helhet" && (
        <PostTable
          type={visning}
          grupper={grupperForVisning}
          visDetaljer={visning !== "sparing"}
          arsbudsjett={arsbudsjett}
          onApneFordelModal={(groupId, item) => setFordelModal({ type: visning, groupId, item })}
          onApneAktiverDetaljerModal={(groupId, item) =>
            setAktiverDetaljModal({ type: visning, groupId, item })
          }
          onApneFjernDetaljModal={(groupId, item) =>
            setFjernDetaljModal({ type: visning, groupId, item })
          }
          onVisAnvendRestenVarsel={setVarselModal}
        />
      )}

      {fordelModal && (
        <FordelArModal
          typeLabel={TYPE_LABEL[fordelModal.type]}
          postName={fordelModal.item.name}
          onClose={() => setFordelModal(null)}
          onFordel={(totalBelop) => {
            void arsbudsjett.spreadYear(
              fordelModal.type,
              fordelModal.groupId,
              fordelModal.item.id,
              totalBelop,
            );
            setFordelModal(null);
          }}
        />
      )}

      {varselModal && (
        <ConfirmModal
          title={VARSEL_TITTEL[varselModal.type]}
          body={`Du endret ${varselModal.postName} for ${MONTHS[varselModal.monthIndex]}. Skal samme ${TYPE_LABEL[varselModal.type]} (${fmt(varselModal.value)}) brukes for resten av året også?`}
          cancelLabel={`Nei, kun ${(MONTHS[varselModal.monthIndex] ?? "").toLowerCase()}`}
          confirmLabel="Ja, resten av året"
          onCancel={() => setVarselModal(null)}
          onConfirm={() => {
            if (varselModal.detailId) {
              void arsbudsjett.applyRestOfYearToDetail(
                varselModal.type,
                varselModal.groupId,
                varselModal.itemId,
                varselModal.detailId,
                varselModal.monthIndex,
                varselModal.value,
              );
            } else {
              void arsbudsjett.applyRestOfYear(
                varselModal.type,
                varselModal.groupId,
                varselModal.itemId,
                varselModal.monthIndex,
                varselModal.value,
              );
            }
            setVarselModal(null);
          }}
        />
      )}

      {fjernDetaljModal && (
        <ConfirmModal
          title="Fjerne detaljnivå?"
          body={`Budsjettposten ${fjernDetaljModal.item.name} blir igjen redigerbar direkte. Dagens summerte budsjettbeløp beholdes uendret.`}
          cancelLabel="Avbryt"
          confirmLabel="Fjern detaljnivå"
          onCancel={() => setFjernDetaljModal(null)}
          onConfirm={() => {
            void arsbudsjett.removeDetailLevel(
              fjernDetaljModal.type,
              fjernDetaljModal.groupId,
              fjernDetaljModal.item.id,
            );
            setFjernDetaljModal(null);
          }}
        />
      )}

      {aktiverDetaljModal && (
        <ConfirmModal
          title="Bygge opp detaljbudsjettet på nytt?"
          body={`Når detaljnivå aktiveres, bygges budsjettet for ${aktiverDetaljModal.item.name} på nytt fra detaljene. Dagens budsjettsummer erstattes av summen av detaljene. Faktisk historikk påvirkes ikke.`}
          cancelLabel="Avbryt"
          confirmLabel="Start detaljbudsjett"
          onCancel={() => setAktiverDetaljModal(null)}
          onConfirm={() => {
            void arsbudsjett.activateDetails(
              aktiverDetaljModal.type,
              aktiverDetaljModal.groupId,
              aktiverDetaljModal.item.id,
            );
            setAktiverDetaljModal(null);
          }}
        />
      )}

      {hentDetaljerModalApen && arsbudsjett.hentManglendeDetaljerKildeAar !== null && (
        <ConfirmModal
          title="Hent manglende detaljer?"
          body={`Poster i ${arsbudsjett.valgtAar} som ennå ikke har detaljer, men som har det i ${arsbudsjett.hentManglendeDetaljerKildeAar}, får detaljstrukturen (navn og id) kopiert inn — alle med 0 kr i alle 12 måneder. Eksisterende beløp i ${arsbudsjett.valgtAar} og poster som allerede har detaljer, endres ikke.`}
          cancelLabel="Avbryt"
          confirmLabel="Hent detaljer"
          onCancel={() => setHentDetaljerModalApen(false)}
          onConfirm={() => {
            void arsbudsjett.hentManglendeDetaljer();
            setHentDetaljerModalApen(false);
          }}
        />
      )}
    </div>
  );
}
