import { useRef, useState } from "react";
import type { VareBekreftelse } from "@data/items.repository";
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
 * **Identitet.** Et forsøk identifiseres av hva som ble sendt inn: ny rad =
 * normalisert navn + mengde + INTENSJON (fritekst, eller eksplisitt valgt
 * vare-id); økning = målrad + mengde. Et nytt rad-forsøk huskes både under
 * sin intensjon og under den avklarte vare-id-en. Hvert forsøk med ukjent
 * eller ubekreftet utfall huskes (flere samtidig). Alle ordinære veier —
 * «Legg til», Enter, «Øk antallet», «Prøv igjen» — sender da SAMME `opId`
 * som gjentak, og et gjentatt utkast avgjøres mot kvitteringen FØR noe nytt
 * varebaseoppslag (review 5881436508 pkt. 1): en slettet vare eller et navn
 * som nå peker på en annen vare gjør ikke et gammelt forsøk til et nytt.
 * Et bevisst valg av en annen vare-id er et eget forsøk. Et avslag eller
 * manglende bevis ved gjentak beholder forsøket som ubekreftet. Bare et
 * lagret (eller allerede lagret) utfall fjerner det. «Send som ny» gjelder
 * bare forsøket den står på, og krever et eget, tydelig valg.
 *
 * **Varevalg.** Et eksplisitt valg i velgeren bindes til varens id, og den
 * eksakte id-en bekreftes skrivefritt mot serveren før en ny lagring —
 * ingen navnefallback (pkt. 2). Er bare navnet kjent og flere varer heter
 * det samme, stoppes det til Helen velger. Et svar tømmer utkastet bare
 * hvis navn, mengde OG varevalg er uendret, og lukker bare varselet som
 * hører til forsøket.
 */

export type Innsending =
  | { type: "ny"; plan: NyRadPlan; utkast: Utkast }
  /** `varsel`: identiteten til varselet økningen ble bekreftet fra. */
  | { type: "okning"; plan: OkningsPlan; utkast: Utkast; varsel: string };

export interface Utkast {
  navn: string;
  mengde: string;
  /** Eksplisitt valgt vare-id, eller `null` for fritekst. */
  valgtId: string | null;
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
  /** Utkastet varselet ble åpnet for (`intensjonNokkel`). */
  forsok: string;
}

export type Status = { type: "ok" | "konflikt"; tekst: string };

/** Ny rad: navn + mengde + intensjon (`valgt`: vare-id, eller `null` for fritekst). */
export const intensjonNokkel = (navn: string, mengde: string, valgt: string | null) =>
  stabil({ t: "ny", navn: normalizeItemName(navn), mengde: mengde.trim(), valgt });
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
  normalizeItemName(a.navn) === normalizeItemName(b.navn) &&
  a.mengde.trim() === b.mengde.trim() &&
  a.valgtId === b.valgtId;

export function useInnlegging(valg: {
  rader: readonly ShoppingItem[];
  varer: readonly Vare[];
  utkast: Utkast;
  valgtVare: Vare | null;
  tomUtkast: () => void;
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
  bekreftVare: (id: string) => Promise<VareBekreftelse>;
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
  const varselNaa = useRef(varsel);
  varselNaa.current = varsel;
  const settVarsel = (v: Varsel | null, maal: string | null = null) => {
    varselNaa.current = v;
    setVarsel(v);
    setMaalId(maal);
  };
  /** Lukker varselet bare hvis det fortsatt er det for `forsok`. */
  const lukkVarselFor = (forsok: string) => {
    if (varselNaa.current?.forsok === forsok) settVarsel(null);
  };

  const settVentende = (fn: (v: Ventende[]) => Ventende[]) => {
    ventendeNaa.current = fn(ventendeNaa.current);
    setVentende(ventendeNaa.current);
  };
  const finnAlle = (nokkel: string) =>
    ventendeNaa.current.filter((v) => v.innsending.type === "ny" && v.nokler.includes(nokkel));
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
      if (innsending.type === "okning") lukkVarselFor(innsending.varsel);
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
      if (innsending.type === "okning") lukkVarselFor(innsending.varsel);
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

  /**
   * Gjentar et ventende rad-forsøk som passer `nokkel`. `true` når noe ble
   * sendt eller stoppet (flere forsøk passer — da må Helen velge selv).
   */
  const gjentaHvisVentende = async (nokkel: string) => {
    const alle = finnAlle(nokkel);
    if (alle.length > 1) {
      setStatus({
        type: "konflikt",
        tekst:
          "Flere ubekreftede forsøk passer til utkastet. Bruk «Prøv igjen» på det riktige. Ingenting er sendt.",
      });
      return true;
    }
    if (alle.length === 1) {
      await send(alle[0]!.innsending, true, alle[0]!.nokler);
      return true;
    }
    return false;
  };

  /** «Legg til»/Enter. */
  const add = () =>
    medLaas(async () => {
      const { rader, varer, utkast, valgtVare, findOrCreateItem, bekreftVare } = naa.current;
      const navn = utkast.navn.trim();
      if (!navn) return;
      const valgtId = valgtVare?.id ?? null;
      const forsok = intensjonNokkel(navn, utkast.mengde, valgtId);
      // 1. Et gjentatt utkast avgjøres mot sitt forsøk FØR noe varebaseoppslag.
      if (await gjentaHvisVentende(forsok)) return;

      // 2. Avklar varen. Eksplisitt valg: den eksakte id-en bekreftes mot serveren.
      let vare: Vare | null = null;
      const ikkeBekreftet = () =>
        setStatus({
          type: "konflikt",
          tekst:
            "Kunne ikke bekrefte varen mot databasen. Ingenting er lagret, og utkastet er beholdt.",
        });
      if (valgtVare) {
        const b = await bekreftVare(valgtVare.id);
        if (b.type === "ikkeLest") return ikkeBekreftet();
        if (b.type === "mangler") {
          settVarsel(null);
          setStatus({
            type: "konflikt",
            tekst: `Den valgte varen «${valgtVare.name}» finnes ikke lenger i varebasen. Velg vare på nytt. Ingenting er lagret.`,
          });
          return;
        }
        vare = b.vare;
      } else {
        const like = varer.filter((v) => normalizeItemName(v.name) === normalizeItemName(navn));
        if (like.length > 1) {
          settVarsel(null);
          setStatus({
            type: "konflikt",
            tekst: `Flere varer heter «${navn}». Velg riktig vare i listen. Ingenting er lagret.`,
          });
          return;
        }
        if (like[0]) {
          const b = await bekreftVare(like[0].id);
          if (b.type === "ikkeLest") return ikkeBekreftet();
          if (b.type === "mangler") {
            // Den lokale varebasen er foreldet; et navneoppslag nå kunne treffe den samme cachen.
            setStatus({
              type: "konflikt",
              tekst: `Varebasen er endret: «${navn}» finnes ikke lenger slik listen viste den. Vent et øyeblikk og prøv igjen. Ingenting er lagret.`,
            });
            return;
          }
          vare = b.vare;
        }
      }
      // Samme vare og mengde som et ventende forsøk: det forsøket, ikke et nytt.
      if (vare && (await gjentaHvisVentende(intensjonNokkel(navn, utkast.mengde, vare.id)))) {
        return;
      }

      setStatus(null);
      const treff = finnTreff(rader, { name: navn, itemId: vare?.id ?? null });
      if (treff.length > 0) {
        settVarsel({ navn, treff, forsok }, treff.length === 1 ? treff[0]!.rad.id : null);
        return;
      }
      settVarsel(null);
      const endelig = vare ?? (await findOrCreateItem(navn, "Diverse"));
      if (!endelig) return;
      const nokler = [...new Set([forsok, intensjonNokkel(navn, utkast.mengde, endelig.id)])];
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
      const aapent = varselNaa.current;
      const maal = aapent?.treff.find((t) => t.rad.id === maalId)?.rad;
      if (!aapent || !maal) return;
      const nokkel = okningNokkel(maal.id, utkast.mengde);
      const v = finn(nokkel);
      if (v && v.innsending.type === "okning") {
        await send(v.innsending, true, v.nokler);
        return;
      }
      const p = lagOkningsPlan(maal, utkast.mengde, crypto.randomUUID());
      if (!p.kan) return;
      await send(
        { type: "okning", plan: p.plan, utkast: { ...utkast }, varsel: aapent.forsok },
        false,
        [nokkel],
      );
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
  const lukkVarsel = () => settVarsel(null);

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
