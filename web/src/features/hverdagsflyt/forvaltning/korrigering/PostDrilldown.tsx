import { useMemo, useState } from "react";
import { Modal } from "@components/Modal";
import type { HendelseDrillDownRad } from "@domain/budsjettfamilie/budsjettfamilie";
import { byggAlleMalPoster } from "@domain/forsoning/fordeling";
import { useKorrigering } from "@hooks/useKorrigering";
import { DrilldownModal } from "../budsjettfamilie/DrilldownModal";
import { RedigerKvittering } from "../kvitteringer/KvitteringPaneler";
import { KorrigerHendelseModal } from "./KorrigerHendelseModal";

export interface PostDrilldownProps {
  tittel: string;
  rader: HendelseDrillDownRad[];
  onClose: () => void;
}

/**
 * Drilldown fra postdetalj i Budsjett/Inntekter/Sparing (§Issue #34 R3b-4),
 * som legacy-skjermene (`index.html` ~11660–11730): en hendelse korrigeres
 * i `KorrigerHendelseModal`, en kvittering redigeres som i innboksen.
 * Etter en korrigering lukkes også drilldown, som i legacy.
 *
 * Med forsoningsporten av er det samme rene visning som før.
 */
export function PostDrilldown({ tittel, rader, onClose }: PostDrilldownProps) {
  const kor = useKorrigering();
  const [korrigerHendelseId, setKorrigerHendelseId] = useState<string | null>(null);
  const [korrigerReceiptId, setKorrigerReceiptId] = useState<string | null>(null);
  const poster = useMemo(
    () => byggAlleMalPoster(kor.budgetGroups, kor.incomeGroups),
    [kor.budgetGroups, kor.incomeGroups],
  );

  if (!kor.skrivingAktiv) {
    return <DrilldownModal tittel={tittel} rader={rader} onClose={onClose} />;
  }

  const hendelse = korrigerHendelseId
    ? kor.hendelser.find((h) => h.id === korrigerHendelseId)
    : undefined;
  const receipt = korrigerReceiptId
    ? kor.receipts.find((r) => r.id === korrigerReceiptId)
    : undefined;

  return (
    <>
      <DrilldownModal
        tittel={tittel}
        rader={rader}
        onClose={onClose}
        onVelgHendelse={setKorrigerHendelseId}
        onVelgKvittering={setKorrigerReceiptId}
      />
      {receipt && (
        <Modal
          title={`Rediger kvittering — ${receipt.merchant || "(ukjent)"}`}
          onClose={() => setKorrigerReceiptId(null)}
        >
          <RedigerKvittering
            key={receipt.id}
            r={receipt}
            snapshot={{
              transaksjoner: kor.transaksjoner,
              hendelser: kor.hendelser,
              receipts: kor.receipts,
            }}
            poster={poster}
            onUtfor={kor.utfor}
            onLukk={() => setKorrigerReceiptId(null)}
          />
        </Modal>
      )}
      {hendelse && (
        <KorrigerHendelseModal
          key={hendelse.id}
          hendelse={hendelse}
          transaksjoner={kor.transaksjoner}
          rules={kor.rules}
          budgetGroups={kor.budgetGroups}
          incomeGroups={kor.incomeGroups}
          sparingGroups={kor.sparingGroups}
          onUtfor={kor.utfor}
          onLagret={() => {
            setKorrigerHendelseId(null);
            onClose();
          }}
          onClose={() => setKorrigerHendelseId(null)}
        />
      )}
    </>
  );
}
