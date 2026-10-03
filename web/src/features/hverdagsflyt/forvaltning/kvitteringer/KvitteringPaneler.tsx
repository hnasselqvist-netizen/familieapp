import { useState } from "react";
import { Button } from "@components/Button";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import {
  type KvitteringSnapshot,
  nyKvittering,
  oppdaterKvittering,
} from "@domain/forsoning/kvitteringSkriving";
import { type KvitteringUtkast, utkastTotal } from "@domain/forsoning/kvitteringUtkast";
import type { KvitteringRecord, MalPost } from "@app-types/forsoning";
import styles from "./KvitteringsinnboksScreen.module.css";
import { KvitteringSkjema } from "./KvitteringSkjema";

const FEIL = "⚠ Noe gikk galt. Se konsollen for detaljer.";
const idag = () => new Date().toISOString().slice(0, 10);
const tomtUtkast = (): KvitteringUtkast => ({
  merchant: "",
  purchaseDate: idag(),
  total: "",
  allocationMode: null,
  splits: [],
});

/**
 * Ny kvittering (§Issue #34 R3b-3), portert fra legacy `registrerKvittering`
 * (`index.html` ~6062): skriver kun `receipts`. Bilde er valgfritt i legacy
 * og lastes opp til Google Drive; det er ikke portert (åpent valg i
 * `r3b-cutover.md` §7) — kvitteringen lagres uten bilde, som legacy gjør
 * uten fil.
 */
export function NyKvitteringPanel({
  poster,
  onUtfor,
  onLukk,
}: {
  poster: MalPost[];
  onUtfor: (endring: Beslutningsendring) => Promise<void>;
  onLukk: () => void;
}) {
  const [utkast, setUtkast] = useState(tomtUtkast);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState(false);

  const registrer = async () => {
    setLagrer(true);
    setFeil(false);
    try {
      await onUtfor(
        nyKvittering(
          {
            dato: utkast.purchaseDate,
            leverandor: utkast.merchant,
            total: utkast.total,
            allocationMode: utkast.allocationMode,
            splits: utkast.splits,
          },
          { newId: () => crypto.randomUUID(), naa: new Date().toISOString() },
        ),
      );
      setUtkast(tomtUtkast());
      onLukk();
    } catch (err) {
      console.error("[Kvitteringsinnboks] Registrering feilet:", err);
      setFeil(true);
    } finally {
      setLagrer(false);
    }
  };

  return (
    <div className={styles.panel} role="group" aria-label="Ny kvittering">
      <div className={styles.dempet}>
        Bilde kan ikke legges ved her ennå — kvitteringen lagres uten bilde.
      </div>
      <KvitteringSkjema variant="ny" utkast={utkast} onChange={setUtkast} poster={poster} />
      {feil && <div className={styles.toneAvvik}>{FEIL}</div>}
      <button
        type="button"
        className={styles.primar}
        disabled={lagrer}
        onClick={() => void registrer()}
      >
        {lagrer ? "Lagrer…" : "Registrer kvittering"}
      </button>
    </div>
  );
}

const fraKvittering = (r: KvitteringRecord): KvitteringUtkast => ({
  merchant: r.merchant || "",
  purchaseDate: r.purchaseDate || "",
  total: String(r.total ?? 0),
  allocationMode: r.allocationMode ?? null,
  splits: r.splits || [],
});

/** Feltene brukeren faktisk endret — legacy skriver bare det som røres. */
function endredeFelter(r: KvitteringRecord, u: KvitteringUtkast): Partial<KvitteringRecord> {
  const felter: Partial<KvitteringRecord> = {};
  const opprinnelig = fraKvittering(r);
  if (u.merchant !== opprinnelig.merchant) felter.merchant = u.merchant;
  if (u.purchaseDate !== opprinnelig.purchaseDate) felter.purchaseDate = u.purchaseDate;
  if (u.total !== opprinnelig.total) felter.total = utkastTotal(u, "rediger");
  if (u.allocationMode !== opprinnelig.allocationMode) felter.allocationMode = u.allocationMode;
  if (JSON.stringify(u.splits) !== JSON.stringify(opprinnelig.splits)) felter.splits = u.splits;
  return felter;
}

/**
 * Redigering og forkasting (§Issue #34 R3b-3), portert fra legacy
 * `KvitteringDetalj` + `oppdaterKvittering` (`index.html` ~5528, ~6125).
 * En koblet kvittering speiler endringen til hendelsen; asymmetrisk eller
 * manglende kobling gir feilen inline og INGEN skriving.
 *
 * Avvik: legacy skriver ved hvert felt (blur/klikk). Her samles endringene i
 * et utkast og skrives ved «Lagre endringer» — samme sluttilstand, færre
 * helnode-transaksjoner.
 */
export function RedigerKvittering({
  r,
  snapshot,
  poster,
  onUtfor,
  onLukk,
}: {
  r: KvitteringRecord;
  snapshot: KvitteringSnapshot;
  poster: MalPost[];
  onUtfor: (endring: Beslutningsendring) => Promise<void>;
  onLukk: () => void;
}) {
  const [utkast, setUtkast] = useState(() => fraKvittering(r));
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const felter = endredeFelter(r, utkast);
  const harEndringer = Object.keys(felter).length > 0;

  const skriv = async (f: Partial<KvitteringRecord>) => {
    const utfall = oppdaterKvittering(snapshot, r.id, f, new Date().toISOString());
    if (!utfall) return;
    if (utfall.feil !== null) {
      setFeil(`⚠ ${utfall.feil}`);
      return;
    }
    setLagrer(true);
    setFeil(null);
    try {
      await onUtfor(utfall.endring);
      onLukk();
    } catch (err) {
      console.error("[Kvitteringsinnboks] Lagring feilet:", err);
      setFeil(FEIL);
    } finally {
      setLagrer(false);
    }
  };

  return (
    <div>
      {feil && (
        <div className={styles.feilBoks} role="alert">
          {feil}
        </div>
      )}
      {r.driveWebViewLink && (
        <a
          href={r.driveWebViewLink}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.driveLenke}
        >
          Åpne bilde i Google Drive
        </a>
      )}
      <KvitteringSkjema variant="rediger" utkast={utkast} onChange={setUtkast} poster={poster} />
      <div className={styles.knapper}>
        <Button
          variant="destructive"
          onClick={() => void skriv({ forkastet: true })}
          disabled={lagrer}
        >
          Forkast
        </Button>
        <Button variant="secondary" onClick={onLukk} disabled={lagrer}>
          Lukk
        </Button>
        <Button onClick={() => void skriv(felter)} disabled={!harEndringer || lagrer}>
          {lagrer ? "Lagrer…" : "Lagre endringer"}
        </Button>
      </div>
    </div>
  );
}
