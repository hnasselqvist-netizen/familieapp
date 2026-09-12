import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";
import { ICON_ASSETS } from "./icons";

describe("Icon", () => {
  it("er skjult for skjermleser når label utelates (dekorativt ikon, følger synlig tekst)", () => {
    const { container } = render(<Icon name="soup" />);
    const el = container.querySelector("span");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).not.toHaveAttribute("role");
    expect(el).not.toHaveAttribute("aria-label");
  });

  it("får tilgjengelig navn og img-rolle når ikonet alene bærer mening", () => {
    const { container } = render(<Icon name="snowflake" label="Fryser" />);
    const el = container.querySelector("span");
    expect(el).toHaveAttribute("role", "img");
    expect(el).toHaveAttribute("aria-label", "Fryser");
    expect(el).not.toHaveAttribute("aria-hidden");
  });

  it("bruker 20px som standardstørrelse for både bredde og høyde", () => {
    const { container } = render(<Icon name="house" />);
    const el = container.querySelector("span") as HTMLElement;
    expect(el.style.width).toBe("20px");
    expect(el.style.height).toBe("20px");
  });

  it("respekterer en eksplisitt size-prop", () => {
    const { container } = render(<Icon name="house" size={32} />);
    const el = container.querySelector("span") as HTMLElement;
    expect(el.style.width).toBe("32px");
    expect(el.style.height).toBe("32px");
  });

  it("standard farge er currentColor — arver fra omkringliggende tekst, ikke en fast hex", () => {
    const { container } = render(<Icon name="house" />);
    const el = container.querySelector("span") as HTMLElement;
    expect(el.style.backgroundColor).toBe("currentcolor");
  });

  it("respekterer en eksplisitt color-prop", () => {
    const { container } = render(<Icon name="house" color="#5E7457" />);
    const el = container.querySelector("span") as HTMLElement;
    expect(el.style.backgroundColor).toBe("rgb(94, 116, 87)");
  });

  it("mask-image peker på den faktisk resolverte asset-URL-en for det gitte ikonnavnet", () => {
    const { container } = render(<Icon name="calendar" />);
    const el = container.querySelector("span") as HTMLElement;
    const styleAttr = el.getAttribute("style") ?? "";
    expect(styleAttr).toContain(ICON_ASSETS.calendar);
  });

  it("to ulike ikonnavn gir to ulike mask-image-URL-er", () => {
    const a = render(<Icon name="calendar" />).container.querySelector("span");
    const b = render(<Icon name="snowflake" />).container.querySelector("span");
    expect(a?.getAttribute("style")).not.toEqual(b?.getAttribute("style"));
  });
});

describe("ICON_ASSETS (registeret)", () => {
  it("hvert registrert ikonnavn resolverer til en ikke-tom asset-URL — beviser at Vite-importene faktisk fungerer, ikke bare at nøkkelen finnes", () => {
    for (const [name, url] of Object.entries(ICON_ASSETS)) {
      expect(url, `${name} skal ha en ikke-tom asset-URL`).toBeTruthy();
      expect(typeof url).toBe("string");
    }
  });

  it("inneholder nøyaktig de 48 ikonene som fantes i assets/icons/ ved denne skiven (28 fra runde 1 + 20 nye fra design-review runde 2, §Kontrolltårn-review, PR #26) — ingen ekstra lagt til, ingen tapt underveis", () => {
    expect(Object.keys(ICON_ASSETS)).toHaveLength(48);
  });
});
