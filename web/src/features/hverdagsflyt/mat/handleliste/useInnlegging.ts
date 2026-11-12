import { useRef, useState } from "react";
import type { InnleggingsSkriveutfall } from "@data/shopping.repository";
import { stabil } from "@domain/shopping/handlelisteDuplikater";
import {
  type NyRadPlan,
  type OkningsPlan,
  type Treff,
  finnTreff,
  lagOkningsPlan,
} from "@domain/shopping/handlelisteInnlegging";
import { normalizeItemName } from "@domain/shopping/handlelisteRules";
import type { ShoppingItem } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";

/**
 * Manuell innlegging i handlelisten (Mat #20, ordre 6830803229, review
 * 5880291160 pkt. 2–3): varsel ved aktiv vare, og ett forsøk per
 * innsendingsidentitet.
 *
 * **Identitet.** Et forsøk identifiseres av hva som sendes: ny rad =
 * normalisert navn + mengde + valgt/avklart vare; økning = målrad + mengde.
 * Hvert forsøk med ukjent eller ubekreftet utfall huskes under sine
 * identiteter (flere samtidig). Alle ordinære veier — «Legg til», Enter,
 * «Øk antallet», «Prøv igjen» — sender da SAMME `opId` som gjentak, og
 * utfallet avgjøres mot kvitteringen. Et avslag eller manglende bevis ved
 * gjentak beholder forsøket som ubekreftet. Bare et lagret (eller allerede
 * lagret) utfall fjerner det. «Send som ny» gjelder bare forsøket den står
 * på, og krever et eget, tydelig valg.
 *
 * **Varevalg.** Et eksplisitt valg i velgeren bindes til varens id, og
 * varen må finnes i varebasen — ingen navnefallback. Er bare navnet kjent
 * og flere varer heter det samme, stoppes det til Helen velger.
 */

export type Innsending =
  | { type: "ny"; plan: NyRadPlan; utkast: Utkast }
  | { type: "okning"; plan: OkningsPlan; utkast: Utkast };

interface Utkast {
  navn: string;
  mengde: string;
}

export interface Ventende {
  innsending: Innsending;
  /** Identitetene forsøket gjenkjennes på (før og etter at varen er avklart). */
  nokler: string[];
  tekst: string;
  /** «Send som ny» er trykket: venter på at Helen bekrefter etter å ha sjekket listen. */
  bekreftNy: boolean;
}

export interface Varsel {
  navn: string;
  treff: Treff[];
}

export type Status = { type: "ok" | "konflikt"; tekst: string };

export const nyNokkel = (navn: string, mengde: string, vareId: string | null) =>
  stabil({ t: "ny", navn: normalizeItemName(navn), mengde: mengde.trim(), vareId });
export const okningNokkel = (maalId: string, mengde: string) =>
  stabil({ t: "okning", maalId, mengde: mengde.trim() });

/** Kort beskrivelse av forsøket, for meldinger og knappenavn. */
export function beskriv(i: Innsending): string {
  return i.type === "ny"
    ? `«${i.plan.rad.name}»${i.plan.rad.amount ? ` (${i.plan.rad.amount})` : ""}`
    : `økning av «${i.plan.sett.name}» til ${i.plan.resultat}`;
}

function ventendeTekst(i: Innsending, u: InnleggingsSkriveutfall): string {
  const hva = beskriv(i);
  switch (u.utfall) {
    case "ukjent":
      return `Vi vet ikke om ${hva} ble lagret. «Prøv igjen» sender det samme forsøket, så det aldri telles to ganger.`;
    case "ubekreftet":
      return `${hva}: ${u.grunn}`;
    case "konflikt":
      return `${hva} er fortsatt ikke bekreftet: ${u.grunn}`;
    case "avvist":
      return `${hva} er fortsatt ikke bekreftet: databasen nektet gjentakelsen (mangler tilgang).`;
    case "ikkeLest":
      return `${hva} er fortsatt ikke bekreftet: handlelisten kunne ikke leses. Prøv igjen.`;
    default:
      return hva;
  }
}

const samme = (a: Utkast, b: Utkast) =>
  normalizeItemName(a.navn) === normalizeItemName(b.navn) && a.mengde.trim() === b.mengde.trim();

export function useInnlegging(valg: {
  rader: readonly ShoppingItem[];
  varer: readonly Vare[];
  utkast: Utkast;
  valgtVare: Vare | null;
  tomUtkast: () => void;
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
  leggTilNyRad: (plan: NyRadPlan, gjentak?: boolean) => Promise<InnleggingsSkriveutfall>;
  okAntall: (plan: OkningsPlan, gjentak?: boolean) => Promise<InnleggingsSkriveutfall>;
}) {
  const [varsel, setVarsel] = useState<Varsel | null>(null);
  const [maalId, setMaalId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [ventende, setVentende] = useState<Ventende[]>([]);
  const [lagrer, setLagrer] = useState(false);
  const iGang = useRef(false);
  // Ferske verdier for kode som fortsetter etter en await.
  const naa = useRef(valg);
  naa.current = valg;
  const ventendeNaa = useRef(ventende);
  ventendeNaa.current = ventende;

  const settVentende = (fn: (v: Ventende[]) => Ventende[]) => {
    ventendeNaa.current = fn(ventendeNaa.current);
    setVentende(ventendeNaa.current);
  };
  const finn = (nokkel: string) => ventendeNaa.current.find((v) => v.nokler.includes(nokkel));
  const finnOp = (opId: string) => ventendeNaa.current.find((v) => v.innsending.plan.opId === opId);

  const medLaas = async (fn: () => Promise<void>) => {
    if (iGang.current) return;
    iGang.current = true;
    setLagrer(true);
    try {
      await fn();
    } catch (err) {
      console.error("[Handleliste] Innlegging feilet:", err);
      setStatus({
        type: "konflikt",
        tekst: "Kunne ikke lagre. Ingenting er lagt til på listen, og utkastet er beholdt.",
      });
    } finally {
      iGang.current = false;
      setLagrer(false);
    }
  };

  /**
   * Sender ett forsøk. Lagret/allerede lagret fjerner det fra ventende og
   * tømmer utkastet hvis det fortsatt er det samme. Et gjentak, et ukjent
   * og et ubekreftet utfall beholder forsøket. Et førstegangs avslag har
   * ikke skrevet noe og vises som melding.
   */
  const send = async (innsending: Innsending, gjentak: boolean, nokler: string[]) => {
    const u =
      innsending.type === "ny"
        ? await naa.current.leggTilNyRad(innsending.plan, gjentak)
        : await naa.current.okAntall(innsending.plan, gjentak);
    const opId = innsending.plan.opId;
    if (u.utfall === "anvendt" || u.utfall === "allerede") {
      settVentende((v) => v.filter((x) => x.innsending.plan.opId !== opId));
      if (samme(naa.current.utkast, innsending.utkast)) naa.current.tomUtkast();
      setVarsel(null);
      setMaalId(null);
      setStatus({
        type: "ok",
        tekst:
          u.utfall === "allerede"
            ? `${beskriv(innsending)} var allerede lagret. Ingen ny endring.`
            : innsending.type === "ny"
              ? `La til «${innsending.plan.rad.name}».`
              : `Økte «${innsending.plan.sett.name}» til ${innsending.plan.resultat}.`,
      });
      return;
    }
    if (gjentak || u.utfall === "ukjent" || u.utfall === "ubekreftet") {
      const post: Ventende = {
        innsending,
        nokler,
        tekst: ventendeTekst(innsending, u),
        bekreftNy: false,
      };
      settVentende((v) =>
        v.some((x) => x.innsending.plan.opId === opId)
          ? v.map((x) => (x.innsending.plan.opId === opId ? post : x))
          : [...v, post],
      );
      setStatus(null);
      return;
    }
    if (u.utfall === "konflikt") {
      setVarsel(null);
      setMaalId(null);
      setStatus({
        type: "konflikt",
        tekst: u.treff
          ? `${u.grunn} Trykk «Legg til» igjen for å se raden.`
          : `${u.grunn} Utkastet er beholdt.`,
      });
    } else if (u.utfall === "avvist") {
      setStatus({
        type: "konflikt",
        tekst: "Ingen tilgang til å lagre. Ingenting er lagret, og utkastet er beholdt.",
      });
    } else {
      setStatus({
        type: "konflikt",
        tekst: "Kunne ikke lese handlelisten. Ingenting er lagret, og utkastet er beholdt.",
      });
    }
  };

  /** «Legg til»/Enter. */
  const add = () =>
    medLaas(async () => {
      const { rader, varer, utkast, valgtVare, findOrCreateItem } = naa.current;
      const navn = utkast.navn.trim();
      if (!navn) return;
      // Varevalg (pkt. 2): eksplisitt valg bindes til id; bare navn må være entydig.
      let vare: Vare | null;
      if (valgtVare) {
        vare = varer.find((v) => v.id === valgtVare.id) ?? null;
        if (!vare) {
          setStatus({
            type: "konflikt",
            tekst: `Den valgte varen «${valgtVare.name}» finnes ikke lenger i varebasen. Velg vare på nytt. Ingenting er lagret.`,
          });
          return;
        }
      } else {
        const like = varer.filter((v) => normalizeItemName(v.name) === normalizeItemName(navn));
        if (like.length > 1) {
          setVarsel(null);
          setStatus({
            type: "konflikt",
            tekst: `Flere varer heter «${navn}». Velg riktig vare i listen. Ingenting er lagret.`,
          });
          return;
        }
        vare = like[0] ?? null;
      }
      const nokkel = nyNokkel(navn, utkast.mengde, vare?.id ?? null);
      const v = finn(nokkel);
      if (v && v.innsending.type === "ny") {
        await send(v.innsending, true, v.nokler);
        return;
      }
      setStatus(null);
      const treff = finnTreff(rader, { name: navn, itemId: vare?.id ?? null });
      if (treff.length > 0) {
        setVarsel({ navn, treff });
        setMaalId(treff.length === 1 ? treff[0]!.rad.id : null);
        return;
      }
      setVarsel(null);
      const endelig = vare ?? (await findOrCreateItem(navn, "Diverse"));
      if (!endelig) return;
      const nokler = [...new Set([nokkel, nyNokkel(navn, utkast.mengde, endelig.id)])];
      await send(
        {
          type: "ny",
          utkast: { ...utkast },
          plan: {
            opId: crypto.randomUUID(),
            rad: {
              itemId: endelig.id,
              name: endelig.name,
              amount: utkast.mengde.trim(),
              cat: endelig.cat,
              done: false,
            },
          },
        },
        false,
        nokler,
      );
    });

  /** «Øk antallet» på det åpne varselet. Samme målrad og mengde → samme forsøk. */
  const okAntallet = () =>
    medLaas(async () => {
      const { utkast } = naa.current;
      const maal = varsel?.treff.find((t) => t.rad.id === maalId)?.rad;
      if (!maal) return;
      const nokkel = okningNokkel(maal.id, utkast.mengde);
      const v = finn(nokkel);
      if (v && v.innsending.type === "okning") {
        await send(v.innsending, true, v.nokler);
        return;
      }
      const p = lagOkningsPlan(maal, utkast.mengde, crypto.randomUUID());
      if (!p.kan) return;
      await send({ type: "okning", plan: p.plan, utkast: { ...utkast } }, false, [nokkel]);
    });

  const provIgjen = (opId: string) =>
    medLaas(async () => {
      const v = finnOp(opId);
      if (v) await send(v.innsending, true, v.nokler);
    });

  /** Første trykk på «Send som ny»: be Helen sjekke listen og bekrefte. */
  const sendSomNy = (opId: string) =>
    settVentende((v) =>
      v.map((x) => (x.innsending.plan.opId === opId ? { ...x, bekreftNy: !x.bekreftNy } : x)),
    );

  /** Bekreftet «Send som ny»: bare DETTE forsøket, med ny `opId` og vanlig atomisk kontroll. */
  const bekreftSendSomNy = (opId: string) =>
    medLaas(async () => {
      const v = finnOp(opId);
      if (!v || !v.bekreftNy) return;
      settVentende((alle) => alle.filter((x) => x.innsending.plan.opId !== opId));
      const ny: Innsending =
        v.innsending.type === "ny"
          ? { ...v.innsending, plan: { ...v.innsending.plan, opId: crypto.randomUUID() } }
          : { ...v.innsending, plan: { ...v.innsending.plan, opId: crypto.randomUUID() } };
      await send(ny, false, v.nokler);
    });

  /** Nytt navn eller nytt varevalg: et åpent varsel gjelder ikke lenger. */
  const lukkVarsel = () => {
    setVarsel(null);
    setMaalId(null);
  };

  return {
    varsel,
    maalId,
    setMaalId,
    status,
    ventende,
    lagrer,
    add,
    okAntallet,
    provIgjen,
    sendSomNy,
    bekreftSendSomNy,
    lukkVarsel,
  };
}
