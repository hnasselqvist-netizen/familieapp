import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import { Duplikater } from "./Duplikater";

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Ost og meieri",
  done: false,
  ...o,
});

function vis(rader: ShoppingItem[], utfall = { utfall: "anvendt" as const }) {
  const onSlaaSammen = vi.fn().mockResolvedValue(utfall);
  const onAngre = vi.fn().mockResolvedValue({ utfall: "anvendt" });
  const user = userEvent.setup();
  render(<Duplikater rader={rader} onSlaaSammen={onSlaaSammen} onAngre={onAngre} />);
  return { onSlaaSammen, onAngre, user };
}

describe("Duplikater i handlelisten", () => {
  it("vises ikke når det ikke finnes duplikater eller sammenslåtte rader", () => {
    const { container } = render(
      <Duplikater rader={[rad("a")]} onSlaaSammen={vi.fn()} onAngre={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("ingenting er forhåndsvalgt, og det finnes ingen bekreftknapp før valgene er gjort", async () => {
    const { user, onSlaaSammen } = vis([rad("a", { amount: "1" }), rad("b", { amount: "2" })]);
    await user.click(screen.getByText("Mulige duplikater (1)"));
    const gruppe = screen.getByRole("group", { name: "Samme vare: Melk" });
    for (const cb of within(gruppe).getAllByRole("checkbox")) expect(cb).not.toBeChecked();
    for (const r of within(gruppe).getAllByRole("radio")) expect(r).not.toBeChecked();
    expect(within(gruppe).queryByRole("button")).toBeNull();
    expect(onSlaaSammen).not.toHaveBeenCalled();
  });

  it("forhåndsvisning viser presist resultat; mengdevalget er eksplisitt; planen sendes én gang", async () => {
    const { user, onSlaaSammen } = vis([rad("a", { amount: "1" }), rad("b", { amount: "2" })]);
    await user.click(screen.getByText("Mulige duplikater (1)"));
    const gruppe = screen.getByRole("group", { name: "Samme vare: Melk" });
    await user.click(within(gruppe).getByLabelText("Ta med Melk (1)"));
    await user.click(within(gruppe).getByLabelText("Ta med Melk (2)"));
    await user.click(within(gruppe).getByLabelText("Behold Melk (1)"));
    const knapp = within(gruppe).getByRole("button", { name: "Slå sammen 2 rader" });
    expect(knapp).toBeDisabled();
    await user.click(within(gruppe).getByLabelText(/Legg sammen: 3/));
    expect(gruppe).toHaveTextContent("Resultat: Melk · 3. 1 rad fjernes og kan hentes tilbake");
    await user.click(knapp);
    expect(onSlaaSammen).toHaveBeenCalledTimes(1);
    expect(onSlaaSammen.mock.calls[0]![0]).toMatchObject({
      beholdId: "a",
      kildeIds: ["b"],
      resultatMengde: "3",
      sett: { a: { amount: "1" }, b: { amount: "2" } },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Radene er slått sammen.");
  });

  it("enheter eller fritekst blokkerer sammenslåing — ingen knapp, tydelig grunn", async () => {
    const { user } = vis([rad("a", { amount: "2 stk" }), rad("b", { amount: "2 stk" })]);
    await user.click(screen.getByText("Mulige duplikater (1)"));
    const gruppe = screen.getByRole("group", { name: "Samme vare: Melk" });
    const [en, to] = within(gruppe).getAllByRole("checkbox");
    await user.click(en!);
    await user.click(to!);
    await user.click(within(gruppe).getAllByRole("radio")[0]!);
    expect(gruppe).toHaveTextContent(/enheter eller fritekst og kan ikke slås sammen trygt/);
    expect(within(gruppe).queryByRole("button")).toBeNull();
  });

  it("kandidat med annen vare-ID vises som usikker og krever eget valg", async () => {
    const { user } = vis([rad("a"), rad("b", { itemId: "v-annen" })]);
    await user.click(screen.getByText("Mulige duplikater (1)"));
    const gruppe = screen.getByRole("group", { name: "Likt navn, kanskje ikke samme vare: Melk" });
    expect(gruppe).toHaveTextContent("Radene peker på ulike varer");
    for (const cb of within(gruppe).getAllByRole("checkbox")) expect(cb).not.toBeChecked();
  });

  it("skiller konflikt og replay fra faktisk anvendt resultat", async () => {
    const konflikt = vis([rad("a", { amount: "1" }), rad("b", { amount: "2" })], {
      utfall: "konflikt",
      grunn: "En av radene er endret, huket av eller flyttet siden forhåndsvisningen.",
    } as never);
    await konflikt.user.click(screen.getByText("Mulige duplikater (1)"));
    const gruppe = screen.getByRole("group", { name: "Samme vare: Melk" });
    await konflikt.user.click(within(gruppe).getByLabelText("Ta med Melk (1)"));
    await konflikt.user.click(within(gruppe).getByLabelText("Ta med Melk (2)"));
    await konflikt.user.click(within(gruppe).getByLabelText("Behold Melk (2)"));
    await konflikt.user.click(within(gruppe).getByLabelText(/Behold én: 2/));
    await konflikt.user.click(within(gruppe).getByRole("button", { name: "Slå sammen 2 rader" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Ikke lagret: En av radene er endret, huket av eller flyttet siden forhåndsvisningen. Se forslaget på nytt.",
    );
  });

  it("sammenslåtte rader kan angres eksplisitt", async () => {
    const { user, onAngre } = vis([
      rad("a", { amount: "3", sammenslaing: { opId: "op-1", tidspunkt: "t", antallKilder: 1 } }),
    ]);
    await user.click(screen.getByText("Mulige duplikater (0)"));
    await user.click(screen.getByRole("button", { name: "Angre sammenslåing av Melk" }));
    expect(onAngre).toHaveBeenCalledWith("a", "op-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Sammenslåingen er angret.");
  });
});
