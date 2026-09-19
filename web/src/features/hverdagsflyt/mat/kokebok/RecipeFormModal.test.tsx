/**
 * Regresjonstester for `Ingredient`↔`Vare`-koblingen (§Kontrolltårn-
 * handoff, Issue #2: "alt som er likt skal hentes fra samme sted").
 * Verifiserer den FAKTISKE UI-flyten (ItemPicker → radtilstand → lagring),
 * ikke bare de interne hjelpefunksjonene — samme mønster som
 * `ItemPicker.test.tsx`.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecipeFormModal } from "./RecipeFormModal";
import type { Recipe } from "@app-types/recipe";
import type { Vare } from "@app-types/vare";

const items: Vare[] = [{ id: "v1", name: "Kjøttdeig", cat: "Kjøtt" }];

const baseRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: "r1",
  name: "Taco",
  cat: "Middag",
  tags: [],
  time: 20,
  servings: 4,
  url: "",
  imageUrl: null,
  source: "quick",
  instructions: "",
  ingredients: [],
  ingredientGroups: [],
  lastCooked: null,
  timesCooked: 0,
  createdAt: 0,
  ...overrides,
});

describe("RecipeFormModal — Ingredient↔Vare-kobling", () => {
  it("ny oppskrift: velger en eksisterende vare og bevarer itemId+kategori ved lagring", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <RecipeFormModal
        initial={null}
        onSave={onSave}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText("Tomatsuppe…"), "Taco");
    await user.type(screen.getByPlaceholderText("f.eks. Kjøttdeig"), "Kjøttdeig");
    await user.click(await screen.findByText("Kjøttdeig"));

    await user.click(screen.getByRole("button", { name: "💾 Lagre oppskrift" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const patch = onSave.mock.calls[0]?.[0];
    expect(patch.ingredients).toEqual([
      { name: "Kjøttdeig", amount: "", unit: "stk", cat: "Kjøtt", itemId: "v1" },
    ]);
  });

  it("redigering: en allerede koblet ingrediens beholder itemId+kategori når raden ikke røres", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const recipe = baseRecipe({
      ingredients: [{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt", itemId: "v1" }],
    });

    render(
      <RecipeFormModal
        initial={recipe}
        onSave={onSave}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "💾 Lagre endringer" }));

    const patch = onSave.mock.calls[0]?.[0];
    expect(patch.ingredients).toEqual([
      { name: "Kjøttdeig", amount: "500 g", unit: "g", cat: "Kjøtt", itemId: "v1" },
    ]);
  });

  it("eldre oppskrift uten itemId: navn/fallback bevares uendret, ingen tvungen kobling", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    // Ingen `itemId` — speiler data registrert FØR denne koblingen fantes.
    const recipe = baseRecipe({
      ingredients: [{ name: "Løk", amount: "2 stk", cat: "Diverse" }],
    });

    render(
      <RecipeFormModal
        initial={recipe}
        onSave={onSave}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "💾 Lagre endringer" }));

    const patch = onSave.mock.calls[0]?.[0];
    expect(patch.ingredients).toEqual([
      { name: "Løk", amount: "2 stk", unit: "stk", cat: "Diverse", itemId: null },
    ]);
  });
});

/**
 * §Kontrolltårn-handoff, Issue #20, "Kjøkken v1": `imageUrl`/`url` fantes
 * allerede i datamodellen og ble vist i detaljvisningen, men hadde ingen
 * UI noe sted for å faktisk SETTE dem (kun den bevisst utelatte AI-
 * hente-flyten skrev dem). Disse testene beviser den nye, ordinære
 * fritekst-redigeringen av begge feltene.
 */
describe("RecipeFormModal — bilde-URL og kilde-lenke", () => {
  it("ny oppskrift: bilde-URL og kilde-lenke er tomme som standard, og inkluderes ikke i patchen når de forblir tomme", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <RecipeFormModal
        initial={null}
        onSave={onSave}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText("Tomatsuppe…"), "Taco");
    await user.click(screen.getByRole("button", { name: "💾 Lagre oppskrift" }));

    const patch = onSave.mock.calls[0]?.[0];
    expect(patch.imageUrl).toBeNull();
    expect(patch.url).toBe("");
  });

  it("ny oppskrift: bilde-URL og kilde-lenke lagres når de fylles ut", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <RecipeFormModal
        initial={null}
        onSave={onSave}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText("Tomatsuppe…"), "Taco");
    await user.type(screen.getByPlaceholderText("https://…"), "https://example.com/bilde.jpg");
    await user.type(
      screen.getByPlaceholderText("https://… (originaloppskriften)"),
      "https://example.com/oppskrift",
    );
    await user.click(screen.getByRole("button", { name: "💾 Lagre oppskrift" }));

    const patch = onSave.mock.calls[0]?.[0];
    expect(patch.imageUrl).toBe("https://example.com/bilde.jpg");
    expect(patch.url).toBe("https://example.com/oppskrift");
  });

  it("redigering: eksisterende bilde-URL/kilde-lenke er forhåndsutfylt og bevares når feltene ikke røres", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const recipe = baseRecipe({
      imageUrl: "https://example.com/gammelt-bilde.jpg",
      url: "https://example.com/gammel-kilde",
    });

    render(
      <RecipeFormModal
        initial={recipe}
        onSave={onSave}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("https://example.com/gammelt-bilde.jpg")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://example.com/gammel-kilde")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "💾 Lagre endringer" }));

    const patch = onSave.mock.calls[0]?.[0];
    expect(patch.imageUrl).toBe("https://example.com/gammelt-bilde.jpg");
    expect(patch.url).toBe("https://example.com/gammel-kilde");
  });

  it("redigering: bilde-URL kan fjernes igjen (tomt felt lagres som null)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const recipe = baseRecipe({ imageUrl: "https://example.com/bilde.jpg" });

    render(
      <RecipeFormModal
        initial={recipe}
        onSave={onSave}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    await user.clear(screen.getByDisplayValue("https://example.com/bilde.jpg"));
    await user.click(screen.getByRole("button", { name: "💾 Lagre endringer" }));

    const patch = onSave.mock.calls[0]?.[0];
    expect(patch.imageUrl).toBeNull();
  });
});

/**
 * §Kontrolltårn-review, PR #28: skjemaet var tidligere én flat feltliste —
 * disse testene beviser at det nå faktisk følger den låste firedelte
 * historien (§designbok.md), i riktig rekkefølge, med ingrediensene som
 * HJERTET plassert mellom "Hva er dette?" og "Hvordan gjør vi det?". Bruker
 * `container.innerHTML`-indekser som stabilt holdepunkt — testen bryr seg
 * kun om rekkefølge/tilstedeværelse, ikke om CSS-klassenavn.
 */
describe("RecipeFormModal — firedelt historiestruktur", () => {
  it("viser alle fire seksjonsoverskrifter i låst rekkefølge, med ingrediensene mellom «Hva er dette?» og «Hvordan gjør vi det?»", () => {
    const { container } = render(
      <RecipeFormModal
        initial={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    expect(screen.getByText("Hva er dette?")).toBeInTheDocument();
    expect(screen.getByText("Hva trenger vi?")).toBeInTheDocument();
    expect(screen.getByText("Hvordan gjør vi det?")).toBeInTheDocument();
    expect(screen.getByText("Hvem passer den for?")).toBeInTheDocument();

    const html = container.innerHTML;
    const iHvaErDette = html.indexOf("Hva er dette?");
    const iIngrediensrad = html.indexOf("f.eks. Kjøttdeig");
    const iHvaTrengerVi = html.indexOf("Hva trenger vi?");
    const iHvordan = html.indexOf("Hvordan gjør vi det?");
    const iHvemPasser = html.indexOf("Hvem passer den for?");

    expect(iHvaErDette).toBeGreaterThanOrEqual(0);
    expect(iHvaTrengerVi).toBeGreaterThan(iHvaErDette);
    expect(iIngrediensrad).toBeGreaterThan(iHvaTrengerVi);
    expect(iHvordan).toBeGreaterThan(iIngrediensrad);
    expect(iHvemPasser).toBeGreaterThan(iHvordan);
  });

  it("plasserer porsjoner/tid/lettvint/variasjonstagger i «Hvem passer den for?»-seksjonen, ikke sammen med navn/kategori", () => {
    const { container } = render(
      <RecipeFormModal
        initial={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    const html = container.innerHTML;
    const iHvemPasser = html.indexOf("Hvem passer den for?");
    const iPorsjoner = html.indexOf("Porsjoner");
    const iTid = html.indexOf("Tid (min)");
    const iVariasjon = html.indexOf("Variasjonstagger");

    expect(iPorsjoner).toBeGreaterThan(iHvemPasser);
    expect(iTid).toBeGreaterThan(iHvemPasser);
    expect(iVariasjon).toBeGreaterThan(iHvemPasser);
  });

  it("plasserer bilde-URL/kilde-lenke i «Hva er dette?»-seksjonen, sammen med navn/kategori", () => {
    const { container } = render(
      <RecipeFormModal
        initial={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    const html = container.innerHTML;
    const iHvaErDette = html.indexOf("Hva er dette?");
    const iHvaTrengerVi = html.indexOf("Hva trenger vi?");
    const iBildeUrl = html.indexOf("Bilde-URL");
    const iKildeLenke = html.indexOf("Kilde-lenke");

    expect(iBildeUrl).toBeGreaterThan(iHvaErDette);
    expect(iBildeUrl).toBeLessThan(iHvaTrengerVi);
    expect(iKildeLenke).toBeGreaterThan(iHvaErDette);
    expect(iKildeLenke).toBeLessThan(iHvaTrengerVi);
  });
});
