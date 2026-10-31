import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { HendelseRecord } from "@app-types/forsoning";
import {
  bekreftOppgjor,
  byggMellomvaerende,
  medKostnadHendelse,
  mellomvaerendeStatus,
  type NyttMellomvaerende,
} from "@domain/mellomvaerende/mellomvaerende";
import { OppgjorAvvist, type MellomvaerendeHandlinger } from "@hooks/useMellomvaerende";
import { MellomvaerendeView } from "./MellomvaerendeView";
import { OppgjorKort } from "./OppgjorKort";

/**
 * Handlingskortet og oversikten for mellomværende (#95). Logikken
 * (restsaldo, forfalte måneder, idempotens) er testet i domenet; her låses
 * at UI-et viser det riktig, bevarer utkastet ved feil og kaller riktig
 * handling.
 */
const NY: NyttMellomvaerende = {
  navn: "Gave fra mamma",
  motpart: "Mamma",
  opprinneligOre: 329900,
  startMaaned: "2026-10",
  kostnad: {
    postId: "gaver",
    postNavn: "Gaver",
    plasseringType: "budget",
    eiere: [{ person: "Felles", prosent: 100 }],
  },
  oppgjor: {
    postId: "abonnementer",
    postNavn: "Abonnementer",
    plasseringType: "budget",
    eiere: [{ person: "Felles", prosent: 100 }],
  },
  standardBelopOre: 46700,
};
const MV = byggMellomvaerende(NY, "mv1", "Helen", "2026-10-31T12:00:00.000Z");
const MED_KOSTNAD = medKostnadHendelse([], MV, "Helen", "2026-10-31T12:00:00.000Z");

const status = (h: HendelseRecord[] = MED_KOSTNAD, naa = "2026-10") =>
  mellomvaerendeStatus(MV, h, naa);

const handlinger = (): MellomvaerendeHandlinger => ({
  registrer: vi.fn().mockResolvedValue(undefined),
  fullforRegistrering: vi.fn().mockResolvedValue(undefined),
  bekreft: vi.fn().mockResolvedValue(undefined),
  rett: vi.fn().mockResolvedValue(undefined),
  angre: vi.fn().mockResolvedValue(undefined),
});

const visKort = (s = status(), onBekreft = vi.fn().mockResolvedValue(undefined)) => {
  const onFullfor = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <OppgjorKort status={s} onBekreft={onBekreft} onFullfor={onFullfor} />
    </MemoryRouter>,
  );
  return { onBekreft, onFullfor };
};

describe("handlingskortet", () => {
  it("viser eldste uoppgjorte måned, foreslått beløp og restsaldo, og bekrefter", async () => {
    const { onBekreft } = visKort();
    const kort = screen.getByRole("region", { name: "Mellomværende: Gave fra mamma" });
    expect(within(kort).getByRole("heading")).toHaveTextContent(
      "Gave fra mamma: oppgjør oktober 2026",
    );
    expect(kort).toHaveTextContent("Gjenstår 3 299 kr");
    expect(within(kort).getByLabelText("Beløp")).toHaveValue("467");
    await userEvent.click(within(kort).getByRole("button", { name: "Bekreft oppgjør" }));
    expect(onBekreft).toHaveBeenCalledWith("2026-10", 46700);
  });

  it("justert beløp sendes; beløp over resten kan ikke bekreftes", async () => {
    const { onBekreft } = visKort();
    const felt = screen.getByLabelText("Beløp");
    await userEvent.clear(felt);
    await userEvent.type(felt, "4000");
    expect(screen.getByRole("button", { name: "Bekreft oppgjør" })).toBeDisabled();
    expect(screen.getByText(/Maks 3 299 kr/)).toBeInTheDocument();
    await userEvent.clear(felt);
    await userEvent.type(felt, "499,50");
    await userEvent.click(screen.getByRole("button", { name: "Bekreft oppgjør" }));
    expect(onBekreft).toHaveBeenCalledWith("2026-10", 49950);
  });

  it("lagringsfeil vises ærlig og utkastet beholdes", async () => {
    const { onBekreft } = visKort(status(), vi.fn().mockRejectedValue(new Error("offline")));
    const felt = screen.getByLabelText("Beløp");
    await userEvent.clear(felt);
    await userEvent.type(felt, "480");
    await userEvent.click(screen.getByRole("button", { name: "Bekreft oppgjør" }));
    expect(onBekreft).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunne ikke lagre");
    expect(felt).toHaveValue("480");
  });

  it("avvisning fra dataene forklares (allerede oppgjort et annet sted)", async () => {
    visKort(status(), vi.fn().mockRejectedValue(new OppgjorAvvist("allerede_oppgjort")));
    await userEvent.click(screen.getByRole("button", { name: "Bekreft oppgjør" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("allerede oppgjort");
  });

  it("en glemt måned vises først, og antallet som venter etter den står", () => {
    const okt = bekreftOppgjor(MED_KOSTNAD, MV, "2026-10", 46700, "Helen", "x").neste;
    const h = bekreftOppgjor(okt, MV, "2026-12", 46700, "Helen", "x").neste;
    visKort(status(h, "2027-01"));
    expect(screen.getByRole("heading")).toHaveTextContent("oppgjør november 2026");
    expect(screen.getByText(/1 måned til venter etter denne/)).toBeInTheDocument();
  });

  it("ufullført registrering: kostnaden kan føres", async () => {
    const { onFullfor } = visKort(status([]));
    await userEvent.click(screen.getByRole("button", { name: "Fullfør registrering" }));
    expect(onFullfor).toHaveBeenCalled();
  });
});

describe("oversikten", () => {
  const vis = (
    h: HendelseRecord[],
    over: Partial<Parameters<typeof MellomvaerendeView>[0]> = {},
  ) => {
    const hl = handlinger();
    render(
      <MemoryRouter>
        <MellomvaerendeView
          statuser={[status(h, "2026-11")]}
          poster={[
            { id: "gaver", name: "Gaver", gruppe: "Familie" },
            { id: "abonnementer", name: "Abonnementer", gruppe: "Hjem" },
          ]}
          naaMaaned="2026-11"
          handlinger={hl}
          skrivingAktiv
          nyId={() => "ny-id"}
          {...over}
        />
      </MemoryRouter>,
    );
    return hl;
  };

  it("viser utlegg, oppgjort, gjenstår, oppgjør med spor og gjenstående plan", () => {
    const h = bekreftOppgjor(
      MED_KOSTNAD,
      MV,
      "2026-10",
      46700,
      "Helen",
      "2026-10-31T12:00:00Z",
    ).neste;
    vis(h);
    const avtale = screen.getByRole("region", { name: "Gave fra mamma" });
    expect(avtale).toHaveTextContent("Utlegg3 299 kr");
    expect(avtale).toHaveTextContent("Oppgjort467 kr");
    expect(avtale).toHaveTextContent("Gjenstår2 832 kr");
    expect(avtale).toHaveTextContent("gjenstår 6 oppgjør og ett på 30 kr");
    expect(screen.getByRole("list", { name: "Spor for oktober 2026" })).toHaveTextContent(
      /Bekreftet 467 kr · .* · Helen/,
    );
    // November er forfalt: kortet ligger også her.
    expect(within(avtale).getByRole("button", { name: "Bekreft oppgjør" })).toBeInTheDocument();
  });

  it("retting og angring kaller riktige handlinger", async () => {
    const h = bekreftOppgjor(MED_KOSTNAD, MV, "2026-10", 46700, "Helen", "x").neste;
    const hl = vis(h);
    await userEvent.click(screen.getByRole("button", { name: "Angre oppgjør oktober 2026" }));
    expect(hl.angre).toHaveBeenCalledWith(MV, "2026-10", 1);
    await userEvent.click(screen.getByRole("button", { name: "Rett" }));
    const felt = screen.getByLabelText("Nytt beløp for oktober 2026");
    await userEvent.clear(felt);
    await userEvent.type(felt, "500");
    await userEvent.click(screen.getByRole("button", { name: "Lagre" }));
    expect(hl.rett).toHaveBeenCalledWith(MV, "2026-10", 50000, 1);
  });

  it("kun visning når skriving er av", () => {
    const h = bekreftOppgjor(MED_KOSTNAD, MV, "2026-10", 46700, "Helen", "x").neste;
    vis(h, { skrivingAktiv: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("registrering krever eksplisitt eierskap og sender samme id ved retry", async () => {
    const hl = handlinger();
    (hl.registrer as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(
      <MemoryRouter>
        <MellomvaerendeView
          statuser={[]}
          poster={[
            { id: "gaver", name: "Gaver", gruppe: "Familie" },
            { id: "abonnementer", name: "Abonnementer", gruppe: "Hjem" },
          ]}
          naaMaaned="2026-10"
          handlinger={hl}
          skrivingAktiv
          nyId={() => "ny-id"}
        />
      </MemoryRouter>,
    );
    const skjema = screen.getByRole("region", { name: "Registrer mellomværende" });
    await userEvent.type(within(skjema).getByLabelText("Navn"), "Gave fra mamma");
    await userEvent.type(within(skjema).getByLabelText("Med hvem"), "Mamma");
    await userEvent.type(within(skjema).getByLabelText("Utlegg (kr)"), "3299");
    await userEvent.selectOptions(
      within(skjema).getByLabelText("Utlegget er en kostnad på"),
      "gaver",
    );
    await userEvent.selectOptions(
      within(skjema).getByLabelText("Oppgjørene reduserer"),
      "abonnementer",
    );
    await userEvent.type(within(skjema).getByLabelText("Månedlig oppgjør (kr)"), "467");
    await userEvent.click(within(skjema).getByRole("button", { name: "Registrer" }));
    expect(within(skjema).getByRole("alert")).toHaveTextContent(
      "Velg hvem som eier kostnaden (til sammen 100 %).",
    );
    expect(hl.registrer).not.toHaveBeenCalled();

    const kostnadEier = within(skjema).getByRole("group", { name: "Hvem eier kostnaden" });
    await userEvent.click(within(kostnadEier).getByRole("button", { name: "Felles" }));
    const oppgjorEier = within(skjema).getByRole("group", { name: "Hvem eier reduksjonen" });
    await userEvent.click(within(oppgjorEier).getByRole("button", { name: "Felles" }));
    await userEvent.click(within(skjema).getByRole("button", { name: "Registrer" }));
    expect(await within(skjema).findByRole("alert")).toHaveTextContent("Kunne ikke lagre");
    await userEvent.click(within(skjema).getByRole("button", { name: "Registrer" }));
    expect(hl.registrer).toHaveBeenCalledTimes(2);
    const kall = (hl.registrer as ReturnType<typeof vi.fn>).mock.calls as [
      NyttMellomvaerende,
      string,
    ][];
    const [[forste, id1], [, id2]] = [kall[0]!, kall[1]!];
    expect(id1).toBe("ny-id");
    expect(id2).toBe("ny-id");
    expect(forste).toMatchObject({
      navn: "Gave fra mamma",
      opprinneligOre: 329900,
      startMaaned: "2026-10",
      standardBelopOre: 46700,
      kostnad: { postId: "gaver", eiere: [{ person: "Felles", prosent: 100 }] },
      oppgjor: { postId: "abonnementer", eiere: [{ person: "Felles", prosent: 100 }] },
    });
  });
});
