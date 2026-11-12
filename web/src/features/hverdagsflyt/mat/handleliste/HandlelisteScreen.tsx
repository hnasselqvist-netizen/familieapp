import { useRef, useState } from "react";
import { Button } from "@components/Button";
import { Icon } from "@components/Icon";
import type { IconName } from "@components/icons";
import { ItemPicker } from "@components/ItemPicker";
import { Retur } from "@components/Retur";
import { RoomHeader } from "@components/RoomHeader";
import { SHOP_CATS } from "@domain/shared/constants";
import { sorterKategorier } from "@domain/shopping/kategoriorden";
import { basisvareNokkel } from "@domain/shopping/basisvare";
import { stabil } from "@domain/shopping/handlelisteDuplikater";
import {
  type NyRadPlan,
  type OkningsPlan,
  type Treff,
  finnTreff,
  lagOkningsPlan,
} from "@domain/shopping/handlelisteInnlegging";
import { findItemByName } from "@domain/shopping/handlelisteRules";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import type { ShoppingItem } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import { Basisvare, type BasisvareLagring } from "./Basisvare";
import { Duplikater, Sammenslatte } from "./Duplikater";
import { InnleggingsMelding, type InnleggingsStatus, Innleggingsvarsel } from "./Innlegging";
import styles from "./HandlelisteScreen.module.css";

/** Én rolig Lucide-familie for kategoriene (§Kontrolltårn-review, PR #26, design-review runde 2, §5) — nærmeste gode standardikon per kategori, konsistens fremfor bokstavelig treff. */
const CAT_ICON: Record<string, IconName> = {
  "Frukt og grønt": "sprout",
  Kjøtt: "beef",
  "Fisk og sjømat": "fish",
  "Ost og meieri": "milk",
  Tørrvarer: "wheat",
  "Brød og bakst": "sandwich",
  Frysevarer: "snowflake",
  Drikke: "cup-soda",
  Rengjøring: "spray-can",
  Diverse: "package-open",
};

/** Fast kategoriorden (§Issue #20) — stabil uansett redigering, avhuking og tilføying. Erstatter index.html sin "første forekomst"-orden, som fikk kategoriene til å hoppe. */
function categoryOrder(items: ShoppingItem[]): string[] {
  return sorterKategorier(items.map((i) => i.cat));
}

/** Ett innleggingsforsøk: samme `opId` ved «Prøv igjen» (ADR 0003 kvitteringskontrakt). */
type Innsending =
  | { type: "ny"; plan: NyRadPlan; signatur: string }
  | { type: "okning"; plan: OkningsPlan; signatur: string };

/** Varselet når varen allerede er aktiv: radene slik de var da det åpnet. */
interface Varsel {
  navn: string;
  treff: Treff[];
}

/** Utkastet slik brukeren skrev det — et forsøk gjentas bare for samme utkast. */
const utkastSignatur = (navn: string, mengde: string, maalId: string | null) =>
  stabil({ navn: navn.trim(), mengde: mengde.trim(), maalId });

/**
 * Handleliste — andre Fase 2-skjerm migrert fra index.html
 * (`ShoppingScreen`, linje ~4902–5059). Funksjonell paritet mot dagens
 * skjerm: hele datalaget (`shopping.repository.ts`) var allerede fullt
 * migrert med målrettede per-post-operasjoner (PR #6), inkludert
 * `clearDoneShoppingItems` sin stale-read-race-fiks — denne skjermen
 * legger ikke til ny skrivelogikk, kun UI over de eksisterende
 * repository-funksjonene.
 *
 * Generatorens "legg til flere varer samtidig"-flyt (`onAddToList`) er
 * fortsatt bevisst utenfor (§data/shopping.repository.ts sin
 * toppkommentar) — krever en egen batch-skrivestrategi.
 *
 * **Visuell Kjøkken-harmonisering** (§Kontrolltårn-handoff, Issue #20,
 * "visuelt førsteutkast av resten av Kjøkkenet"): sideheaderen bruker nå
 * `RoomHeader`, med "Fjern fullførte" i dens `actions`-rad, og
 * fargeidentiteten er byttet til Hjem/Kjøkken-paletten (`--g-*`), samme
 * mønster som Middagsplan v1/Middagsbibliotek/Kokebok. Rollen her er
 * "utførerflate i butikk" — mest kompakt og effektiv av de tre
 * Mat-skjermene, derfor UENDRET tetthet/avstand (ingen felt fikk mer
 * luft), kun fargeidentitet.
 *
 * **Design-review runde 1** (§Kontrolltårn-review, PR #26, §7): "Fjern
 * fullførte" bruker nå den delte `Button`-atomen. Fremdriftslinjen og den
 * fullførte avhukingen bruker nå `--g-green` i stedet for kjernepalettens
 * `--color-olive`. Varerader er nå ca. 44px berøringshøyde med 15px navn
 * og 13px sekundær mengde, og kategorilabelen er 12px/600. Der et ekte
 * Lucide-ikon fantes i registeret er emoji byttet ut (✓ → `Icon
 * name="check"`, 🛍️ → `Icon name="shopping-cart"`).
 *
 * **Design-review runde 2: fullført ikonfamilie + strukturert statuslinje**
 * (§Kontrolltårn-review, PR #26, §5): `RoomHeader.description` er nå
 * `ReactNode` (§components/RoomHeader.tsx) slik at statuslinjen kan bruke
 * `check`/`clock`-ikoner + struktur i stedet for `✓`/`⏱` inni én streng.
 * `CAT_EMOJI` er erstattet med `CAT_ICON` — én rolig Lucide-familie
 * (sprout/beef/fish/milk/wheat/sandwich/snowflake/cup-soda/spray-can/
 * package-open) for kategoriene. `.addButton` (→), legg-til-ikonet (＋),
 * fjern-knappene (✕) og utvid/skjul-pilene (▴/▾) bruker nå
 * `arrow-right`/`plus`/`x`/`chevron-up`/`chevron-down`.
 *
 * **Design-review runde 3** (§Helen-review, PR #26, §12 — "Helen opplever
 * Handlelisten som svært god. Bevar dagens struktur/tetthet."): "Fjern
 * fullførte" er nå `size="compact"` (§Button.tsx), samme mønster som
 * Middagsplan/Kokebok. Avhukingen (`.checkbox`/`.checkboxDone`) er nå en
 * rund sirkel i Gangens ikon-/statusspråk i stedet for et avrundet
 * kvadrat — se `HandlelisteScreen.module.css` sin toppkommentar for
 * detaljene. Alt annet (gjennomstreking/demping for ferdige varer,
 * kategoristruktur, tetthet) er UENDRET.
 */
export function HandlelisteScreen() {
  const {
    shopping,
    toggleDone,
    updateField,
    removeItem,
    clearDone,
    slaaSammen,
    angreSammenslaing,
    leggTilNyRad,
    okAntall,
  } = useShoppingList();
  const { items, findOrCreateItem } = useItems();
  const { staples, markAsStaple } = useStaples();
  // «Merk som basisvare» (#20): utfallet bindes til basisvarenøkkelen, ikke
  // til raden, så radbytte eller navneendring under lagring aldri flytter
  // det til en annen vare. `iGang` stopper dobbeltklikk før neste tegning.
  const [basisvareLagring, setBasisvareLagring] = useState<BasisvareLagring>({});
  const iGang = useRef(new Set<string>());
  const merkBasisvare = async (navn: string) => {
    const n = basisvareNokkel(navn);
    if (!n.ok || iGang.current.has(n.nokkel)) return;
    iGang.current.add(n.nokkel);
    const sett = (status: "lagrer" | "feil" | null) =>
      setBasisvareLagring((forrige) => {
        const neste = { ...forrige };
        if (status) neste[n.nokkel] = status;
        else delete neste[n.nokkel];
        return neste;
      });
    sett("lagrer");
    try {
      await markAsStaple(navn);
      sett(null);
    } catch (err) {
      console.error("[Basisvare] Lagring feilet:", err);
      sett("feil");
    } finally {
      iGang.current.delete(n.nokkel);
    }
  };

  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [selectedVare, setSelectedVare] = useState<Vare | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Manuell innlegging (Mat #20, ordre 6830803229).
  const [varsel, setVarsel] = useState<Varsel | null>(null);
  const [maalId, setMaalId] = useState<string | null>(null);
  const [innleggingStatus, setInnleggingStatus] = useState<InnleggingsStatus | null>(null);
  // Siste forsøk med ukjent/ubekreftet utfall: «Prøv igjen» sender det på nytt.
  const [ventende, setVentende] = useState<Innsending | null>(null);
  const [lagrerInnlegging, setLagrerInnlegging] = useState(false);
  const innleggingIGang = useRef(false);
  // Utkastet nå (ikke slik det var da lagringen startet): et utkast som er
  // endret under lagring, tømmes ikke.
  const utkastNa = useRef({ navn: newName, mengde: newAmount });
  utkastNa.current = { navn: newName, mengde: newAmount };

  if (shopping.status !== "loaded" || items.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const all = shopping.data;
  const pending = all.filter((i) => !i.done);
  const done = all.filter((i) => i.done);

  const onNameChange = (name: string) => {
    setNewName(name);
    setSelectedVare(null);
    setVarsel(null);
  };

  const tomUtkast = () => {
    setNewName("");
    setNewAmount("");
    setSelectedVare(null);
  };

  /** Én innlegging om gangen — også mens varen slås opp/opprettes (dobbeltklikk). */
  const medLaas = async (fn: () => Promise<void>) => {
    if (innleggingIGang.current) return;
    innleggingIGang.current = true;
    setLagrerInnlegging(true);
    try {
      await fn();
    } catch (err) {
      console.error("[Handleliste] Innlegging feilet:", err);
      setInnleggingStatus({
        type: "konflikt",
        tekst: "Kunne ikke lagre. Ingenting er lagt til på listen, og utkastet er beholdt.",
      });
    } finally {
      innleggingIGang.current = false;
      setLagrerInnlegging(false);
    }
  };

  /**
   * Sender ett forsøk. Lagret (eller allerede lagret) tømmer utkastet;
   * alt annet beholder det. Ukjent/ubekreftet holder på forsøket, så
   * «Prøv igjen» sender SAMME `opId` som gjentak — avgjort mot kvitteringen,
   * aldri en dobbel økning eller en ny rad.
   */
  const send = async (innsending: Innsending, gjentak: boolean) => {
    const u =
      innsending.type === "ny"
        ? await leggTilNyRad(innsending.plan, gjentak)
        : await okAntall(innsending.plan, gjentak);
    if (u.utfall === "anvendt" || u.utfall === "allerede") {
      const maal = innsending.type === "okning" ? innsending.plan.radId : null;
      const { navn, mengde } = utkastNa.current;
      if (utkastSignatur(navn, mengde, maal) === innsending.signatur) tomUtkast();
      setVarsel(null);
      setVentende(null);
      const tekst =
        u.utfall === "allerede"
          ? "Var allerede lagret. Ingen ny endring."
          : innsending.type === "ny"
            ? `La til «${innsending.plan.rad.name}».`
            : `Økte «${innsending.plan.sett.name}» til ${innsending.plan.resultat}.`;
      setInnleggingStatus({ type: "ok", tekst });
    } else if (u.utfall === "konflikt") {
      setVarsel(null);
      setVentende(null);
      setInnleggingStatus({
        type: "konflikt",
        tekst: u.treff
          ? `${u.grunn} Trykk «Legg til» igjen for å se raden.`
          : `${u.grunn} Utkastet er beholdt.`,
      });
    } else if (u.utfall === "avvist") {
      setVentende(null);
      setInnleggingStatus({
        type: "konflikt",
        tekst: "Ingen tilgang til å lagre. Ingenting er lagret, og utkastet er beholdt.",
      });
    } else {
      setVentende(innsending);
      setInnleggingStatus({
        type: "ukjent",
        tekst:
          u.utfall === "ubekreftet"
            ? u.grunn
            : "Vi vet ikke om endringen ble lagret. Utkastet er beholdt. «Prøv igjen» sender det samme forsøket, så det aldri telles to ganger.",
      });
    }
  };

  /**
   * «Legg til»: klassifiserer mot listen FØR noe opprettes i varebasen.
   * Treff → varselet vises og ingenting skrives. Ingen treff → varen
   * finnes/opprettes og raden legges til, men bare hvis den ferske listen
   * fortsatt ikke har treff (atomisk kontroll i transaksjonen). Et
   * ventende forsøk med samme utkast sendes på nytt i stedet.
   */
  const leggTil = async (somNy: boolean) => {
    const name = newName.trim();
    if (!name) return;
    if (!somNy && ventende) {
      const maal = ventende.type === "okning" ? ventende.plan.radId : null;
      if (ventende.signatur === utkastSignatur(name, newAmount, maal)) {
        await send(ventende, true);
        return;
      }
    }
    setVentende(null);
    setInnleggingStatus(null);
    const itemId = selectedVare?.id ?? findItemByName(items.data, name)?.id ?? null;
    const treff = finnTreff(all, { name, itemId });
    if (treff.length > 0) {
      setVarsel({ navn: name, treff });
      setMaalId(treff.length === 1 ? treff[0]!.rad.id : null);
      return;
    }
    setVarsel(null);
    const vare = await findOrCreateItem(name, selectedVare?.cat ?? "Diverse");
    if (!vare) return;
    await send(
      {
        type: "ny",
        signatur: utkastSignatur(name, newAmount, null),
        plan: {
          opId: crypto.randomUUID(),
          rad: {
            itemId: vare.id,
            name: vare.name,
            amount: newAmount.trim(),
            cat: vare.cat,
            done: false,
          },
        },
      },
      false,
    );
  };
  const add = () => medLaas(() => leggTil(false));

  const okAntallet = () =>
    medLaas(async () => {
      const maal = varsel?.treff.find((t) => t.rad.id === maalId)?.rad;
      if (!maal) return;
      const p = lagOkningsPlan(maal, newAmount, crypto.randomUUID());
      if (!p.kan) return;
      await send(
        { type: "okning", plan: p.plan, signatur: utkastSignatur(newName, newAmount, maal.id) },
        false,
      );
    });

  const provIgjen = () =>
    medLaas(async () => {
      if (ventende) await send(ventende, true);
    });
  const sendSomNy = () => medLaas(() => leggTil(true));

  const toggle = (id: string) => {
    void toggleDone(id);
    if (editingId === id) setEditingId(null);
  };

  const remove = (id: string) => {
    void removeItem(id);
    if (editingId === id) setEditingId(null);
  };

  return (
    <div>
      <Retur ferdig={all.length > 0 && pending.length === 0} ferdigTekst="Handlelisten er klar." />
      <RoomHeader
        eyebrow="KJØKKEN"
        showDate
        title="Handleliste"
        description={
          <span className={styles.statusLine}>
            <span className={styles.statusItem}>
              <Icon name="check" size={13} />
              {done.length} fullført
            </span>
            <span className={styles.statusItem}>
              <Icon name="clock" size={13} />
              {pending.length} gjenstår
            </span>
          </span>
        }
        actions={
          done.length > 0 && (
            <Button variant="secondary" size="compact" onClick={() => void clearDone(all)}>
              <Icon name="trash-2" size={14} />
              Fjern fullførte
            </Button>
          )
        }
      />

      {all.length > 0 && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round((done.length / all.length) * 100)}%` }}
            />
          </div>
          <div className={styles.progressLabel}>
            {Math.round((done.length / all.length) * 100)}% ferdig
          </div>
        </div>
      )}

      <div className={styles.addRow}>
        <Icon name="plus" size={15} className={styles.addIcon} />
        <div className={styles.addPicker}>
          <ItemPicker
            items={items.data}
            value={newName}
            onChange={onNameChange}
            onSelect={(vare) => {
              setNewName(vare.name);
              setSelectedVare(vare);
            }}
            onCreate={(vare) => {
              setNewName(vare.name);
              setSelectedVare(vare);
            }}
            findOrCreateItem={findOrCreateItem}
            placeholder="Hva trenger du?"
          />
        </div>
        <input
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          aria-label="Mengde"
          autoComplete="off"
          placeholder="Mengde"
          className={styles.addAmount}
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={lagrerInnlegging}
          aria-label="Legg til"
          className={styles.addButton}
        >
          <Icon name="arrow-right" size={15} />
        </button>
      </div>

      {varsel && (
        <Innleggingsvarsel
          navn={varsel.navn}
          treff={varsel.treff}
          tillegg={newAmount}
          maalId={maalId}
          lagrer={lagrerInnlegging}
          onVelgMaal={setMaalId}
          onOk={() => void okAntallet()}
          onAvbryt={() => {
            setVarsel(null);
            setMaalId(null);
          }}
        />
      )}
      {innleggingStatus && (
        <InnleggingsMelding
          status={innleggingStatus}
          lagrer={lagrerInnlegging}
          onProvIgjen={() => void provIgjen()}
          onSendSomNy={() => void sendSomNy()}
        />
      )}

      {handlelisteDuplikaterAktiv() && (
        <Duplikater
          rader={all}
          vareNavn={(id) => items.data.find((v) => v.id === id)?.name}
          onSlaaSammen={slaaSammen}
        />
      )}
      {/* Angring av eksisterende sammenslåinger er bevisst UTENFOR porten (ADR 0003). */}
      <Sammenslatte rader={all} onAngre={angreSammenslaing} />

      {all.length === 0 && (
        <div className={styles.empty}>
          <Icon name="shopping-cart" size={32} className={styles.emptyIcon} />
          <div className={styles.emptyText}>Listen er tom</div>
        </div>
      )}

      {categoryOrder(pending).map((cat) => {
        const catItems = pending.filter((i) => i.cat === cat);
        return (
          <div key={cat} className={styles.categoryGroup}>
            <div className={styles.categoryHeader}>
              <Icon
                name={CAT_ICON[cat] ?? "package-open"}
                size={14}
                className={styles.categoryIcon}
              />
              <span className={styles.categoryName}>{cat}</span>
              <div className={styles.categoryLine} />
              <span className={styles.categoryCount}>{catItems.length}</span>
            </div>
            {catItems.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <div key={item.id} className={styles.itemWrap}>
                  <div
                    onClick={() => setEditingId(isEditing ? null : item.id)}
                    className={styles.itemRow}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(item.id);
                      }}
                      aria-label={`Merk ${item.name} som fullført`}
                      className={styles.checkbox}
                    />
                    <span className={styles.itemName}>{item.name}</span>
                    {item.amount && !isEditing && (
                      <span className={styles.itemAmount}>{item.amount}</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(item.id);
                      }}
                      aria-label={`Fjern ${item.name}`}
                      className={styles.removeButton}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  {isEditing && (
                    <div className={styles.editRow}>
                      <input
                        value={item.name}
                        onChange={(e) => void updateField(item.id, "name", e.target.value)}
                        autoComplete="off"
                        className={styles.editName}
                      />
                      <div className={styles.editFields}>
                        <input
                          value={item.amount}
                          onChange={(e) => void updateField(item.id, "amount", e.target.value)}
                          placeholder="Mengde"
                          autoComplete="off"
                          className={styles.editAmount}
                        />
                        <select
                          value={item.cat}
                          onChange={(e) => void updateField(item.id, "cat", e.target.value)}
                          className={styles.editCat}
                        >
                          {SHOP_CATS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Basisvare
                        navn={item.name}
                        staples={staples}
                        lagring={basisvareLagring}
                        onMerk={(navn) => void merkBasisvare(navn)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {done.length > 0 && (
        <div className={styles.doneSection}>
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            className={styles.doneToggle}
          >
            <div className={styles.categoryLine} />
            <span className={styles.doneToggleLabel}>
              <Icon name={showDone ? "chevron-up" : "chevron-down"} size={12} />
              {done.length} FULLFØRT
            </span>
            <div className={styles.categoryLine} />
          </button>
          {showDone && (
            <div className={styles.doneList}>
              {done.map((item) => (
                <div key={item.id} className={styles.doneRow}>
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    aria-label={`Merk ${item.name} som ikke fullført`}
                    className={styles.checkboxDone}
                  >
                    <Icon name="check" size={12} />
                  </button>
                  <span className={styles.doneName}>{item.name}</span>
                  {item.amount && <span className={styles.itemAmount}>{item.amount}</span>}
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    aria-label={`Fjern ${item.name}`}
                    className={styles.removeButton}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
