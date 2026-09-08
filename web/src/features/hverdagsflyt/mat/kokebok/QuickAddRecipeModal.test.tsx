/**
 * Regresjonstest for `Ingredient`↔`Vare`-koblingen (§Kontrolltårn-
 * handoff, Issue #2) — samme fiks/mønster som `RecipeFormModal.test.tsx`,
 * men for hurtigregistreringsflyten.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickAddRecipeModal } from "./QuickAddRecipeModal";
import type { Vare } from "@app-types/vare";

const items: Vare[] = [{ id: "v1", name: "Kjøttdeig", cat: "Kjøtt" }];

describe("QuickAddRecipeModal — Ingredient↔Vare-kobling", () => {
  it("oppretter en ny oppskrift og bevarer itemId+kategori fra valgt vare", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <QuickAddRecipeModal
        onSave={onSave}
        onClose={vi.fn()}
        items={items}
        findOrCreateItem={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText("Navn på retten…"), "Taco");
    await user.type(screen.getByPlaceholderText("f.eks. Kjøttdeig"), "Kjøttdeig");
    await user.click(await screen.findByText("Kjøttdeig"));

    await user.click(screen.getByRole("button", { name: "Lagre «Taco»" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const fields = onSave.mock.calls[0]?.[0];
    expect(fields.ingredients).toEqual([
      { name: "Kjøttdeig", amount: "", unit: "stk", cat: "Kjøtt", itemId: "v1" },
    ]);
  });
});
