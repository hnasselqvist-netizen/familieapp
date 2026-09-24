import { useState } from "react";
import { Button } from "@components/Button";
import { Modal } from "@components/Modal";
import {
  BUDGET_EIER,
  BUDGET_KILDE,
  BUDGET_KONTOER,
  BUDGET_NIVA,
  BUDGET_OPPFORSEL,
  OPPRETTHOLDE_TYPE,
  SPARING_LIKVIDITET_LABEL,
  defaultMeta,
  defaultSparingMeta,
} from "@domain/budsjettfamilie/budsjettfamilie";
import type { BudsjettfamilieNode, PostMeta } from "@app-types/budsjettfamilie";
import styles from "./PostMetaModal.module.css";

export interface PostMetaModalProps {
  node: BudsjettfamilieNode;
  groupId: string;
  itemName: string;
  itemMeta: PostMeta | null | undefined;
  onSave: (meta: PostMeta, name: string) => void;
  onClose: () => void;
}

/**
 * Delt meta-redigeringsmodal for Budsjett/Inntekter/Sparing — porterer
 * `BudsjettMetaModal`/`InntekterMetaModal`/`SparingMetaModal`
 * (§index.html linje 11275, 11730, 12183) som ÉN komponent i stedet for
 * tre nesten identiske (feltsettet varierer per `node`, ikke selve
 * strukturen): Budsjett/Inntekter deler niva/oppførsel/kilde, Inntekter
 * legger til `disponibelt`, Sparing bruker likviditet i stedet for
 * niva/oppførsel/kilde. Samme lagrekontrakt alle tre steder: navn
 * endres kun når det faktisk er endret, meta erstattes helt.
 */
export function PostMetaModal({
  node,
  groupId,
  itemName,
  itemMeta,
  onSave,
  onClose,
}: PostMetaModalProps) {
  const startMeta = node === "sparingGroups" ? defaultSparingMeta(groupId) : defaultMeta();
  const [meta, setMeta] = useState<PostMeta>({ ...startMeta, ...(itemMeta ?? {}) });
  const [navn, setNavn] = useState(itemName);
  const navnUgyldig = !navn.trim();
  const set = <K extends keyof PostMeta>(key: K, value: PostMeta[K]) =>
    setMeta((p) => ({ ...p, [key]: value }));

  const erSparing = node === "sparingGroups";
  const erInntekt = node === "incomeGroups";

  return (
    <Modal title={`Detaljer — ${itemName}`} onClose={onClose}>
      <div className={styles.field}>
        <div className={styles.label}>Navn</div>
        <input
          value={navn}
          onChange={(e) => setNavn(e.target.value)}
          className={`${styles.input} ${navnUgyldig ? styles.inputInvalid : ""}`}
        />
        {navnUgyldig && <div className={styles.error}>Navnet kan ikke være tomt.</div>}
      </div>

      <div className={styles.field}>
        <div className={styles.label}>Eier</div>
        <div className={styles.pillRow}>
          {BUDGET_EIER.map((e) => (
            <button
              key={e}
              type="button"
              className={`${styles.pill} ${meta.eier === e ? styles.pillActive : ""}`}
              onClick={() => set("eier", e)}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {erSparing ? (
        <div className={styles.field}>
          <div className={styles.label}>Likviditet</div>
          <div className={styles.stack}>
            {Object.keys(SPARING_LIKVIDITET_LABEL).map((k) => (
              <button
                key={k}
                type="button"
                className={`${styles.stackButton} ${meta.likviditet === k ? styles.stackButtonActive : ""}`}
                onClick={() => set("likviditet", k)}
              >
                {SPARING_LIKVIDITET_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className={styles.field}>
            <div className={styles.label}>Nivå</div>
            <div className={styles.stack}>
              {BUDGET_NIVA.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`${styles.stackButton} ${meta.niva === n.id ? styles.stackButtonActive : ""}`}
                  onClick={() => set("niva", n.id)}
                >
                  {n.label}
                </button>
              ))}
            </div>
            {meta.niva === "opprettholde" && (
              <div className={styles.pillRow} style={{ marginTop: 8 }}>
                {OPPRETTHOLDE_TYPE.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`${styles.pill} ${(meta.opprettholdType ?? "nodvendig") === t.id ? styles.pillActive : ""}`}
                    onClick={() => set("opprettholdType", t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <div className={styles.label}>Oppførsel</div>
            <div className={styles.pillRow}>
              {BUDGET_OPPFORSEL.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`${styles.pill} ${meta.oppforsel === o.id ? styles.pillActive : ""}`}
                  onClick={() => set("oppforsel", o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className={styles.grid2}>
        <div>
          <div className={styles.label}>Konto</div>
          <select
            value={meta.konto ?? "Regninger"}
            onChange={(e) => set("konto", e.target.value)}
            className={styles.input}
          >
            {BUDGET_KONTOER.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className={styles.label}>Forfallsdag</div>
          <input
            type="number"
            min={1}
            max={31}
            value={meta.forfallsdag ?? ""}
            onChange={(e) => set("forfallsdag", e.target.value)}
            placeholder="Dag i måneden"
            className={styles.input}
          />
        </div>
      </div>

      {!erSparing && (
        <div className={styles.field}>
          <div className={styles.label}>Kilde</div>
          <div className={styles.pillRow}>
            {BUDGET_KILDE.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`${styles.pill} ${meta.kilde === k.id ? styles.pillActive : ""}`}
                onClick={() => set("kilde", k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {erInntekt && (
        <div className={styles.field}>
          <div className={styles.label}>Disponibelt til prognose</div>
          <div className={styles.hint}>Overstyrer faktisk og budsjett i generatoren.</div>
          <input
            type="number"
            value={meta.disponibelt ?? ""}
            onChange={(e) =>
              set("disponibelt", e.target.value ? Number.parseFloat(e.target.value) : null)
            }
            placeholder="Tomt = bruk faktisk eller budsjett"
            className={styles.input}
          />
        </div>
      )}

      <button
        type="button"
        className={styles.automatiskRow}
        onClick={() => set("automatisk", !meta.automatisk)}
      >
        <span className={`${styles.checkbox} ${meta.automatisk ? styles.checkboxOn : ""}`}>
          {meta.automatisk ? "✓" : ""}
        </span>
        <span>
          <div className={styles.automatiskTitle}>Automatisk til prognosen</div>
          <div className={styles.hint}>
            Generatoren henter denne posten automatisk når den er klar.
          </div>
        </span>
      </button>

      <button
        type="button"
        className={`${styles.arkivRow} ${meta.arkivert ? styles.arkivRowOn : ""}`}
        onClick={() => set("arkivert", !meta.arkivert)}
      >
        {meta.arkivert
          ? "Arkivert — trykk for å gjenåpne (vises igjen ved nye plasseringer)"
          : "Arkiver denne posten (skjules fra nye plasseringer, historikk bevares)"}
      </button>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose}>
          Avbryt
        </Button>
        <Button
          onClick={() => {
            if (navnUgyldig) return;
            onSave(meta, navn.trim());
            onClose();
          }}
          disabled={navnUgyldig}
        >
          Lagre
        </Button>
      </div>
    </Modal>
  );
}
