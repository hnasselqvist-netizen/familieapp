import { useEffect, useRef, useState } from "react";
import { Button } from "@components/Button";
import { GroupAccordion } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/GroupAccordion";
import { PostMetaModal } from "@features/hverdagsflyt/forvaltning/budsjettfamilie/PostMetaModal";
import { PostDrilldown } from "@features/hverdagsflyt/forvaltning/korrigering/PostDrilldown";
import { finnHendelserForPost } from "@domain/budsjettfamilie/budsjettfamilie";
import type { UseBudsjettfamilieResult } from "@hooks/useBudsjettfamilie";
import type { BudsjettfamilieNode, BudsjettGruppe, BudsjettPost } from "@app-types/budsjettfamilie";

interface MetaMal {
  groupId: string;
  item: BudsjettPost;
  /** Åpnet fra et lenkemål i adressen (lukking fjerner målet fra adressen). */
  fraLenke?: boolean;
}
const malNoekkel = (m: MetaMal) => `${m.groupId}/${m.item.id}`;

export interface OmradeGrupperProps {
  node: BudsjettfamilieNode;
  grupper: readonly BudsjettGruppe[];
  bf: UseBudsjettfamilieResult;
  /** Tom gruppe: egen tekst for Sparing (§index.html linje 12384–12389). */
  emptyMessage?: (gruppe: BudsjettGruppe) => string;
  /** Post som skal åpnes i detaljredigeringen ved visning (fra en lenke). */
  aapnePost?: { gruppeId: string; postId: string } | null;
  /** Kalles når den lenkeåpnede redigeringen lukkes. */
  onLukketAapnePost?: () => void;
}

/**
 * Gruppene i ett område (Inntekter, Kostnader eller Sparing) med
 * postredigering, postinnstillinger og drilldown. Samlet fra de tre
 * tidligere skjermene `BudsjettScreen`/`InntekterScreen`/`SparingScreen`
 * (§Issue #34; legacy §index.html linje 11477–11727, 11930–12160,
 * 12299–12506), uendret oppførsel.
 *
 * **Korrigering fra drilldown** (`KorrigerHendelseModal`, kvitterings-
 * redigering, «Lær kobling») ligger i `korrigering/PostDrilldown` og er bak
 * forsoningsporten: med porten av er drilldown ren visning.
 */
export function OmradeGrupper({
  node,
  grupper,
  bf,
  emptyMessage,
  aapnePost,
  onLukketAapnePost,
}: OmradeGrupperProps) {
  const [metaTarget, setMetaTarget] = useState<MetaMal | null>(null);
  const [utkastEndret, setUtkastEndret] = useState(false);
  const [ventende, setVentende] = useState<MetaMal | null>(null);

  // Lenkemål fra adressen (`?gruppe=&post=`, funn F). Reagerer på faktisk
  // URL-navigasjon (Link, tilbake/frem), ikke bare ved første visning.
  // Live-oppdateringer av gruppene endrer ikke nøkkelen, så et åpent utkast
  // remonteres eller nullstilles aldri av dem.
  const lenkeNoekkel = aapnePost ? `${aapnePost.gruppeId}/${aapnePost.postId}` : null;
  const sistLenke = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lenkeNoekkel === sistLenke.current) return;
    sistLenke.current = lenkeNoekkel;
    if (!aapnePost) {
      // Målet er borte fra adressen (f.eks. tilbake): lukk en lenkeåpnet
      // redigering uten endringer; et ulagret utkast står.
      if (metaTarget?.fraLenke && !utkastEndret) setMetaTarget(null);
      setVentende(null);
      return;
    }
    const item = grupper
      .find((g) => g.id === aapnePost.gruppeId)
      ?.items.find((i) => i.id === aapnePost.postId);
    if (!item) return; // ukjent gruppe/post: åpner ingenting
    const mal: MetaMal = { groupId: aapnePost.gruppeId, item, fraLenke: true };
    if (metaTarget && malNoekkel(metaTarget) === malNoekkel(mal)) return;
    if (metaTarget && utkastEndret) {
      setVentende(mal); // eksplisitt valg i redigeringen, utkastet står
      return;
    }
    setUtkastEndret(false);
    setMetaTarget(mal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reagerer bare på endret lenkemål; gruppe-/utkaststatus leses som de er nå.
  }, [lenkeNoekkel]);

  const lukkMeta = () => {
    if (metaTarget?.fraLenke) onLukketAapnePost?.();
    setMetaTarget(null);
    setVentende(null);
    setUtkastEndret(false);
  };
  const [drilldownItem, setDrilldownItem] = useState<BudsjettPost | null>(null);

  return (
    <>
      {grupper.map((gruppe) => (
        <GroupAccordion
          key={gruppe.id}
          gruppe={gruppe}
          month={bf.month}
          actualTotals={bf.actualTotals}
          emptyMessage={emptyMessage?.(gruppe)}
          onUpdateBudget={(groupId, itemId, v) => void bf.updateBudget(groupId, itemId, v)}
          onUpdateSpent={(groupId, itemId, v) => void bf.updateSpent(groupId, itemId, v)}
          onRemoveItem={(groupId, itemId) => void bf.removeExistingItem(groupId, itemId)}
          onAddItem={(groupId, fields) => void bf.addNewItem(groupId, fields)}
          onOpenMeta={(groupId, item) => {
            setUtkastEndret(false);
            setMetaTarget({ groupId, item });
          }}
          onOpenDrilldown={(item) => setDrilldownItem(item)}
        />
      ))}

      {metaTarget && (
        <PostMetaModal
          key={malNoekkel(metaTarget)}
          node={node}
          groupId={metaTarget.groupId}
          itemName={metaTarget.item.name}
          itemMeta={metaTarget.item.meta}
          onSave={(meta, name) =>
            void bf.saveMeta(metaTarget.groupId, metaTarget.item.id, meta, name)
          }
          onUtkastEndret={setUtkastEndret}
          varsel={
            ventende && (
              <div role="alert">
                <p>
                  Adressen peker nå på «{ventende.item.name}». Endringene i «{metaTarget.item.name}»
                  er ikke lagret.
                </p>
                <Button variant="secondary" onClick={() => setVentende(null)}>
                  Fortsett redigering
                </Button>{" "}
                <Button
                  onClick={() => {
                    setUtkastEndret(false);
                    setMetaTarget(ventende);
                    setVentende(null);
                  }}
                >
                  Forkast og åpne «{ventende.item.name}»
                </Button>
              </div>
            )
          }
          onClose={lukkMeta}
        />
      )}

      {drilldownItem && (
        <PostDrilldown
          tittel={`Hendelser — ${drilldownItem.name}`}
          rader={finnHendelserForPost(
            bf.hendelser,
            bf.transaksjoner,
            bf.receipts,
            drilldownItem,
            bf.monthKey,
            bf.gyldigeObservasjonIder,
          )}
          onClose={() => setDrilldownItem(null)}
        />
      )}
    </>
  );
}
