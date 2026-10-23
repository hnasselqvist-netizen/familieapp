import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import type { SammenslaingsPlan } from "@domain/shopping/handlelisteDuplikater";
import { Duplikater, Sammenslatte } from "./Duplikater";
import skjerm from "./HandlelisteScreen.tsx?raw";

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const VARER: Record<string, string> = {
  "v-melk": "Melk",
  "v-melk2": "Melk",
  "v-annen": "Lettmelk",
};
const vareNavn = (id: string) => VARER[id];

function vis(rader: ShoppingItem[], utfall: object = { utfall: "anvendt" }) {
  const onSlaaSammen = vi.fn().mockResolvedValue(utfall);
  const onAngre = vi.fn().mockResolvedValue({ utfall: "anvendt" });
  const user = userEvent.setup();
  const begge = (rr: ShoppingItem[]) => (
    <>
      <Duplikater rader={rr} vareNavn={vareNavn} onSlaaSammen={onSlaaSammen} />
      <Sammenslatte rader={rr} onAngre={onAngre} />
    </>
  );
  const r = render(begge(rader));
  const rerender = (nye: ShoppingItem[]) => r.rerender(begge(nye));
  return { onSlaaSammen, onAngre, user, rerender };
}

/** Åpner panelet og velger a+b, beholder `behold`. */
async function velg(
  user: ReturnType<typeof userEvent.setup>,
  gruppenavn: string,
  behold: "a" | "b",
) {
  await user.click(screen.getByText(/Mulige duplikater/));
  const gruppe = screen.getByRole("group", { name: gruppenavn });
  const [a, b] = within(gruppe).getAllByRole("checkbox");
  await user.click(a!);
  await user.click(b!);
  const radioer = within(gruppe).getAllByRole("radio");
  await user.click(radioer[behold === "a" ? 0 : 1]!);
  return gruppe;
}

describe("Duplikater i handlelisten", () => {
  it("vises ikke når det ikke finnes duplikater eller sammenslåtte rader", () => {
    const { container } = render(
      <>
        <Duplikater rader={[rad("a")]} onSlaaSammen={vi.fn()} />
        <Sammenslatte rader={[rad("a")]} onAngre={vi.fn()} />
      </>,
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
    const gruppe = await velg(user, "Samme vare: Melk", "a");
    const knapp = within(gruppe).getByRole("button", { name: "Slå sammen 2 rader" });
    expect(knapp).toBeDisabled();
    await user.click(within(gruppe).getByLabelText(/Legg sammen: 3/));
    expect(gruppe).toHaveTextContent(
      "Resultat: Melk · Ost og meieri · vare: Melk · 3. 1 rad fjernes og kan hentes tilbake",
    );
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

  it("resultatet viser BEHOLDT rad sin identitet, også når den er nummer to med annet navn og kategori", async () => {
    const { user } = vis([
      rad("a", { name: "Melk", cat: "Ost og meieri", amount: "1" }),
      rad("b", { name: "melk", cat: "Drikke", amount: "2" }),
    ]);
    const gruppe = await velg(user, "Samme vare: Melk", "b");
    await user.click(within(gruppe).getByLabelText(/Behold én: 2/));
    expect(gruppe).toHaveTextContent("Resultat: melk · Drikke · vare: Melk · 2.");
    expect(gruppe).not.toHaveTextContent("Resultat: Melk · Ost og meieri");
  });

  it("navnelike kandidater med ulik varetilknytning skilles forståelig, uten rå ID-er", async () => {
    vis([
      rad("a", { itemId: "v-melk" }),
      rad("b", { itemId: "v-melk2" }),
      rad("c", { itemId: null }),
    ]);
    await userEvent.setup().click(screen.getByText(/Mulige duplikater/));
    const gruppe = screen.getByRole("group", { name: "Likt navn, kanskje ikke samme vare: Melk" });
    expect(gruppe).toHaveTextContent("vare: Melk (vare 1)");
    expect(gruppe).toHaveTextContent("vare: Melk (vare 2)");
    expect(gruppe).toHaveTextContent("ingen vare");
    expect(gruppe).not.toHaveTextContent("v-melk");
    for (const cb of within(gruppe).getAllByRole("checkbox")) expect(cb).not.toBeChecked();
  });

  const endringer: [string, Partial<ShoppingItem>][] = [
    ["mengde", { amount: "20" }],
    ["navn", { name: "Melk " }],
    ["kategori", { cat: "Drikke" }],
  ];
  for (const [felt, endring] of endringer) {
    it(`ekstern endring av ${felt} etter valg: gammelt valg gjelder ikke, ny plan krever nytt valg`, async () => {
      const { user, onSlaaSammen, rerender } = vis([
        rad("a", { amount: "1" }),
        rad("b", { amount: "2" }),
      ]);
      const gruppe = await velg(user, "Samme vare: Melk", "a");
      await user.click(within(gruppe).getByLabelText(/Legg sammen: 3/));
      rerender([rad("a", { amount: "1" }), rad("b", { amount: "2", ...endring })]);
      const g = screen
        .getAllByRole("group")
        .find((x) => x.querySelector("[type=checkbox]:checked"));
      expect(g).toBeDefined();
      expect(g!).toHaveTextContent("En av radene er endret etter at du valgte");
      expect(g!).not.toHaveTextContent("Resultat:");
      const knapp = within(g!).queryByRole("button", { name: /Slå sammen/ });
      if (knapp) {
        expect(knapp).toBeDisabled();
        await user.click(knapp);
      }
      expect(onSlaaSammen).not.toHaveBeenCalled();
      const sum = within(g!).queryByLabelText(/Legg sammen/);
      if (sum) expect(sum).not.toBeChecked();
    });
  }

  it("ekstern endring av vare etter valg: raden bytter gruppe, valgene nullstilles og ingenting kan bekreftes", async () => {
    const { user, onSlaaSammen, rerender } = vis([
      rad("a", { amount: "1" }),
      rad("b", { amount: "2" }),
    ]);
    const gruppe = await velg(user, "Samme vare: Melk", "a");
    await user.click(within(gruppe).getByLabelText(/Legg sammen: 3/));
    rerender([rad("a", { amount: "1" }), rad("b", { amount: "2", itemId: "v-annen" })]);
    expect(screen.queryByRole("group", { name: "Samme vare: Melk" })).toBeNull();
    const kandidat = screen.getByRole("group", {
      name: "Likt navn, kanskje ikke samme vare: Melk",
    });
    for (const cb of within(kandidat).getAllByRole("checkbox")) expect(cb).not.toBeChecked();
    expect(kandidat).toHaveTextContent("vare: Melk (vare 1)");
    expect(kandidat).toHaveTextContent("vare: Lettmelk (vare 2)");
    expect(screen.queryByRole("button", { name: /Slå sammen/ })).toBeNull();
    expect(onSlaaSammen).not.toHaveBeenCalled();
  });

  it("ekstern endring etter valg → nytt eksplisitt valg gir ny plan med det nye grunnlaget", async () => {
    const { user, onSlaaSammen, rerender } = vis([
      rad("a", { amount: "1" }),
      rad("b", { amount: "2" }),
    ]);
    const gruppe = await velg(user, "Samme vare: Melk", "a");
    await user.click(within(gruppe).getByLabelText(/Legg sammen: 3/));
    rerender([rad("a", { amount: "1" }), rad("b", { amount: "20" })]);
    const g = screen.getByRole("group", { name: "Samme vare: Melk" });
    await user.click(within(g).getByLabelText(/Legg sammen: 21/));
    await user.click(within(g).getByRole("button", { name: "Slå sammen 2 rader" }));
    const plan = onSlaaSammen.mock.calls[0]![0] as SammenslaingsPlan;
    expect(plan.resultatMengde).toBe("21");
    expect(plan.sett.b!.amount).toBe("20");
  });

  it("ekstern avhuking etter valg: raden forlater gruppen og ingenting kan bekreftes", async () => {
    const { user, onSlaaSammen, rerender } = vis([
      rad("a", { amount: "1" }),
      rad("b", { amount: "2" }),
    ]);
    const gruppe = await velg(user, "Samme vare: Melk", "a");
    await user.click(within(gruppe).getByLabelText(/Legg sammen: 3/));
    rerender([rad("a", { amount: "1" }), rad("b", { amount: "2", done: true })]);
    expect(screen.queryByRole("button", { name: /Slå sammen/ })).toBeNull();
    expect(onSlaaSammen).not.toHaveBeenCalled();
  });

  it("enheter eller fritekst blokkerer sammenslåing — ingen knapp, tydelig grunn", async () => {
    const { user } = vis([rad("a", { amount: "2 stk" }), rad("b", { amount: "2 stk" })]);
    const gruppe = await velg(user, "Samme vare: Melk", "a");
    expect(gruppe).toHaveTextContent(/enheter, fritekst eller for store tall/);
    expect(within(gruppe).queryByRole("button")).toBeNull();
  });

  it("uten mengder kreves likevel et eksplisitt valg før bekreftelse", async () => {
    const { user, onSlaaSammen } = vis([rad("a", { amount: "" }), rad("b", { amount: "" })]);
    const gruppe = await velg(user, "Samme vare: Melk", "a");
    const knapp = within(gruppe).getByRole("button", { name: "Slå sammen 2 rader" });
    expect(knapp).toBeDisabled();
    await user.click(within(gruppe).getByLabelText(/Uten mengde/));
    await user.click(knapp);
    expect(onSlaaSammen).toHaveBeenCalledTimes(1);
  });

  it("skiller konflikt og replay fra faktisk anvendt resultat", async () => {
    const { user } = vis([rad("a", { amount: "1" }), rad("b", { amount: "2" })], {
      utfall: "konflikt",
      grunn: "En av radene er endret, huket av eller flyttet siden forhåndsvisningen.",
    });
    const gruppe = await velg(user, "Samme vare: Melk", "b");
    await user.click(within(gruppe).getByLabelText(/Behold én: 2/));
    await user.click(within(gruppe).getByRole("button", { name: "Slå sammen 2 rader" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Ikke lagret: En av radene er endret, huket av eller flyttet siden forhåndsvisningen. Se forslaget på nytt.",
    );
  });

  it("replay vises som «var allerede slått sammen»", async () => {
    const { user } = vis([rad("a", { amount: "1" }), rad("b", { amount: "2" })], {
      utfall: "allerede",
    });
    const gruppe = await velg(user, "Samme vare: Melk", "a");
    await user.click(within(gruppe).getByLabelText(/Legg sammen: 3/));
    await user.click(within(gruppe).getByRole("button", { name: "Slå sammen 2 rader" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Var allerede slått sammen. Ingen ny endring.",
    );
  });

  it("meldingen er synlig også når siste gruppe forsvinner etter sammenslåingen", async () => {
    const { user, rerender } = vis([rad("a", { amount: "1" }), rad("b", { amount: "2" })]);
    const gruppe = await velg(user, "Samme vare: Melk", "a");
    await user.click(within(gruppe).getByLabelText(/Legg sammen: 3/));
    await user.click(within(gruppe).getByRole("button", { name: "Slå sammen 2 rader" }));
    rerender([
      rad("a", { amount: "3", sammenslaing: { opId: "op-1", tidspunkt: "t", antallKilder: 1 } }),
    ]);
    expect(screen.queryByText(/Mulige duplikater/)).not.toBeInTheDocument();
    expect(await screen.findByText("Radene er slått sammen.")).toBeVisible();
  });

  it("sammenslåtte rader kan angres eksplisitt", async () => {
    const { user, onAngre } = vis([
      rad("a", { amount: "3", sammenslaing: { opId: "op-1", tidspunkt: "t", antallKilder: 1 } }),
    ]);
    // Angring ligger utenfor duplikatpanelet (og utenfor aktiveringsporten).
    expect(screen.queryByText(/Mulige duplikater/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Angre sammenslåing av Melk" }));
    expect(onAngre).toHaveBeenCalledWith("a", "op-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Sammenslåingen er angret.");
  });

  it("handlelisten viser nye sammenslåinger bare bak porten; angring ligger utenfor", () => {
    expect(skjerm).toMatch(/\{handlelisteDuplikaterAktiv\(\) && \(\s*<Duplikater/);
    expect(skjerm.match(/<Duplikater/g)).toHaveLength(1);
    expect(skjerm).toMatch(
      /\)\}\s*\{\/\*[^*]*\*\/\}\s*<Sammenslatte rader=\{all\} onAngre=\{angreSammenslaing\} \/>/,
    );
  });
});
