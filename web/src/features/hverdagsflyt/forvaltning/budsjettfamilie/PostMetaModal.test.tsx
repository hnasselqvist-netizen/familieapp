/**
 * Funn F (#59, ordre 6665182330): delt metadataredigering for kostnad,
 * inntekt og sparing krever en entydig forfallsdag 1–31 når «Automatisk
 * til prognosen» er på. Ved ugyldig dag: synlig feltfeil, null `onSave`,
 * og utkastet står. Med automatikk av er tom dag lov. Syntetiske data.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FORFALLSDAG_FEIL } from "@domain/liquidity/forfallsdag";
import type { BudsjettfamilieNode, PostMeta } from "@app-types/budsjettfamilie";
import { PostMetaModal } from "./PostMetaModal";

const NODER: [string, BudsjettfamilieNode, string][] = [
  ["kostnad", "budget", "bolig"],
  ["inntekt", "incomeGroups", "lonn"],
  ["sparing", "sparingGroups", "buffer"],
];

function vis(node: BudsjettfamilieNode, groupId: string, meta: Partial<PostMeta> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <PostMetaModal
      node={node}
      groupId={groupId}
      itemName="Testpost"
      itemMeta={meta as PostMeta}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  const dag = () => screen.getByRole("textbox", { name: "Forfallsdag" });
  const lagre = () => screen.getByRole("button", { name: "Lagre" });
  const automatikk = () => screen.getByRole("button", { name: /Automatisk til prognosen/ });
  return { onSave, onClose, dag, lagre, automatikk };
}

describe.each(NODER)("PostMetaModal (%s): forfallsdag ved automatikk", (_navn, node, gruppe) => {
  it.each(["1", "31", " 7 "])("gyldig dag %j lagres med automatikk på", async (verdi) => {
    const user = userEvent.setup();
    const v = vis(node, gruppe, { automatisk: true, forfallsdag: "" });
    await user.type(v.dag(), verdi);
    expect(screen.queryByText(FORFALLSDAG_FEIL)).toBeNull();
    expect(v.dag()).not.toHaveAttribute("aria-invalid");
    await user.click(v.lagre());
    expect(v.onSave).toHaveBeenCalledTimes(1);
    const [meta, navn] = v.onSave.mock.calls[0]!;
    expect(meta).toMatchObject({ automatisk: true, forfallsdag: verdi });
    expect(navn).toBe("Testpost");
    expect(v.onClose).toHaveBeenCalledTimes(1);
  });

  it.each(["", "0", "32", "1.5", "15abc", "abc", " "])(
    "ugyldig dag %j: feltfeil, ingen onSave, utkastet står",
    async (verdi) => {
      const user = userEvent.setup();
      const v = vis(node, gruppe, { automatisk: true, forfallsdag: "" });
      const navnFelt = screen.getByDisplayValue("Testpost");
      await user.clear(navnFelt);
      await user.type(navnFelt, "Nytt navn");
      if (verdi) await user.type(v.dag(), verdi);
      const feil = screen.getByRole("alert");
      expect(feil).toHaveTextContent(FORFALLSDAG_FEIL);
      expect(v.dag()).toHaveAttribute("aria-invalid", "true");
      expect(v.dag()).toHaveAccessibleDescription(FORFALLSDAG_FEIL);
      expect(v.lagre()).toBeDisabled();
      await user.click(v.lagre());
      expect(v.onSave).not.toHaveBeenCalled();
      expect(v.onClose).not.toHaveBeenCalled();
      // Utkastet bevares: navn og dag står slik brukeren skrev dem.
      expect(screen.getByDisplayValue("Nytt navn")).toBeInTheDocument();
      expect(v.dag()).toHaveValue(verdi);
    },
  );

  it("eldre ugyldig lagret verdi vises som den er og blokkerer lagring til den rettes", async () => {
    const user = userEvent.setup();
    const v = vis(node, gruppe, { automatisk: true, forfallsdag: "15abc", eier: "Felles" });
    expect(v.dag()).toHaveValue("15abc");
    expect(v.lagre()).toBeDisabled();
    await user.clear(v.dag());
    await user.type(v.dag(), "15");
    expect(v.lagre()).toBeEnabled();
    await user.click(v.lagre());
    expect(v.onSave.mock.calls[0]![0]).toMatchObject({ forfallsdag: "15", eier: "Felles" });
  });

  it("automatikk av: tom dag er lov, og ingen standarddag fylles inn", async () => {
    const user = userEvent.setup();
    const v = vis(node, gruppe, { automatisk: false, forfallsdag: "" });
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(v.lagre());
    expect(v.onSave).toHaveBeenCalledTimes(1);
    expect(v.onSave.mock.calls[0]![0]).toMatchObject({ automatisk: false, forfallsdag: "" });
  });

  it("brukeren kan slå automatikk av for å lagre uten dag, eller på igjen og bli stoppet", async () => {
    const user = userEvent.setup();
    const v = vis(node, gruppe, { automatisk: true });
    expect(v.automatikk()).toHaveAttribute("aria-pressed", "true");
    expect(v.lagre()).toBeDisabled();
    await user.click(v.automatikk());
    expect(v.automatikk()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(v.lagre()).toBeEnabled();
    await user.click(v.automatikk());
    expect(v.lagre()).toBeDisabled();
    await user.click(v.automatikk());
    await user.click(v.lagre());
    expect(v.onSave).toHaveBeenCalledTimes(1);
    expect(v.onSave.mock.calls[0]![0]).toMatchObject({ automatisk: false });
    expect(v.onSave.mock.calls[0]![0].forfallsdag ?? "").toBe("");
  });

  it("å slå på automatikk med tom dag gir feil før noe lagres", async () => {
    const user = userEvent.setup();
    const v = vis(node, gruppe, { automatisk: false });
    await user.click(v.automatikk());
    expect(screen.getByRole("alert")).toHaveTextContent(FORFALLSDAG_FEIL);
    await user.click(v.lagre());
    expect(v.onSave).not.toHaveBeenCalled();
  });
});
