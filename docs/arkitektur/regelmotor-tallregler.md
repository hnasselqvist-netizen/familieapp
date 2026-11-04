# Regelmotor: tallregler og tekstregler uten omvendt inklusjon

**Status:** implementert etter #59 6639556626. Bygger på kontrakt 6543702753 og brukerfunnene 6543087796 (kontonummerregel) og 6543491911 (CC Mat). Koden ligger i `web/src/domain/forsoning/treffgrunnlag.ts`, `regler.ts`, `beslutning.ts`, `bankimport.ts` og `regelsenter.ts`.

## Treffgrunnlag

`normaliserTransaksjonstekst` fjerner tall med seks eller flere sifre. Det er riktig for leverandørtekster med KID og løpenummer, men da kan en regel på et kontonummer eller en KID aldri treffe. Matching får derfor et `Treffgrunnlag` bygget fra råteksten:

- **`normalisert`:** normaliseringen, uendret.
- **`sifferlop`:** sammenhengende løp med minst 6 sifre.
  - Kontonummer skrevet 4-2-5 med punktum eller mellomrom slås sammen til 11 sifre.
  - Et løp som ligger inntil et annet siffer, eller fortsetter med «.<siffer>», er ikke et eget løp.

## Regeltyper

- **Tallregel:** mønsteret er minst seks sammenhengende sifre, eller et kontonummer skrevet 4-2-5.
  - Treff skjer bare når sifrene er nøyaktig lik ett av råtekstens sifferløp, og ledende nuller teller. `matchType` utvider aldri en tallregel.
  - Nabokonto, lengre tall og KID med samme sifre inni gir ikke treff.
- **Tekstregel:** alle andre mønstre. De matcher mot normalisert tekst.
  - «inneholder» betyr at teksten inneholder mønsteret. «er lik» og «starter med» er uendret.
- **Uendret:** kontovilkår (OG-vilkår), regelens eget ansvar (resultat atskilt fra treff), terskel og rangering.

## Bevisst avvik fra legacy (`index.html` ~9152)

Legacy lot «inneholder» treffe også når **mønsteret** inneholdt teksten (`rPattern.includes(t)`). Derfor traff «cc mat» bankteksten «Mat».

- Den omvendte inklusjonen er fjernet. Konsekvensen er bevisst: en kort tekst treffer ikke lenger et lengre mønster. «REMA» treffer for eksempel ikke «rema 1000 grunerlokka».
- Avviket er låst som egen test i `forsoning.legacy.test.ts`.
- Alle andre tekster gir samme treff som legacy.

## Én matcher i alle veier

`regelMatcherTekst(regel, treffgrunnlag)` brukes i alle disse veiene:

- import og forhåndsvisning;
- «Kjør regler», der råteksten også brukes når en eldre `normalizedText` er lagret;
- «Treffer i dag»;
- læring (`finnLaertRegel`);
- utvid.

## Læring, spredning, flerbruk og utvid

- **Læringsnøkkel (`laeringsnokkel`):** normalisert tekst. Unntaket er svak tekst, der bokstavene som er igjen bare er «til», «fra» eller ingen:
  - har råteksten nøyaktig ett sifferløp, er nøkkelen det sifferløpet;
  - har den ingen eller flere, er nøkkelen tom.
- **Læring av svak tekst med ett sifferløp:**
  - En eksisterende tallregel for samme post og samme kontovilkår gjenbrukes.
  - Et eldre, bredt tekstmønster som «til :» gjenbrukes eller styrkes aldri (6639556626).
  - Finnes ingen passende tallregel, læres tallregelen på sifferløpet.
- **Svak tekst uten entydig sifferløp:** plasseringen lagres, men ingen regel læres og ingen forslag spres.
- **Spredning og flerbruk:** gjelder bare transaksjoner med samme læringsnøkkel, altså samme mottaker.
- **Utvid:** tilbys aldri for en tallregel, og aldri når det utvidede mønsteret blir svakt.

## Regelsenteret

- En tallregel vises som «Teksten har tallet «…» (eksakt kontonummer/KID)».
- Et blandet mønster med langt tall, for eksempel «til :20957976493», får en hjelpetekst: lange tall fjernes fra bankteksten før matching, så bruk bare tallet.

Eksisterende regler skrives aldri om automatisk, og historikk vurderes ikke på nytt automatisk.
