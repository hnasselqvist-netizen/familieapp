import { useRef, useState } from "react";
import { Button } from "@components/Button";
import { Icon } from "@components/Icon";
import type { IconName } from "@components/icons";
import { ItemPicker } from "@components/ItemPicker";
import { Retur } from "@components/Retur";
import { RoomHeader } from "@components/RoomHeader";
import { SHOP_CATS } from "@domain/shared/constants";
import { sorterKategorier } from "@domain/shopping/kategoriorden";
import { basisvareNokkel } from "@domain/shopping/basisvare";
import {
  type FjernFullfortePlan,
  lagFjernFullfortePlan,
} from "@domain/shopping/handlelisteFjernFullforte";
import { type FjernPlan, lagFjernPlan } from "@domain/shopping/handlelisteFjerning";
import { type StatusPlan, lagStatusPlan } from "@domain/shopping/handlelisteStatus";
import { type MengdePlan, synligMengde } from "@domain/shopping/handlelisteMengde";
import { type FeltPlan, lagFeltPlan, synligFelt } from "@domain/shopping/handlelisteFelt";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import type { ShoppingItem } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import { Basisvare, type BasisvareLagring } from "./Basisvare";
import { Duplikater, Sammenslatte } from "./Duplikater";
import {
  type FjernMelding,
  FjernMeldinger,
  type FullforteMelding,
  FullforteMeldingVisning,
} from "./Fjerning";
import { fjernTekst, fullforteSjekkTekst, fullforteTekst, sjekkTekst } from "./fjernTekst";
import { type StatusMelding, StatusMeldinger } from "./Status";
import {
  type MengdeMelding,
  MengdeFelt,
  MengdeMeldinger,
  type MengdeUtkast,
  UtkastUtenRad,
} from "./Mengde";
import { mengdeSjekkTekst, mengdeTekst } from "./mengdeTekst";
import { type FeltMelding, FeltMeldinger, NavnFelt, NavneutkastUtenRad } from "./Navn";
import { type NavnUtkast, erFremmedNavneutkast, feltNokkel } from "./navnUtkast";
import { feltSjekkTekst, feltTekst } from "./feltTekst";
import { statusSjekkTekst, statusTekst } from "./statusTekst";
import { InnleggingsStatus, Innleggingsvarsel, VentendeForsok } from "./Innlegging";
import { useInnlegging } from "./useInnlegging";
import styles from "./HandlelisteScreen.module.css";
import innleggingStyles from "./Innlegging.module.css";

/** Én rolig Lucide-familie for kategoriene (§Kontrolltårn-review, PR #26, design-review runde 2, §5) — nærmeste gode standardikon per kategori, konsistens fremfor bokstavelig treff. */
const CAT_ICON: Record<string, IconName> = {
  "Frukt og grønt": "sprout",
  Kjøtt: "beef",
  "Fisk og sjømat": "fish",
  "Ost og meieri": "milk",
  Tørrvarer: "wheat",
  "Brød og bakst": "sandwich",
  Frysevarer: "snowflake",
  Drikke: "cup-soda",
  Rengjøring: "spray-can",
  Diverse: "package-open",
};

/** Fast kategoriorden (§Issue #20) — stabil uansett redigering, avhuking og tilføying. Erstatter index.html sin "første forekomst"-orden, som fikk kategoriene til å hoppe. */
function categoryOrder(items: ShoppingItem[]): string[] {
  return sorterKategorier(items.map((i) => i.cat));
}

/**
 * Handleliste — andre Fase 2-skjerm migrert fra index.html
 * (`ShoppingScreen`, linje ~4902–5059). Funksjonell paritet mot dagens
 * skjerm: hele datalaget (`shopping.repository.ts`) var allerede fullt
 * migrert med målrettede per-post-operasjoner (PR #6). «Fjern» og
 * «Fjern fullførte» går nå via versjonsbetingede operasjoner med
 * grunnlagsvern (Mat #20, ordre 6903150917 og 6905636191).
 *
 * Generatorens "legg til flere varer samtidig"-flyt (`onAddToList`) er
 * fortsatt bevisst utenfor (§data/shopping.repository.ts sin
 * toppkommentar) — krever en egen batch-skrivestrategi.
 *
 * **Visuell Kjøkken-harmonisering** (§Kontrolltårn-handoff, Issue #20,
 * "visuelt førsteutkast av resten av Kjøkkenet"): sideheaderen bruker nå
 * `RoomHeader`, med "Fjern fullførte" i dens `actions`-rad, og
 * fargeidentiteten er byttet til Hjem/Kjøkken-paletten (`--g-*`), samme
 * mønster som Middagsplan v1/Middagsbibliotek/Kokebok. Rollen her er
 * "utførerflate i butikk" — mest kompakt og effektiv av de tre
 * Mat-skjermene, derfor UENDRET tetthet/avstand (ingen felt fikk mer
 * luft), kun fargeidentitet.
 *
 * **Design-review runde 1** (§Kontrolltårn-review, PR #26, §7): "Fjern
 * fullførte" bruker nå den delte `Button`-atomen. Fremdriftslinjen og den
 * fullførte avhukingen bruker nå `--g-green` i stedet for kjernepalettens
 * `--color-olive`. Varerader er nå ca. 44px berøringshøyde med 15px navn
 * og 13px sekundær mengde, og kategorilabelen er 12px/600. Der et ekte
 * Lucide-ikon fantes i registeret er emoji byttet ut (✓ → `Icon
 * name="check"`, 🛍️ → `Icon name="shopping-cart"`).
 *
 * **Design-review runde 2: fullført ikonfamilie + strukturert statuslinje**
 * (§Kontrolltårn-review, PR #26, §5): `RoomHeader.description` er nå
 * `ReactNode` (§components/RoomHeader.tsx) slik at statuslinjen kan bruke
 * `check`/`clock`-ikoner + struktur i stedet for `✓`/`⏱` inni én streng.
 * `CAT_EMOJI` er erstattet med `CAT_ICON` — én rolig Lucide-familie
 * (sprout/beef/fish/milk/wheat/sandwich/snowflake/cup-soda/spray-can/
 * package-open) for kategoriene. `.addButton` (→), legg-til-ikonet (＋),
 * fjern-knappene (✕) og utvid/skjul-pilene (▴/▾) bruker nå
 * `arrow-right`/`plus`/`x`/`chevron-up`/`chevron-down`.
 *
 * **Design-review runde 3** (§Helen-review, PR #26, §12 — "Helen opplever
 * Handlelisten som svært god. Bevar dagens struktur/tetthet."): "Fjern
 * fullførte" er nå `size="compact"` (§Button.tsx), samme mønster som
 * Middagsplan/Kokebok. Avhukingen (`.checkbox`/`.checkboxDone`) er nå en
 * rund sirkel i Gangens ikon-/statusspråk i stedet for et avrundet
 * kvadrat — se `HandlelisteScreen.module.css` sin toppkommentar for
 * detaljene. Alt annet (gjennomstreking/demping for ferdige varer,
 * kategoristruktur, tetthet) er UENDRET.
 */
export function HandlelisteScreen() {
  const {
    shopping,
    settStatus,
    sjekkStatus,
    settMengde,
    sjekkMengde,
    settFelt,
    sjekkFelt,
    fjernRad,
    sjekkFjerning,
    fjernFullforte,
    sjekkFjernFullforte,
    slaaSammen,
    angreSammenslaing,
    leggTilNyRad,
    okAntall,
  } = useShoppingList();
  const { items, findOrCreateItem, bekreftVare } = useItems();
  const { staples, markAsStaple } = useStaples();
  // «Merk som basisvare» (#20): utfallet bindes til basisvarenøkkelen, ikke
  // til raden, så radbytte eller navneendring under lagring aldri flytter
  // det til en annen vare. `iGang` stopper dobbeltklikk før neste tegning.
  const [basisvareLagring, setBasisvareLagring] = useState<BasisvareLagring>({});
  const iGang = useRef(new Set<string>());
  const merkBasisvare = async (navn: string) => {
    const n = basisvareNokkel(navn);
    if (!n.ok || iGang.current.has(n.nokkel)) return;
    iGang.current.add(n.nokkel);
    const sett = (status: "lagrer" | "feil" | null) =>
      setBasisvareLagring((forrige) => {
        const neste = { ...forrige };
        if (status) neste[n.nokkel] = status;
        else delete neste[n.nokkel];
        return neste;
      });
    sett("lagrer");
    try {
      await markAsStaple(navn);
      sett(null);
    } catch (err) {
      console.error("[Basisvare] Lagring feilet:", err);
      sett("feil");
    } finally {
      iGang.current.delete(n.nokkel);
    }
  };

  // «Fjern» på én rad (Mat #20, ordre 6903150917): raden slik Helen så den
  // sendes som grunnlag; `fjerner` stopper dobbeltklikk før neste tegning.
  // Ukjent utfall (review 5913786153 pkt. 2) sperrer raden til en SKRIVEFRI
  // oppfølging har avklart om posten finnes; en ny sletting er alltid et
  // eget, nytt «Fjern» på raden slik den da vises.
  const fjernerRef = useRef(new Set<string>());
  const [fjerner, setFjerner] = useState<ReadonlySet<string>>(new Set());
  const [fjernMeldinger, setFjernMeldinger] = useState<FjernMelding[]>([]);
  const uavklartRef = useRef(new Set<string>());
  const uavklart = new Set(fjernMeldinger.filter((m) => m.uavklart).map((m) => m.id));
  const meld = (melding: FjernMelding | null, id: string) => {
    if (melding?.uavklart) uavklartRef.current.add(id);
    else uavklartRef.current.delete(id);
    setFjernMeldinger((m) => [...m.filter((x) => x.id !== id), ...(melding ? [melding] : [])]);
  };
  const laas = (id: string, paa: boolean) => {
    if (paa) fjernerRef.current.add(id);
    else fjernerRef.current.delete(id);
    setFjerner(new Set(fjernerRef.current));
  };
  const fjern = async (plan: FjernPlan) => {
    if (fjernerRef.current.has(plan.id) || uavklartRef.current.has(plan.id)) return;
    laas(plan.id, true);
    meld(null, plan.id);
    let u: Awaited<ReturnType<typeof fjernRad>>;
    try {
      u = await fjernRad(plan);
    } catch (err) {
      console.error("[Handleliste] «Fjern» feilet:", err);
      u = { utfall: "ukjent" };
    } finally {
      laas(plan.id, false);
    }
    const tekst = fjernTekst(u, plan.sett.name);
    meld(
      tekst ? { id: plan.id, tekst, ...(u.utfall === "ukjent" ? { uavklart: plan } : {}) } : null,
      plan.id,
    );
  };
  const sjekk = async (plan: FjernPlan) => {
    if (fjernerRef.current.has(plan.id)) return;
    laas(plan.id, true);
    let s: Awaited<ReturnType<typeof sjekkFjerning>>;
    try {
      s = await sjekkFjerning(plan);
    } catch (err) {
      console.error("[Handleliste] Sjekk etter «Fjern» feilet:", err);
      s = { utfall: "ikkeLest" };
    } finally {
      laas(plan.id, false);
    }
    const t = sjekkTekst(s, plan.sett.name);
    meld({ id: plan.id, tekst: t.tekst, ...(t.uavklart ? { uavklart: plan } : {}) }, plan.id);
  };

  // «Fjern fullførte» (Mat #20, ordre 6905636191): de fullførte radene
  // slik Helen så dem ved klikket er planen, bundet til rågrunnlaget fra
  // abonnementet; én versjonsbetinget operasjon. `fullforteRef` stopper
  // dobbeltinnsending før neste tegning; ukjent utfall sperrer knappen til
  // en skrivefri oppfølging har avklart hva som står.
  const fullforteRef = useRef<"ledig" | "lagrer" | "uavklart">("ledig");
  const [fullforteLagrer, setFullforteLagrer] = useState(false);
  const [fullforteMelding, setFullforteMelding] = useState<FullforteMelding | null>(null);
  const meldFullforte = (m: FullforteMelding | null) => {
    fullforteRef.current = m?.uavklart ? "uavklart" : "ledig";
    setFullforteMelding(m);
  };
  const fjernAlleFullforte = async (plan: FjernFullfortePlan) => {
    if (fullforteRef.current !== "ledig" || plan.rader.length === 0) return;
    fullforteRef.current = "lagrer";
    setFullforteLagrer(true);
    setFullforteMelding(null);
    let u: Awaited<ReturnType<typeof fjernFullforte>>;
    try {
      u = await fjernFullforte(plan);
    } catch (err) {
      console.error("[Handleliste] «Fjern fullførte» feilet:", err);
      u = { utfall: "ukjent" };
    } finally {
      setFullforteLagrer(false);
    }
    meldFullforte({
      tekst: fullforteTekst(u),
      ...(u.utfall === "ukjent" ? { uavklart: plan } : {}),
    });
  };
  const sjekkFullforte = async (plan: FjernFullfortePlan) => {
    if (fullforteRef.current === "lagrer") return;
    fullforteRef.current = "lagrer";
    setFullforteLagrer(true);
    let s: Awaited<ReturnType<typeof sjekkFjernFullforte>>;
    try {
      s = await sjekkFjernFullforte(plan);
    } catch (err) {
      console.error("[Handleliste] Sjekk etter «Fjern fullførte» feilet:", err);
      s = { utfall: "ikkeLest" };
    } finally {
      setFullforteLagrer(false);
    }
    const t = fullforteSjekkTekst(s, plan);
    meldFullforte({ tekst: t.tekst, ...(t.uavklart ? { uavklart: plan } : {}) });
  };

  // «Merk som fullført»/«Merk som ikke fullført» (Mat #20, ordre
  // 6908431056): den valgte målstatusen sendes, aldri en invertering.
  // `statusRef` stopper dobbeltklikk før neste tegning; ukjent utfall sperrer
  // raden til en skrivefri kontroll har avklart statusen.
  const statusRef = useRef(new Set<string>());
  const [statusLagrer, setStatusLagrer] = useState<ReadonlySet<string>>(new Set());
  const [statusMeldinger, setStatusMeldinger] = useState<StatusMelding[]>([]);
  const statusUavklartRef = useRef(new Set<string>());
  const statusUavklart = new Set(statusMeldinger.filter((m) => m.uavklart).map((m) => m.id));
  const meldStatus = (melding: StatusMelding | null, id: string) => {
    if (melding?.uavklart) statusUavklartRef.current.add(id);
    else statusUavklartRef.current.delete(id);
    setStatusMeldinger((m) => [...m.filter((x) => x.id !== id), ...(melding ? [melding] : [])]);
  };
  const laasStatus = (id: string, paa: boolean) => {
    if (paa) statusRef.current.add(id);
    else statusRef.current.delete(id);
    setStatusLagrer(new Set(statusRef.current));
  };
  const settMaal = async (plan: StatusPlan) => {
    if (statusRef.current.has(plan.id) || statusUavklartRef.current.has(plan.id)) return;
    laasStatus(plan.id, true);
    meldStatus(null, plan.id);
    let u: Awaited<ReturnType<typeof settStatus>>;
    try {
      u = await settStatus(plan);
    } catch (err) {
      console.error("[Handleliste] Status feilet:", err);
      u = { utfall: "ukjent" };
    } finally {
      laasStatus(plan.id, false);
    }
    const tekst = statusTekst(u, plan);
    meldStatus(
      tekst ? { id: plan.id, tekst, ...(u.utfall === "ukjent" ? { uavklart: plan } : {}) } : null,
      plan.id,
    );
  };
  const sjekkMaal = async (plan: StatusPlan) => {
    if (statusRef.current.has(plan.id)) return;
    laasStatus(plan.id, true);
    let s: Awaited<ReturnType<typeof sjekkStatus>>;
    try {
      s = await sjekkStatus(plan);
    } catch (err) {
      console.error("[Handleliste] Statuskontroll feilet:", err);
      s = { utfall: "ikkeLest" };
    } finally {
      laasStatus(plan.id, false);
    }
    const t = statusSjekkTekst(s, plan);
    meldStatus({ id: plan.id, tekst: t.tekst, ...(t.uavklart ? { uavklart: plan } : {}) }, plan.id);
  };
  const statusSperret = (id: string) => statusLagrer.has(id) || statusUavklart.has(id);

  // Manuell mengde (Mat #20, ordre 6914072575): utkastet holdes lokalt til
  // Helen lagrer, bundet til raden og mengden hun så da hun begynte å
  // redigere. `mengdeRef` stopper overlappende lagringer før neste tegning;
  // ukjent utfall sperrer lagring til en skrivefri kontroll har avklart.
  const [mengdeUtkast, setMengdeUtkast] = useState<Record<string, MengdeUtkast>>({});
  const mengdeRef = useRef(new Set<string>());
  const [mengdeLagrer, setMengdeLagrer] = useState<ReadonlySet<string>>(new Set());
  const [mengdeMeldinger, setMengdeMeldinger] = useState<MengdeMelding[]>([]);
  const mengdeUavklartRef = useRef(new Set<string>());
  const mengdeUavklart = new Set(mengdeMeldinger.filter((m) => m.uavklart).map((m) => m.id));
  const meldMengde = (melding: MengdeMelding | null, id: string) => {
    if (melding?.uavklart) mengdeUavklartRef.current.add(id);
    else mengdeUavklartRef.current.delete(id);
    setMengdeMeldinger((m) => [...m.filter((x) => x.id !== id), ...(melding ? [melding] : [])]);
  };
  const laasMengde = (id: string, paa: boolean) => {
    if (paa) mengdeRef.current.add(id);
    else mengdeRef.current.delete(id);
    setMengdeLagrer(new Set(mengdeRef.current));
  };
  const mengdeSperret = (id: string) =>
    mengdeRef.current.has(id) || mengdeUavklartRef.current.has(id);
  const settUtkast = (id: string, utkast: MengdeUtkast | null) =>
    setMengdeUtkast((u) => {
      const neste = { ...u };
      if (utkast) neste[id] = utkast;
      else delete neste[id];
      return neste;
    });
  const endreMengde = (item: ShoppingItem, verdi: string) => {
    // Panelet er åpnet for en annen vare enn raden som vises nå (review 5924881773).
    if (byttetUt(item) || mengdeSperret(item.id)) return;
    setMengdeUtkast((u) => {
      const forrige = u[item.id];
      // Et nytt utkast fryser radidentiteten og førverdien slik raden vises nå.
      const grunnlag = forrige ?? {
        navn: item.name,
        itemId: item.itemId ?? null,
        foer: synligMengde(item),
      };
      return { ...u, [item.id]: { ...grunnlag, verdi } };
    });
  };
  const lagreMengde = async (item: ShoppingItem) => {
    const utkast = mengdeUtkast[item.id];
    if (!utkast || mengdeSperret(item.id)) return;
    // Målet er raden utkastet ble skrevet for — aldri den som vises nå.
    const plan: MengdePlan = {
      id: item.id,
      navn: utkast.navn,
      itemId: utkast.itemId,
      foer: utkast.foer,
      ny: utkast.verdi,
    };
    if (plan.navn !== item.name || plan.itemId !== (item.itemId ?? null)) return;
    laasMengde(plan.id, true);
    meldMengde(null, plan.id);
    let u: Awaited<ReturnType<typeof settMengde>>;
    try {
      u = await settMengde(plan);
    } catch (err) {
      console.error("[Handleliste] Mengde feilet:", err);
      u = { utfall: "ukjent" };
    } finally {
      laasMengde(plan.id, false);
    }
    const tekst = mengdeTekst(u, plan);
    if (!tekst) {
      settUtkast(plan.id, null);
      meldMengde(null, plan.id);
      return;
    }
    meldMengde(
      { id: plan.id, tekst, ...(u.utfall === "ukjent" ? { uavklart: plan } : {}) },
      plan.id,
    );
  };
  const sjekkMengdePlan = async (plan: MengdePlan) => {
    if (mengdeRef.current.has(plan.id)) return;
    laasMengde(plan.id, true);
    let s: Awaited<ReturnType<typeof sjekkMengde>>;
    try {
      s = await sjekkMengde(plan);
    } catch (err) {
      console.error("[Handleliste] Mengdekontroll feilet:", err);
      s = { utfall: "ikkeLest" };
    } finally {
      laasMengde(plan.id, false);
    }
    const t = mengdeSjekkTekst(s, plan);
    if (t.lagret) settUtkast(plan.id, null);
    meldMengde({ id: plan.id, tekst: t.tekst, ...(t.uavklart ? { uavklart: plan } : {}) }, plan.id);
  };

  // Navn og kategori (Mat #20, ordre 6921967679): navneutkastet holdes
  // lokalt til Helen lagrer, bundet til varekoblingen og navnet hun så da hun
  // begynte å redigere; kategorien lagres som et eksplisitt valg med
  // førverdi fra visningen. Én versjonsbetinget skriving per felt.
  // `feltRef` stopper overlappende lagringer; ukjent utfall sperrer feltet
  // til en skrivefri kontroll har avklart.
  const [navnUtkast, setNavnUtkast] = useState<Record<string, NavnUtkast>>({});
  const feltRef = useRef(new Set<string>());
  const [feltLagrer, setFeltLagrer] = useState<ReadonlySet<string>>(new Set());
  const [feltMeldinger, setFeltMeldinger] = useState<FeltMelding[]>([]);
  const feltUavklartRef = useRef(new Set<string>());
  const feltUavklart = new Set(feltMeldinger.filter((m) => m.uavklart).map((m) => m.nokkel));
  const meldFelt = (melding: FeltMelding | null, nokkel: string) => {
    if (melding?.uavklart) feltUavklartRef.current.add(nokkel);
    else feltUavklartRef.current.delete(nokkel);
    setFeltMeldinger((m) => [
      ...m.filter((x) => x.nokkel !== nokkel),
      ...(melding ? [melding] : []),
    ]);
  };
  const laasFelt = (nokkel: string, paa: boolean) => {
    if (paa) feltRef.current.add(nokkel);
    else feltRef.current.delete(nokkel);
    setFeltLagrer(new Set(feltRef.current));
  };
  const feltSperret = (nokkel: string) =>
    feltRef.current.has(nokkel) || feltUavklartRef.current.has(nokkel);
  const settNavnUtkast = (id: string, utkast: NavnUtkast | null) =>
    setNavnUtkast((u) => {
      const neste = { ...u };
      if (utkast) neste[id] = utkast;
      else delete neste[id];
      return neste;
    });
  const endreNavn = (item: ShoppingItem, verdi: string) => {
    if (byttetUt(item) || feltSperret(feltNokkel("name", item.id))) return;
    setNavnUtkast((u) => ({
      ...u,
      // Et nytt utkast fryser varekoblingen og navnet slik raden vises nå.
      [item.id]: { ...(u[item.id] ?? { itemId: item.itemId ?? null, foer: item.name }), verdi },
    }));
  };
  const lagreFelt = async (plan: FeltPlan) => {
    const nokkel = feltNokkel(plan.felt, plan.id);
    if (feltSperret(nokkel)) return;
    laasFelt(nokkel, true);
    meldFelt(null, nokkel);
    let u: Awaited<ReturnType<typeof settFelt>>;
    try {
      u = await settFelt(plan);
    } catch (err) {
      console.error("[Handleliste] Felt feilet:", err);
      u = { utfall: "ukjent" };
    } finally {
      laasFelt(nokkel, false);
    }
    const tekst = feltTekst(u, plan);
    if (!tekst) {
      if (plan.felt === "name") navnLagret(plan);
      return;
    }
    meldFelt(
      { nokkel, felt: plan.felt, tekst, ...(u.utfall === "ukjent" ? { uavklart: plan } : {}) },
      nokkel,
    );
  };
  /**
   * Helens eget navn er lagret: utkastet fjernes, og et eventuelt
   * mengdeutkast på samme vare følger med til det nye navnet, så hennes egen
   * navneendring ikke gjør det fremmed.
   */
  const navnLagret = (plan: FeltPlan) => {
    settNavnUtkast(plan.id, null);
    // Helens eget nye navn er fortsatt samme vare for det åpne panelet.
    // Bare panelet for SAMME rad, og bare når grunnlaget er det planen bygde på.
    setRedigertVare((v) =>
      v && v.id === plan.id && v.navn === plan.foer && v.itemId === plan.itemId
        ? { ...v, navn: plan.ny }
        : v,
    );
    setMengdeUtkast((m) => {
      const u = m[plan.id];
      if (!u || u.navn !== plan.foer || u.itemId !== plan.itemId) return m;
      return { ...m, [plan.id]: { ...u, navn: plan.ny } };
    });
  };
  const lagreNavn = (item: ShoppingItem) => {
    const u = navnUtkast[item.id];
    if (!u || erFremmedNavneutkast(u, item.name, item.itemId ?? null)) return;
    // Målet er raden utkastet ble skrevet for — aldri den som vises nå.
    void lagreFelt({
      id: item.id,
      felt: "name",
      navn: u.foer,
      itemId: u.itemId,
      foer: u.foer,
      ny: u.verdi,
    });
  };
  const velgKategori = (item: ShoppingItem, ny: string) => {
    // Et påbegynt valg i et panel åpnet for en annen vare sendes aldri.
    if (byttetUt(item)) return;
    void lagreFelt(lagFeltPlan(item, "cat", synligFelt(item, "cat"), ny));
  };
  const sjekkFeltPlan = async (plan: FeltPlan) => {
    const nokkel = feltNokkel(plan.felt, plan.id);
    if (feltRef.current.has(nokkel)) return;
    laasFelt(nokkel, true);
    let s: Awaited<ReturnType<typeof sjekkFelt>>;
    try {
      s = await sjekkFelt(plan);
    } catch (err) {
      console.error("[Handleliste] Feltkontroll feilet:", err);
      s = { utfall: "ikkeLest" };
    } finally {
      laasFelt(nokkel, false);
    }
    const t = feltSjekkTekst(s, plan);
    if (t.lagret && plan.felt === "name") navnLagret(plan);
    meldFelt(
      { nokkel, felt: plan.felt, tekst: t.tekst, ...(t.uavklart ? { uavklart: plan } : {}) },
      nokkel,
    );
  };

  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [selectedVare, setSelectedVare] = useState<Vare | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Redigeringspanelet er bundet til varen Helen åpnet (review 5924881773):
  // erstattes raden med en annen vare under samme nøkkel mens panelet står
  // åpent, sperres feltene til hun eksplisitt åpner den nye varen.
  // Grunnlaget er bundet til radnøkkelen (review 5926171764), så et svar
  // fra én rad aldri kan endre panelet for en annen.
  const [redigertVare, setRedigertVare] = useState<{
    id: string;
    navn: string;
    itemId: string | null;
  } | null>(null);
  const aapneRedigering = (item: ShoppingItem | null) => {
    setEditingId(item?.id ?? null);
    setRedigertVare(item ? { id: item.id, navn: item.name, itemId: item.itemId ?? null } : null);
  };
  /** Raden er ikke lenger varen Helen åpnet (ny varekobling, eller nytt navn uten varekobling). */
  const byttetUt = (item: ShoppingItem) =>
    redigertVare !== null &&
    redigertVare.id === item.id &&
    (redigertVare.itemId !== (item.itemId ?? null) ||
      (redigertVare.itemId === null && redigertVare.navn !== item.name));
  // Manuell innlegging (Mat #20, ordre 6830803229, review 5880291160).
  const inn = useInnlegging({
    rader: shopping.status === "loaded" ? shopping.data : [],
    varer: items.status === "loaded" ? items.data : [],
    utkast: { navn: newName, mengde: newAmount, valgtId: selectedVare?.id ?? null },
    valgtVare: selectedVare,
    tomUtkast: () => {
      setNewName("");
      setNewAmount("");
      setSelectedVare(null);
    },
    findOrCreateItem,
    bekreftVare,
    leggTilNyRad,
    okAntall,
  });

  if (shopping.status !== "loaded" || items.status !== "loaded") {
    return <div className={styles.loading}>Laster…</div>;
  }

  const all = shopping.data;
  const pending = all.filter((i) => !i.done);
  const done = all.filter((i) => i.done);

  const onNameChange = (name: string) => {
    setNewName(name);
    setSelectedVare(null);
    inn.lukkVarsel();
  };
  /** Nytt varevalg lukker et åpent varsel, også når navnet er likt (pkt. 2). */
  const velgVare = (vare: Vare) => {
    setNewName(vare.name);
    setSelectedVare(vare);
    inn.lukkVarsel();
  };
  const add = () => void inn.add();

  const merk = (item: ShoppingItem, maal: boolean) => {
    void settMaal(lagStatusPlan(item, maal));
    if (editingId === item.id) aapneRedigering(null);
  };

  const remove = (item: ShoppingItem) => {
    void fjern(lagFjernPlan(item));
    if (editingId === item.id) aapneRedigering(null);
  };

  return (
    <div>
      <Retur ferdig={all.length > 0 && pending.length === 0} ferdigTekst="Handlelisten er klar." />
      <RoomHeader
        eyebrow="KJØKKEN"
        showDate
        title="Handleliste"
        description={
          <span className={styles.statusLine}>
            <span className={styles.statusItem}>
              <Icon name="check" size={13} />
              {done.length} fullført
            </span>
            <span className={styles.statusItem}>
              <Icon name="clock" size={13} />
              {pending.length} gjenstår
            </span>
          </span>
        }
        actions={
          done.length > 0 && (
            <Button
              variant="secondary"
              size="compact"
              disabled={fullforteLagrer || fullforteMelding?.uavklart !== undefined}
              onClick={() => void fjernAlleFullforte(lagFjernFullfortePlan(all))}
            >
              <Icon name="trash-2" size={14} />
              Fjern fullførte
            </Button>
          )
        }
      />

      {all.length > 0 && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round((done.length / all.length) * 100)}%` }}
            />
          </div>
          <div className={styles.progressLabel}>
            {Math.round((done.length / all.length) * 100)}% ferdig
          </div>
        </div>
      )}

      <div className={styles.addRow}>
        <Icon name="plus" size={15} className={styles.addIcon} />
        <div className={styles.addPicker}>
          <ItemPicker
            items={items.data}
            value={newName}
            onChange={onNameChange}
            onSelect={velgVare}
            onCreate={velgVare}
            findOrCreateItem={findOrCreateItem}
            placeholder="Hva trenger du?"
          />
        </div>
        <input
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label="Mengde"
          autoComplete="off"
          placeholder="Mengde"
          className={styles.addAmount}
        />
        <button
          type="button"
          onClick={add}
          disabled={inn.lagrer}
          aria-label="Legg til"
          className={styles.addButton}
        >
          <Icon name="arrow-right" size={15} />
        </button>
      </div>

      {inn.varsel && (
        <Innleggingsvarsel
          navn={inn.varsel.navn}
          treff={inn.varsel.treff}
          tillegg={newAmount}
          maalId={inn.maalId}
          lagrer={inn.lagrer}
          onVelgMaal={inn.setMaalId}
          onOk={() => void inn.okAntallet()}
          onAvbryt={inn.lukkVarsel}
        />
      )}
      {inn.status && <InnleggingsStatus status={inn.status} />}
      <FullforteMeldingVisning
        melding={fullforteMelding}
        sjekker={fullforteLagrer}
        onProvIgjen={(plan) => void sjekkFullforte(plan)}
        onLukk={() => meldFullforte(null)}
      />
      <MengdeMeldinger
        meldinger={mengdeMeldinger}
        lagrer={mengdeLagrer}
        onSjekk={(plan) => void sjekkMengdePlan(plan)}
        onLukk={(id) => meldMengde(null, id)}
      />
      <FeltMeldinger
        meldinger={feltMeldinger}
        lagrer={feltLagrer}
        onSjekk={(plan) => void sjekkFeltPlan(plan)}
        onLukk={(k) => meldFelt(null, k)}
      />
      <NavneutkastUtenRad
        utkast={Object.entries(navnUtkast)
          .filter(([id]) => !all.some((r) => r.id === id))
          .map(([id, utkast]) => ({ id, utkast }))}
        lagrer={feltLagrer}
        onForkast={(id) => settNavnUtkast(id, null)}
      />
      <UtkastUtenRad
        utkast={Object.entries(mengdeUtkast)
          .filter(([id]) => !all.some((r) => r.id === id))
          .map(([id, utkast]) => ({ id, utkast }))}
        lagrer={mengdeLagrer}
        onForkast={(id) => settUtkast(id, null)}
      />
      <StatusMeldinger
        meldinger={statusMeldinger}
        lagrer={statusLagrer}
        onProvIgjen={(plan) => void sjekkMaal(plan)}
        onLukk={(id) => meldStatus(null, id)}
      />
      <FjernMeldinger
        meldinger={fjernMeldinger}
        fjerner={fjerner}
        onProvIgjen={(plan) => void sjekk(plan)}
        onLukk={(id) => meld(null, id)}
      />
      <VentendeForsok
        ventende={inn.ventende}
        lagrer={inn.lagrer}
        onProvIgjen={(opId) => void inn.provIgjen(opId)}
        onSendSomNy={inn.sendSomNy}
        onBekreftSendSomNy={(opId) => void inn.bekreftSendSomNy(opId)}
      />

      {handlelisteDuplikaterAktiv() && (
        <Duplikater
          rader={all}
          vareNavn={(id) => items.data.find((v) => v.id === id)?.name}
          onSlaaSammen={slaaSammen}
        />
      )}
      {/* Angring av eksisterende sammenslåinger er bevisst UTENFOR porten (ADR 0003). */}
      <Sammenslatte rader={all} onAngre={angreSammenslaing} />

      {all.length === 0 && (
        <div className={styles.empty}>
          <Icon name="shopping-cart" size={32} className={styles.emptyIcon} />
          <div className={styles.emptyText}>Listen er tom</div>
        </div>
      )}

      {categoryOrder(pending).map((cat) => {
        const catItems = pending.filter((i) => i.cat === cat);
        return (
          <div key={cat} className={styles.categoryGroup}>
            <div className={styles.categoryHeader}>
              <Icon
                name={CAT_ICON[cat] ?? "package-open"}
                size={14}
                className={styles.categoryIcon}
              />
              <span className={styles.categoryName}>{cat}</span>
              <div className={styles.categoryLine} />
              <span className={styles.categoryCount}>{catItems.length}</span>
            </div>
            {catItems.map((item) => {
              const isEditing = editingId === item.id;
              const panelByttet = isEditing && byttetUt(item);
              return (
                <div key={item.id} className={styles.itemWrap}>
                  <div
                    onClick={() => aapneRedigering(isEditing ? null : item)}
                    className={styles.itemRow}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        merk(item, true);
                      }}
                      disabled={statusSperret(item.id)}
                      aria-label={`Merk ${item.name} som fullført`}
                      className={styles.checkbox}
                    />
                    <span className={styles.itemName}>{item.name}</span>
                    {item.amount && !isEditing && (
                      <span className={styles.itemAmount}>{item.amount}</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(item);
                      }}
                      disabled={fjerner.has(item.id) || uavklart.has(item.id)}
                      aria-label={`Fjern ${item.name}`}
                      className={styles.removeButton}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  {isEditing && (
                    <div className={styles.editRow}>
                      {panelByttet && redigertVare && (
                        <div
                          className={innleggingStyles.feil}
                          role="alert"
                          aria-label="Raden er byttet ut"
                        >
                          <p className={innleggingStyles.feilTekst}>
                            {`Raden du redigerte («${redigertVare.navn}») er nå «${item.name}». Ingenting er endret, og feltene er sperret. Åpne «${item.name}» hvis du vil redigere den.`}
                          </p>
                          <div className={innleggingStyles.knapper}>
                            <button
                              type="button"
                              className={innleggingStyles.knapp}
                              onClick={() => aapneRedigering(item)}
                            >
                              {`Åpne «${item.name}»`}
                            </button>
                          </div>
                        </div>
                      )}
                      <NavnFelt
                        navn={item.name}
                        itemId={item.itemId ?? null}
                        utkast={navnUtkast[item.id]}
                        sperret={
                          panelByttet ||
                          feltLagrer.has(feltNokkel("name", item.id)) ||
                          feltUavklart.has(feltNokkel("name", item.id))
                        }
                        inputClassName={styles.editName}
                        onEndre={(v) => endreNavn(item, v)}
                        onLagre={() => lagreNavn(item)}
                        onForkast={() => {
                          settNavnUtkast(item.id, null);
                          const k = feltNokkel("name", item.id);
                          if (!feltUavklartRef.current.has(k)) meldFelt(null, k);
                        }}
                        onBehold={() => {
                          const u = navnUtkast[item.id];
                          // Bare på samme vare (samme varekobling).
                          if (u && !erFremmedNavneutkast(u, item.name, item.itemId ?? null)) {
                            settNavnUtkast(item.id, { ...u, foer: item.name });
                          }
                        }}
                      />
                      <div className={styles.editFields}>
                        <MengdeFelt
                          navn={item.name}
                          itemId={item.itemId ?? null}
                          synlig={synligMengde(item)}
                          utkast={mengdeUtkast[item.id]}
                          sperret={
                            panelByttet || mengdeLagrer.has(item.id) || mengdeUavklart.has(item.id)
                          }
                          inputClassName={styles.editAmount}
                          onEndre={(v) => endreMengde(item, v)}
                          onLagre={() => void lagreMengde(item)}
                          onForkast={() => {
                            settUtkast(item.id, null);
                            if (!mengdeUavklartRef.current.has(item.id)) meldMengde(null, item.id);
                          }}
                          onBehold={() => {
                            const u = mengdeUtkast[item.id];
                            // Bare på samme vare: et utkast flyttes aldri til en erstattet rad.
                            if (u && u.navn === item.name && u.itemId === (item.itemId ?? null)) {
                              settUtkast(item.id, { ...u, foer: synligMengde(item) });
                            }
                          }}
                        />
                        <select
                          value={synligFelt(item, "cat")}
                          onChange={(e) => velgKategori(item, e.target.value)}
                          disabled={
                            panelByttet ||
                            feltLagrer.has(feltNokkel("cat", item.id)) ||
                            feltUavklart.has(feltNokkel("cat", item.id))
                          }
                          aria-label={`Kategori for ${item.name}`}
                          className={styles.editCat}
                        >
                          {SHOP_CATS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Basisvare
                        navn={item.name}
                        staples={staples}
                        lagring={basisvareLagring}
                        sperret={panelByttet}
                        onMerk={(navn) => {
                          // Handlingsveien avviser også en hendelse fra et panel
                          // åpnet for en annen vare (ordre 6936021912).
                          if (byttetUt(item) || navn !== item.name) return;
                          void merkBasisvare(navn);
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {done.length > 0 && (
        <div className={styles.doneSection}>
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            className={styles.doneToggle}
          >
            <div className={styles.categoryLine} />
            <span className={styles.doneToggleLabel}>
              <Icon name={showDone ? "chevron-up" : "chevron-down"} size={12} />
              {done.length} FULLFØRT
            </span>
            <div className={styles.categoryLine} />
          </button>
          {showDone && (
            <div className={styles.doneList}>
              {done.map((item) => (
                <div key={item.id} className={styles.doneRow}>
                  <button
                    type="button"
                    onClick={() => merk(item, false)}
                    disabled={statusSperret(item.id)}
                    aria-label={`Merk ${item.name} som ikke fullført`}
                    className={styles.checkboxDone}
                  >
                    <Icon name="check" size={12} />
                  </button>
                  <span className={styles.doneName}>{item.name}</span>
                  {item.amount && <span className={styles.itemAmount}>{item.amount}</span>}
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    disabled={fjerner.has(item.id) || uavklart.has(item.id)}
                    aria-label={`Fjern ${item.name}`}
                    className={styles.removeButton}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
