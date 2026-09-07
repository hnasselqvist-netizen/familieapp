import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ItemPicker, type ItemPickerProps } from "./ItemPicker";
import type { Vare } from "@app-types/vare";

const items: Vare[] = [
  { id: "1", name: "Karbonadedeig", cat: "Kjøtt" },
  { id: "2", name: "Karbonadesaus", cat: "Diverse" },
];

/** Kontrollert wrapper — speiler hvordan ItemPicker faktisk brukes (verdi eid av forelder). */
function ControlledItemPicker(props: Omit<ItemPickerProps, "value" | "onChange">) {
  const [value, setValue] = useState("");
  return <ItemPicker {...props} value={value} onChange={setValue} />;
}

describe("ItemPicker", () => {
  it("viser treff som matcher det som skrives, og velger en eksisterende vare", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <ControlledItemPicker
        items={items}
        onSelect={onSelect}
        onCreate={vi.fn()}
        findOrCreateItem={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox");
    await user.type(input, "Karbonade");
    expect(input).toHaveValue("Karbonade");
    expect(screen.getByText("Karbonadedeig")).toBeInTheDocument();
    expect(screen.getByText("Karbonadesaus")).toBeInTheDocument();

    await user.click(screen.getByText("Karbonadedeig"));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
    expect(input).toHaveValue("Karbonadedeig");
  });

  it("tilbyr 'Opprett' når ingen eksakt treff finnes, og fullfører opprettelsen med valgt kategori", async () => {
    const user = userEvent.setup();
    const nyVare: Vare = { id: "3", name: "Reinsdyrfilet", cat: "Kjøtt" };
    const findOrCreateItem = vi.fn().mockResolvedValue(nyVare);
    const onCreate = vi.fn();

    render(
      <ControlledItemPicker
        items={items}
        onSelect={vi.fn()}
        onCreate={onCreate}
        findOrCreateItem={findOrCreateItem}
      />,
    );

    await user.type(screen.getByRole("textbox"), "Reinsdyrfilet");
    await user.click(await screen.findByText("＋ Opprett «Reinsdyrfilet»"));
    await user.click(screen.getByRole("button", { name: "Kjøtt" }));

    await waitFor(() => {
      expect(findOrCreateItem).toHaveBeenCalledWith("Reinsdyrfilet", "Kjøtt");
      expect(onCreate).toHaveBeenCalledWith(nyVare);
    });
  });
});
