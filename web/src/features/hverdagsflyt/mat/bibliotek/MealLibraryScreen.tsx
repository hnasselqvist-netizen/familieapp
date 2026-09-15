import { useState } from "react";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Icon } from "@components/Icon";
import { ItemPicker } from "@components/ItemPicker";
import { Modal } from "@components/Modal";
import { RoomHeader } from "@components/RoomHeader";
import { useItems } from "@hooks/useItems";
import { useMealLibrary } from "@hooks/useMealLibrary";
import { useRecipes } from "@hooks/useRecipes";
import type { MealVariant, ShoppingBaseItem } from "@app-types/shopping";
import styles from "./MealLibraryScreen.module.css";

const SHOP_UNITS = [
  "stk",
  "g",
  "kg",
  "ml",
  "dl",
  "l",
  "ss",
  "ts",
  "pk",
  "boks",
  "pose",
  "etter behov",
];

/**
 * Middagsbibliotek — tredje Fase 2-skjerm migrert fra index.html
 * (`MealLibraryScreen`, linje ~3090–3282). Funksjonell paritet mot
 * dagens skjerm: rolig administrasjon av familiens faste repertoar, med
 * et enkelt handlegrunnlag (`shoppingBase`) per middag. Ingen ny
 * produktfunksjonalitet — datalaget (`mealLibrary.repository.ts`,
 * `domain/mealLibrary/mealLibrary.ts`) var allerede fullt migrert i
 * PR #7, inkludert den transaksjons-abort-fellen som ble funnet der.
 *
 * **Visuell Kjøkken-harmonisering** (§Kontrolltårn-handoff, Issue #20,
 * "visuelt førsteutkast av resten av Kjøkkenet"): sideheaderen bruker nå
 * `RoomHeader`, "Legg til"-knappen er `Button` (`variant="primary"`), og
 * fargeidentiteten er byttet fra den nøytrale kjernepaletten til
 * Hjem/Kjøkken-paletten (`--g-*`), samme mønster som Middagsplan v1.
 * Rollen her er "familiens repertoar" — oversiktlig og lett å forvalte,
 * derfor UENDRET listestruktur/tetthet, kun fargeidentitet og delte
 * atomer der de faktisk passer. Ingen domenelogikk, datamodell eller
 * produktflyt er endret.
 *
 * **Design-review runde 1: "familiens repertoar" som ett møbel**
 * (§Kontrolltårn-review, PR #26, §5): "Legg til middag" er flyttet fra en
 * alltid-synlig `Card` øverst til en `RoomHeader`-headerhandling som åpner
 * en rolig `Modal` — normalvisningen er nå repertoaret selv, ikke et
 * skjema. Repertoaret er ETT samlet møbel (`.libraryCard`) med innrykkede
 * skillelinjer mellom radene, samme mønster som Middagsplans uke-møbel,
 * i stedet for separate hvite kort per rad. Hver rad har nå en chevron
 * som viser at den åpner detaljer. Opprettelse/handlegrunnlag/sletting
 * fungerer funksjonelt uendret.
 *
 * **Design-review runde 2: enda mer lesende normaltilstand**
 * (§Kontrolltårn-review, PR #26, §3): raden i normaltilstand viser nå
 * KUN navn, sekundærinfo og chevron — den forrige inline ✕-knappen er
 * fjernet fra raden. Sletting skjer nå fra detaljmodalen ("Slett
 * middag"-lenken nederst), slik at hovedflaten leser som repertoar
 * først, forvaltning kommer frem når en middag åpnes. Bekreftelses-
 * modalens knapper bruker nå den delte `Button`-atomen.
 *
 * **Design-review runde 3: fra registerliste til middagskort + søk**
 * (§Helen-review, PR #26, §9): repertoaret er nå selvstendige varme
 * `Card`-flater — én per middag, inspirert av `FreezerScreen` sin
 * kortstruktur — i stedet for runde 1/2 sitt ETT samlede møbel med
 * innrykkede skillelinjer. Reell REVERSERING av den forrige runden, ikke
 * en videreføring: Helen vil at biblioteket skal "oppleves som å åpne
 * familiens middagsrepertoar" fremfor en register-/database-liste.
 * Søkefelt er lagt til under headeren (filtrerer på navn), og
 * sekundærinfo viser nå "N varianter" når `variants` finnes (klar for
 * variant-UI-en i en senere skive, §Helen-review §13) fremfor
 * handlegrunnlagets varetall, siden variantantallet er den mer
 * produktrelevante informasjonen når begge finnes.
 *
 * **Varianter — den låste kjeden fullført som brukerfunksjon**
 * (§Helen-review, PR #26, design-review runde 3, §13): motoren
 * (`addVariant`/`updateVariant`/`removeVariant`, §domain/mealLibrary/
 * mealLibrary.ts) fantes allerede fra variantmodell-skivene (PR #18/#19)
 * — denne skiven legger til den manglende brukerinngangen. Meddetalj-
 * modalen får en "Varianter"-seksjon: "+ Legg til variant" tilbyr de to
 * låste valgene — "Knytt til oppskrift i kokebok" (`source:"recipe"`,
 * søker i `useRecipes`) eller "Legg til enkel variant" (`source:
 * "shoppingBase"`, starter tom, forvaltes med SAMME ItemPicker-mønster
 * som måltidets egen flate `Handlegrunnlag` under — kun skalert til å
 * operere på `updateVariant(...,{source:"shoppingBase",shoppingBase})`
 * i stedet for `transactMealLibraryEntry` direkte). Navneendring bruker
 * en enkel inline rediger-rad, samme mønster som `ActiveMealCard.tsx`
 * sin egendefinerte hendelses-redigering. Den flate `shoppingBase` på
 * selve måltidet er HELT urørt av dette — varianter er additive, akkurat
 * som typen alltid har vært designet for.
 *
 * **Varianter eier handlegrunnlaget når de finnes** (§Helen-test med
 * reelle data, PR #26, §1): så snart middagen har 1+ varianter, er det
 * variantene som er de konkrete gjennomføringene — middagsnivåets flate
 * `Handlegrunnlag`-seksjon (skjema + varerad-liste + "Legg til vare")
 * skjules da til fordel for en rolig forklaringstekst. Dette er REN
 * UI-semantikk/eierskap, ikke en migrering: `openMeal.shoppingBase`
 * fjernes eller endres ALDRI av denne betingelsen — den ligger urørt i
 * lagret data og blir synlig igjen den dagen alle variantene fjernes.
 * 0 varianter beholder dagens flate skjema uendret.
 */
export function MealLibraryScreen() {
  const {
    mealLibrary,
    addEntry,
    removeEntry,
    addShoppingBaseItem,
    updateShoppingBaseItemField,
    clearShoppingBaseItemToFreeText,
    replaceShoppingBaseItemFromPicker,
    removeShoppingBaseItem,
    updateEntryFields,
    addVariant,
    updateVariant,
    removeVariant,
  } = useMealLibrary();
  const { items, findOrCreateItem } = useItems();
  const { recipes } = useRecipes();

  const [name, setName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [openMealId, setOpenMealId] = useState<string | null>(null);
  const [newVareName, setNewVareName] = useState("");
  const [search, setSearch] = useState("");

  const [addVariantMode, setAddVariantMode] = useState<
    "closed" | "choose" | "recipe" | "shoppingBase"
  >("closed");
  const [variantRecipeSearch, setVariantRecipeSearch] = useState("");
  const [newVariantName, setNewVariantName] = useState("");
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editVariantName, setEditVariantName] = useState("");
  const [expandedVariantId, setExpandedVariantId] = useState<string | null>(null);
  const [variantNewVareName, setVariantNewVareName] = useState("");

  const resetVariantUi = () => {
    setAddVariantMode("closed");
    setVariantRecipeSearch("");
    setNewVariantName("");
    setEditingVariantId(null);
    setEditVariantName("");
    setExpandedVariantId(null);
    setVariantNewVareName("");
  };

  if (mealLibrary.status !== "loaded" || items.status !== "loaded" || recipes.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const entries = mealLibrary.data;
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name, "no"));
  const visible = search
    ? sorted.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
    : sorted;
  const deleteTarget = deleteId ? entries.find((m) => m.id === deleteId) : null;
  const openMeal = openMealId ? entries.find((m) => m.id === openMealId) : null;
  const openMealHasVariants = !!openMeal?.variants && openMeal.variants.length > 0;
  const recipeList = recipes.data;
  const variantRecipeHits =
    variantRecipeSearch.trim().length > 0
      ? recipeList
          .filter((r) => r.name.toLowerCase().includes(variantRecipeSearch.toLowerCase()))
          .slice(0, 6)
      : [];

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await addEntry(trimmed);
    setName("");
    setShowAdd(false);
  };

  const remove = async (id: string) => {
    await removeEntry(id);
    setDeleteId(null);
  };

  const createRecipeVariant = async (mealId: string, recipeId: string, recipeName: string) => {
    const finalName = newVariantName.trim() || recipeName;
    await addVariant(mealId, { name: finalName, source: "recipe", recipeId });
    resetVariantUi();
  };

  const createShoppingBaseVariant = async (mealId: string) => {
    const trimmed = newVariantName.trim();
    if (!trimmed) return;
    await addVariant(mealId, { name: trimmed, source: "shoppingBase", shoppingBase: [] });
    resetVariantUi();
  };

  const startEditVariant = (variant: MealVariant) => {
    setEditingVariantId(variant.id);
    setEditVariantName(variant.name);
  };

  const saveVariantName = async (mealId: string) => {
    if (!editingVariantId || !editVariantName.trim()) return;
    await updateVariant(mealId, editingVariantId, { name: editVariantName.trim() });
    setEditingVariantId(null);
    setEditVariantName("");
  };

  const addVariantVare = async (
    mealId: string,
    variant: Extract<MealVariant, { source: "shoppingBase" }>,
    vare: { itemId: string; name: string; cat: string },
  ) => {
    const row: ShoppingBaseItem = {
      id: crypto.randomUUID(),
      itemId: vare.itemId,
      name: vare.name,
      amount: "",
      unit: "",
      cat: vare.cat,
    };
    await updateVariant(mealId, variant.id, {
      source: "shoppingBase",
      shoppingBase: [...variant.shoppingBase, row],
    });
    setVariantNewVareName("");
  };

  const removeVariantVare = async (
    mealId: string,
    variant: Extract<MealVariant, { source: "shoppingBase" }>,
    rowId: string,
  ) => {
    await updateVariant(mealId, variant.id, {
      source: "shoppingBase",
      shoppingBase: variant.shoppingBase.filter((v) => v.id !== rowId),
    });
  };

  return (
    <div>
      <RoomHeader
        eyebrow="KJØKKEN"
        showDate
        title="Middagsbibliotek"
        description={`Familiens faste repertoar — ${sorted.length} middager.`}
        actions={<Button onClick={() => setShowAdd(true)}>＋ Legg til middag</Button>}
      />

      {sorted.length > 0 && (
        <div className={styles.searchRow}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Søk i biblioteket…"
            className={styles.searchInput}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Tøm søk"
              className={styles.clearSearchButton}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      )}

      {sorted.length === 0 && (
        <div className={styles.empty}>Ingen middager i biblioteket ennå.</div>
      )}
      {sorted.length > 0 && visible.length === 0 && (
        <div className={styles.empty}>Ingen middager matcher søket.</div>
      )}

      {visible.length > 0 && (
        <div className={styles.cardList}>
          {visible.map((m) => {
            const secondaryText =
              m.variants && m.variants.length > 0
                ? `${m.variants.length} varianter`
                : m.shoppingBase && m.shoppingBase.length > 0
                  ? `${m.shoppingBase.length} varer`
                  : null;
            return (
              <Card key={m.id} onClick={() => setOpenMealId(m.id)} style={{ padding: "12px 14px" }}>
                <div className={styles.cardRow}>
                  <div className={styles.cardInfo}>
                    <div className={styles.cardName}>{m.name}</div>
                    {secondaryText && <div className={styles.cardMeta}>{secondaryText}</div>}
                  </div>
                  <Icon name="chevron-right" size={16} className={styles.chevron} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showAdd && (
        <Modal
          title="Legg til middag"
          onClose={() => {
            setShowAdd(false);
            setName("");
          }}
        >
          <div className={styles.addRow}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="f.eks. Kyllingsuppe"
              autoComplete="off"
              className={styles.nameInput}
            />
            <Button onClick={() => void add()} disabled={!name.trim()}>
              Legg til
            </Button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Slette middag?" onClose={() => setDeleteId(null)}>
          <div className={styles.confirmText}>
            {deleteTarget && `«${deleteTarget.name}»`} fjernes fra biblioteket. Ukeplaner som
            allerede bruker denne middagen påvirkes ikke.
          </div>
          <div className={styles.confirmActions}>
            <Button
              variant="secondary"
              onClick={() => setDeleteId(null)}
              className={styles.actionButton}
            >
              Avbryt
            </Button>
            <Button
              variant="destructive"
              onClick={() => void remove(deleteId)}
              className={styles.actionButton}
            >
              Slett
            </Button>
          </div>
        </Modal>
      )}

      {openMeal && (
        <Modal
          title={openMeal.name}
          onClose={() => {
            setOpenMealId(null);
            setNewVareName("");
            resetVariantUi();
          }}
        >
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={openMeal.lettvint ?? false}
              onChange={(e) => void updateEntryFields(openMeal.id, { lettvint: e.target.checked })}
            />
            🍃 Lettvint middag
          </label>
          <div className={styles.formLabel}>
            Variasjonstagger <span className={styles.optional}>(valgfritt)</span>
          </div>
          <input
            value={(openMeal.variationTags ?? []).join(", ")}
            onChange={(e) =>
              void updateEntryFields(openMeal.id, {
                variationTags: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            autoComplete="off"
            placeholder="fisk, pasta, pizza…"
            className={styles.variationTagsInput}
          />
          <div className={styles.fieldHint}>
            Brukes KUN av Førsteutkast for å unngå at like middager havner rett etter hverandre.
          </div>

          <div className={styles.formLabel}>Varianter</div>
          <div className={styles.variantList}>
            {(openMeal.variants ?? []).map((variant) => {
              const isEditingName = editingVariantId === variant.id;
              const isExpanded = expandedVariantId === variant.id;
              const sourceLabel =
                variant.source === "recipe"
                  ? (recipeList.find((r) => r.id === variant.recipeId)?.name ?? "Oppskrift fjernet")
                  : `${variant.shoppingBase.length} varer`;
              if (isEditingName) {
                return (
                  <div key={variant.id} className={styles.variantEditRow}>
                    <input
                      autoFocus
                      value={editVariantName}
                      onChange={(e) => setEditVariantName(e.target.value)}
                      placeholder="Variantnavn"
                      className={styles.variantEditInput}
                    />
                    <button
                      type="button"
                      onClick={() => void saveVariantName(openMeal.id)}
                      className={styles.eventEditSave}
                    >
                      Lagre
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingVariantId(null);
                        setEditVariantName("");
                      }}
                      className={styles.cancelLink}
                    >
                      Avbryt
                    </button>
                  </div>
                );
              }
              return (
                <div key={variant.id} className={styles.variantBlock}>
                  <div className={styles.variantRow}>
                    <Icon
                      name={variant.source === "recipe" ? "book-open" : "folder-open"}
                      size={15}
                      className={styles.variantIcon}
                    />
                    <div className={styles.variantInfo}>
                      <div className={styles.variantName}>{variant.name}</div>
                      <div className={styles.variantMeta}>{sourceLabel}</div>
                    </div>
                    {variant.source === "shoppingBase" && (
                      <button
                        type="button"
                        onClick={() => setExpandedVariantId(isExpanded ? null : variant.id)}
                        aria-label={`${isExpanded ? "Skjul" : "Vis"} handlegrunnlag for ${variant.name}`}
                        className={styles.variantExpandButton}
                      >
                        <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEditVariant(variant)}
                      aria-label={`Rediger navn på ${variant.name}`}
                      className={styles.variantEditButton}
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeVariant(openMeal.id, variant.id)}
                      aria-label={`Fjern varianten ${variant.name}`}
                      className={styles.removeButton}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  {variant.source === "shoppingBase" && isExpanded && (
                    <div className={styles.variantVareList}>
                      {variant.shoppingBase.map((vare) => (
                        <div key={vare.id} className={styles.variantVareRow}>
                          <span className={styles.variantVareName}>{vare.name}</span>
                          <button
                            type="button"
                            onClick={() => void removeVariantVare(openMeal.id, variant, vare.id)}
                            aria-label={`Fjern ${vare.name} fra ${variant.name}`}
                            className={styles.removeButton}
                          >
                            <Icon name="x" size={13} />
                          </button>
                        </div>
                      ))}
                      {variant.shoppingBase.length === 0 && (
                        <div className={styles.emptyVare}>Ingen varer registrert ennå.</div>
                      )}
                      <ItemPicker
                        items={items.data}
                        value={variantNewVareName}
                        onChange={setVariantNewVareName}
                        onSelect={(vare) =>
                          void addVariantVare(openMeal.id, variant, {
                            itemId: vare.id,
                            name: vare.name,
                            cat: vare.cat,
                          })
                        }
                        onCreate={(vare) =>
                          void addVariantVare(openMeal.id, variant, {
                            itemId: vare.id,
                            name: vare.name,
                            cat: vare.cat,
                          })
                        }
                        findOrCreateItem={findOrCreateItem}
                        placeholder="Legg til vare i varianten…"
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {(!openMeal.variants || openMeal.variants.length === 0) && (
              <div className={styles.emptyVare}>Ingen varianter ennå.</div>
            )}
          </div>

          {addVariantMode === "closed" && (
            <button
              type="button"
              onClick={() => setAddVariantMode("choose")}
              className={styles.addVariantLink}
            >
              <Icon name="plus" size={14} />＋ Legg til variant
            </button>
          )}

          {addVariantMode === "choose" && (
            <div className={styles.variantChoiceRow}>
              <button
                type="button"
                onClick={() => setAddVariantMode("recipe")}
                className={styles.variantChoiceButton}
              >
                <Icon name="book-open" size={15} />
                Knytt til oppskrift i kokebok
              </button>
              <button
                type="button"
                onClick={() => setAddVariantMode("shoppingBase")}
                className={styles.variantChoiceButton}
              >
                <Icon name="folder-open" size={15} />
                Legg til enkel variant
              </button>
              <button type="button" onClick={resetVariantUi} className={styles.cancelLink}>
                Avbryt
              </button>
            </div>
          )}

          {addVariantMode === "recipe" && (
            <div className={styles.variantAddForm}>
              <input
                value={newVariantName}
                onChange={(e) => setNewVariantName(e.target.value)}
                placeholder="Variantnavn (valgfritt — bruker oppskriftens navn ellers)"
                autoComplete="off"
                className={styles.variantEditInput}
              />
              <input
                autoFocus
                value={variantRecipeSearch}
                onChange={(e) => setVariantRecipeSearch(e.target.value)}
                placeholder="Søk etter oppskrift…"
                autoComplete="off"
                className={styles.variantEditInput}
              />
              <div className={styles.vareList}>
                {variantRecipeHits.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => void createRecipeVariant(openMeal.id, r.id, r.name)}
                    className={styles.hitRow}
                  >
                    {r.name}
                  </button>
                ))}
                {variantRecipeSearch.trim().length > 0 && variantRecipeHits.length === 0 && (
                  <div className={styles.emptyVare}>Ingen oppskrifter matcher søket.</div>
                )}
              </div>
              <button type="button" onClick={resetVariantUi} className={styles.cancelLink}>
                Avbryt
              </button>
            </div>
          )}

          {addVariantMode === "shoppingBase" && (
            <div className={styles.variantAddForm}>
              <input
                autoFocus
                value={newVariantName}
                onChange={(e) => setNewVariantName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void createShoppingBaseVariant(openMeal.id)}
                placeholder="Variantens navn, f.eks. Grandiosa"
                autoComplete="off"
                className={styles.variantEditInput}
              />
              <div className={styles.confirmActions}>
                <Button
                  variant="secondary"
                  onClick={resetVariantUi}
                  className={styles.actionButton}
                >
                  Avbryt
                </Button>
                <Button
                  onClick={() => void createShoppingBaseVariant(openMeal.id)}
                  disabled={!newVariantName.trim()}
                  className={styles.actionButton}
                >
                  Opprett
                </Button>
              </div>
            </div>
          )}

          {openMealHasVariants ? (
            <div className={styles.fieldHint}>
              Handlegrunnlaget styres nå av variantene over — hver variant eier sin egen kilde.
              Middagens eget handlegrunnlag er skjult, ikke slettet.
            </div>
          ) : (
            <>
              <div className={styles.formLabel}>Handlegrunnlag</div>
              <div className={styles.vareList}>
                {(openMeal.shoppingBase ?? []).map((vare: ShoppingBaseItem) => (
                  <div key={vare.id} className={styles.vareRow}>
                    <div className={styles.varePicker}>
                      <ItemPicker
                        items={items.data}
                        value={vare.name}
                        onChange={(val) =>
                          void clearShoppingBaseItemToFreeText(openMeal.id, vare.id, val)
                        }
                        onSelect={(nyVare) =>
                          void replaceShoppingBaseItemFromPicker(openMeal.id, vare.id, nyVare)
                        }
                        onCreate={(nyVare) =>
                          void replaceShoppingBaseItemFromPicker(openMeal.id, vare.id, nyVare)
                        }
                        findOrCreateItem={findOrCreateItem}
                      />
                    </div>
                    <input
                      value={vare.amount}
                      onChange={(e) =>
                        void updateShoppingBaseItemField(
                          openMeal.id,
                          vare.id,
                          "amount",
                          e.target.value,
                        )
                      }
                      placeholder="mengde"
                      className={styles.vareAmount}
                    />
                    <select
                      value={vare.unit || ""}
                      onChange={(e) =>
                        void updateShoppingBaseItemField(
                          openMeal.id,
                          vare.id,
                          "unit",
                          e.target.value,
                        )
                      }
                      className={styles.vareUnit}
                    >
                      <option value="">enhet</option>
                      {SHOP_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void removeShoppingBaseItem(openMeal.id, vare.id)}
                      aria-label={`Fjern ${vare.name} fra handlegrunnlaget`}
                      className={styles.removeButton}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {(!openMeal.shoppingBase || openMeal.shoppingBase.length === 0) && (
                  <div className={styles.emptyVare}>Ingen varer registrert ennå.</div>
                )}
              </div>
              <div className={styles.newVareRow}>
                <ItemPicker
                  items={items.data}
                  value={newVareName}
                  onChange={setNewVareName}
                  onSelect={(vare) => {
                    void addShoppingBaseItem(openMeal.id, {
                      itemId: vare.id,
                      name: vare.name,
                      cat: vare.cat,
                    });
                    setNewVareName("");
                  }}
                  onCreate={(vare) => {
                    void addShoppingBaseItem(openMeal.id, {
                      itemId: vare.id,
                      name: vare.name,
                      cat: vare.cat,
                    });
                    setNewVareName("");
                  }}
                  findOrCreateItem={findOrCreateItem}
                  placeholder="Legg til vare…"
                />
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setDeleteId(openMeal.id);
              setOpenMealId(null);
              setNewVareName("");
            }}
            className={styles.deleteLink}
          >
            <Icon name="trash-2" size={14} />
            Slett middag
          </button>
        </Modal>
      )}
    </div>
  );
}
