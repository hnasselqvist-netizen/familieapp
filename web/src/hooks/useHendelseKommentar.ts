import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { aktivSesjon } from "@data/auth.repository";
import { kjorNodeVersjonert, lesForsoningNodeFersk } from "@data/forsoningSkriving.repository";
import {
  type KommentarForsok,
  type KommentarKontroll,
  type KommentarMaal,
  type KommentarStopp,
  type KommentarUtfall,
  besluttKommentar,
  normaliserKommentar,
  vurderKommentarNaatilstand,
} from "@domain/forsoning/hendelseKommentar";
import { forsoningSkrivingAktiv } from "./forsoningAktivering";
import { useAuthSesjon } from "./useAuthSesjon";
import { useFamilyId } from "./useFamilyId";

// ── Uavklarte forsøk ────────────────────────────────────────────────────
// Holdes utenfor komponentene, så lukking av korrigeringsvinduet eller
// drilldown ikke glemmer dem. Nøklet på forsøkets EGEN kontekst og hendelse;
// et forsøk vises aldri under en annen familie eller innloggingssesjon.
const INGEN: readonly KommentarForsok[] = [];
let forsokLager: Readonly<Record<string, readonly KommentarForsok[]>> = {};
const lyttere = new Set<() => void>();
const abonner = (f: () => void) => {
  lyttere.add(f);
  return () => lyttere.delete(f);
};
const nokkel = (kontekst: string, hendelseId: string) => `${kontekst}/${hendelseId}`;

/** Endrer listen for `kontekst`/`hendelseId`. */
export function oppdaterKommentarForsok(
  kontekst: string,
  hendelseId: string,
  endre: (liste: readonly KommentarForsok[]) => readonly KommentarForsok[],
): void {
  const k = nokkel(kontekst, hendelseId);
  const liste = endre(forsokLager[k] ?? INGEN);
  const neste = { ...forsokLager };
  if (liste.length > 0) neste[k] = liste;
  else delete neste[k];
  forsokLager = neste;
  lyttere.forEach((f) => f());
}

/** Bare for tester: tømmer lageret. */
export function nullstillKommentarForsok(): void {
  forsokLager = {};
  lyttere.forEach((f) => f());
}

const kontekstFor = (familyId: string, sesjon: string | null) => `${familyId}|${sesjon ?? "-"}`;

export interface UseHendelseKommentarResult {
  /** Familie og innloggingssesjon nye forsøk bindes til. */
  kontekst: string;
  /** Om `kontekst` er den gjeldende AKKURAT NÅ (sesjonen leses direkte). */
  erGjeldende: (kontekst: string) => boolean;
  /**
   * «Lagre kommentar» (#59, ordre 7002365160). `kontekst` er konteksten
   * utkastet ble laget i; er den ikke gjeldende, sendes ingenting
   * (`byttet`). `maal.kilde` er kommentaren slik den var da utkastet startet.
   * `oppdatert` settes til tidspunktet for dette kallet.
   */
  lagre: (kontekst: string, maal: KommentarMaal, tekst: string) => Promise<KommentarUtfall>;
  /** Skrivefri kontroll mot DET SENDTE forsøket. Beviser ikke utfallet. */
  sjekk: (forsok: KommentarForsok) => Promise<KommentarKontroll>;
  /** Uavklarte forsøk for hendelsen i gjeldende kontekst, eldste først. */
  forsokFor: (hendelseId: string) => readonly KommentarForsok[];
  oppdaterForsok: typeof oppdaterKommentarForsok;
}

/**
 * Kommentar på én vanlig manuell økonomisk hendelse. Skriver hele
 * `hendelser` versjonert over REST (fersk eksportlesing med ETag, PUT med
 * `if-match`; et stopp sender ingenting) med frist og sesjonsbinding, og
 * kontrollerer med en fersk, skrivefri lesing under samme frist.
 */
export function useHendelseKommentar(): UseHendelseKommentarResult {
  const familyId = useFamilyId();
  const sesjon = useAuthSesjon();
  const lager = useSyncExternalStore(abonner, () => forsokLager);
  const kontekst = kontekstFor(familyId, sesjon);
  // Familien i siste fullførte tegning: også en funksjon fra en eldre
  // tegning ser et familiebytte.
  const sisteFamilie = useRef(familyId);
  useLayoutEffect(() => {
    sisteFamilie.current = familyId;
  }, [familyId]);
  const gjeldende = (k: string) => {
    const naa = aktivSesjon();
    const fam = sisteFamilie.current;
    return naa !== null && k === kontekstFor(fam, naa) ? { fam, naa } : null;
  };

  const lagre = async (k: string, maal: KommentarMaal, tekst: string): Promise<KommentarUtfall> => {
    if (!forsoningSkrivingAktiv()) return "stengt";
    const g = gjeldende(k);
    if (!g) return "byttet";
    const utkast = normaliserKommentar(tekst);
    const naa = new Date().toISOString();
    const r = await kjorNodeVersjonert<KommentarStopp>(
      g.fam,
      "hendelser",
      (eksport) => besluttKommentar(eksport, maal, utkast, naa),
      { sesjon: g.naa },
    );
    return r.type === "stopp" ? r.utfall : r.type;
  };

  const sjekk = async (forsok: KommentarForsok): Promise<KommentarKontroll> => {
    const g = gjeldende(forsok.kontekst);
    if (!g) return "byttet";
    const r = await lesForsoningNodeFersk(g.fam, "hendelser", { sesjon: g.naa });
    return r.type === "lest" ? vurderKommentarNaatilstand(r.eksport, forsok) : r.type;
  };

  return {
    kontekst,
    erGjeldende: (k) => gjeldende(k) !== null,
    lagre,
    sjekk,
    forsokFor: (hendelseId) => lager[nokkel(kontekst, hendelseId)] ?? INGEN,
    oppdaterForsok: oppdaterKommentarForsok,
  };
}
