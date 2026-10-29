import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemPicker, type ItemPickerProps } from "./ItemPicker";
import styles from "./ItemPicker.module.css";
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

  it("render forslagslisten via en portal til document.body — ikke klippet av en overflow-begrenset forelder", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div style={{ overflow: "hidden", height: 40 }}>
        <ControlledItemPicker
          items={items}
          onSelect={vi.fn()}
          onCreate={vi.fn()}
          findOrCreateItem={vi.fn()}
        />
      </div>,
    );

    await user.type(screen.getByRole("textbox"), "Karbonade");
    const suggestion = await screen.findByText("Karbonadedeig");

    // Portalen render UTENFOR den overflow-begrensede forelderen (§Helen-test
    // med reelle data, PR #26, §2) — dette er selve funnet: en tidligere
    // absolutt-posisjonert dropdown ble klippet av enhver scrollende
    // forelder, uansett z-index.
    expect(container.contains(suggestion)).toBe(false);
    expect(document.body.contains(suggestion)).toBe(true);
  });
});

/**
 * #82: simulerer WebKit med skjermtastaturet åpent. `getBoundingClientRect()`
 * er relativt til den synlige viewporten, som er panorert `vv.offsetTop`
 * ned i layout-viewporten, mens `position:fixed` (listens inline `top`) er
 * i layoutkoordinater. Før rettingen havnet listen `offsetTop` px for høyt.
 */
describe("ItemPicker — plassering med iOS-tastatur (#82)", () => {
  const LISTEHOYDE = 150;
  const OVER = styles.over as string;
  const inputLayout = { top: 500, bottom: 532, left: 24, width: 300 };

  class FalskVisualViewport extends EventTarget {
    offsetTop = 0;
    height = 844;
  }

  function rekt(top: number, bottom: number, left: number, width: number): DOMRect {
    return {
      top,
      bottom,
      left,
      right: left + width,
      width,
      height: bottom - top,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function simulerWebKit(vv: FalskVisualViewport) {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const forsk = vv.offsetTop;
      if (this instanceof HTMLInputElement) {
        return rekt(
          inputLayout.top - forsk,
          inputLayout.bottom - forsk,
          inputLayout.left,
          inputLayout.width,
        );
      }
      const el = this as HTMLElement;
      if (el.style.top !== "") {
        const satt = parseFloat(el.style.top);
        const topp = el.classList.contains(OVER) ? satt - LISTEHOYDE : satt;
        return rekt(
          topp - forsk,
          topp + LISTEHOYDE - forsk,
          parseFloat(el.style.left),
          parseFloat(el.style.width),
        );
      }
      return rekt(0, 0, 0, 0);
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "visualViewport");
  });

  async function apneListe() {
    const user = userEvent.setup();
    render(
      <ControlledItemPicker
        items={items}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        findOrCreateItem={vi.fn()}
      />,
    );
    await user.type(screen.getByRole("textbox"), "Løvb");
    const opprett = await screen.findByText("＋ Opprett «Løvb»");
    return { input: screen.getByRole("textbox"), liste: opprett.parentElement as HTMLElement };
  }

  it("tastaturet er allerede åpent når listen vises: listen ankres til inputen, ikke 300px over", async () => {
    const vv = new FalskVisualViewport();
    vv.offsetTop = 300;
    vv.height = 400; // synlig område i layoutkoordinater: 300–700, god plass under inputen
    simulerWebKit(vv);

    const { input, liste } = await apneListe();

    expect(liste.classList.contains(OVER)).toBe(false);
    expect(liste.getBoundingClientRect().top).toBe(input.getBoundingClientRect().bottom);
    expect(parseFloat(liste.style.top)).toBe(inputLayout.bottom);
  });

  it("tastaturet åpnes etter at listen vises: følger visualViewport resize/scroll og legges over inputen", async () => {
    const vv = new FalskVisualViewport();
    simulerWebKit(vv);
    const { input, liste } = await apneListe();
    expect(liste.getBoundingClientRect().top).toBe(input.getBoundingClientRect().bottom);

    // iOS panorerer den synlige viewporten og krymper den — uten window-scroll.
    act(() => {
      vv.offsetTop = 330;
      vv.height = 220; // synlig: 330–550; under inputen er det bare 18px igjen
      vv.dispatchEvent(new Event("resize"));
      vv.dispatchEvent(new Event("scroll"));
    });

    const listeNa = screen.getByText("＋ Opprett «Løvb»").parentElement as HTMLElement;
    expect(listeNa.classList.contains(OVER)).toBe(true);
    expect(listeNa.getBoundingClientRect().bottom).toBe(input.getBoundingClientRect().top);
    expect(parseFloat(listeNa.style.maxHeight)).toBeGreaterThan(0);
  });

  it("tastaturet lukkes: listen går tilbake under inputen uten restavvik", async () => {
    const vv = new FalskVisualViewport();
    vv.offsetTop = 330;
    vv.height = 220;
    simulerWebKit(vv);
    const { input } = await apneListe();

    act(() => {
      vv.offsetTop = 0;
      vv.height = 844;
      vv.dispatchEvent(new Event("resize"));
    });

    const liste = screen.getByText("＋ Opprett «Løvb»").parentElement as HTMLElement;
    expect(liste.classList.contains(OVER)).toBe(false);
    expect(liste.getBoundingClientRect().top).toBe(input.getBoundingClientRect().bottom);
    expect(parseFloat(liste.style.top)).toBe(inputLayout.bottom);
  });
});
