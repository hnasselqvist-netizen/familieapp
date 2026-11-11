# Arbeidsflyt: fjern én hel fryserpost (ChatGPT via MCP)

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6762606495).

Arbeidsflyten fjerner **én entydig, hel fryserpost** etter eksplisitt bestilling fra brukeren, med samme grunnlagsvern som appens «Fjern fra matlageret». Den bruker bare `data_les`, `data_hent` og `data_skriv` (`mcp-server/README.md` §«Generell skriving»).

Den gjør ikke noe av dette:

- fjerner enkeltbatcher eller setter mengde 0 (se [`fryser-mengde.md`](fryser-mengde.md) §3);
- tolker «brukt opp» eller «tom»;
- registrerer forbruk eller historikk;
- endrer handleliste eller basisvarer.

## 1. Appens handling

«Fjern fra matlageret» i `FreezerScreen` kaller `useFreezer.removeItem(observert)`, som igjen kjører `transactFreezerNode` med `fjernHvisUendret` (`web/src/domain/freezer/freezer.ts`).

- **Grunnlagsvern.** `observert` er posten slik brukeren så den. Inne i transaksjonen sammenlignes **hele** den ferske posten med den, med stabil JSON (`grunnlag`). Endret antall, batch, batchrekkefølge, navn, `itemId` eller et ukjent felt gir avvisningen `endret`, og ingenting fjernes.
- **Nodenøkkel og eldre `id`-felt.** Posten identifiseres ved nodenøkkelen, `freezer/{id}`. Et lagret `id`-felt som er **likt** nøkkelen, fra eldre poster, ignoreres i sammenligningen. Et `id`-felt som **avviker** fra nøkkelen, gir alltid `endret`. Da fjerner appen aldri posten.
- **Mangler posten,** gir det avvisningen `mangler`. Ingenting gjenopprettes.
- **Utfall:** `lagret`, `konflikt` (`endret` eller `mangler`), `avvist` (`permission_denied`) eller `ukjent`. Det er ingen automatisk nytt forsøk.
- **Sideeffekter:** ingen. Bare noden `freezer/{id}` slettes. Historikk, handleliste, basisvarer og varebasen røres ikke.

Alt over er dekket av `fjern.test.ts` og `freezer.fjern.integration.test.ts`, inkludert et avvikende `id`-felt, ukjente felt og en post som allerede er fjernet.

## 2. Speiling med `data_skriv`

| Appens vern                                     | Arbeidsflyten                                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hele posten sammenlignes med det brukeren så    | `slett` på `freezer/<nøkkel>` med `forventet` lik **nodeversjonen** fra `data_hent`. Versjonen dekker hele noden, så enhver endring etter lesingen gir `konflikt`, og ingenting slettes. |
| `id`-felt lik nøkkelen ignoreres                | Feltet endrer seg ikke av seg selv, så versjonen gir samme resultat.                                                                                                                     |
| `id`-felt som avviker fra nøkkelen gir `endret` | **Stopp uten skriving.** Appen ville aldri fjernet posten.                                                                                                                               |
| `mangler` gjenoppretter ikke                    | `data_hent` uten verdi betyr stopp, og posten meldes som allerede fjernet. `forventet: "mangler"` brukes aldri for å slette.                                                             |
| Én transaksjon på noden                         | `data_skriv` lagrer alt i én RTDB-transaksjon på `families/{f}`, alt eller ingenting, med kvitteringen i samme transaksjon.                                                              |

Ved samtidige ＋/−, ny batch eller «Legg til» i appen etter lesingen har noden ny versjon. `slett` gir da `konflikt` og skriver ingenting.

## 3. Les smalt og avgrens

En **eksplisitt og entydig** bestilling om å fjerne hele posten autoriserer slettingen (#27 6509067353). Det kreves ingen ekstra bekreftelse. Bare tvetydig omfang, tvetydig mål eller et endret grunnlag avklares med brukeren.

1. **Finn posten:** `data_les { sti: "freezer" }`. Bare nøkkel, `name` og batchene brukes.
   - **Les alle sider.** Følg `neste` til den er `null` før et treff kalles entydig. Sidene er ikke et felles øyeblikksbilde, så oppslaget gir bare en kandidat. Avgjørelsen tas i 3.
   - **Uleselige kandidater.** Et barn som rapporteres som `forStor`, leses på egen sti (`freezer/<nøkkel>`). Kan det fortsatt ikke leses, eller mangler det tekst i `name`, kan det være et treff. Da stopper du og ber brukeren om eksplisitt målvalg.
   - **Treff** er poster der `name` er lik brukerens navn uten hensyn til store og små bokstaver, som appens `sammeNavn`. Brukerens navn trimmes først.
   - **Ingen treff, flere treff eller bare liknende navn:** vis kandidatene og be om eksplisitt målvalg. Gjett aldri.
2. **Omfanget må være hele posten,** som i «fjern laks fra matlageret».
   - «Brukt opp», «tom» eller «spist» kan bety én batch, mengde 0 eller forbruk. Spør hva som menes. Fjern ikke på denne tolkningen.
   - Gjelder bestillingen én batch eller en mengde, er det ikke denne arbeidsflyten.
3. **Grunnlaget:** `data_hent { sti: "freezer/<nøkkel>" }` gir `verdi` og `versjon` fra **samme** lesing. Slettingen bygger bare på dette, ikke på oppslaget i 1.
   - **Mangler verdien:** stopp, og meld at posten allerede er fjernet.
   - **`forStor`, eller ingen `versjon`:** stopp uten skriving. Det finnes ikke noe versjonsgrunnlag.
   - **Valider identiteten mot `verdi`:**
     - `name` må fortsatt treffe brukerens navn;
     - et lagret `id`-felt må være likt nøkkelen.

     Har navnet endret seg siden oppslaget, er grunnlaget endret. Vis det, og be om eksplisitt målvalg. Et avvikende `id`-felt gir stopp uten skriving, som i appen.
4. **Meld hva som fjernes,** med navn og alle batcher med `batchLabel`, for eksempel «2 pk à 400 g · 1 stk». Dette er en melding, ikke et nytt spørsmål.

## 4. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>` med UTC-dato og et tilfeldig suffiks på 8–80 tegn. opId og operasjonen noteres uendret.
2. Send `data_skriv { opId, ops: [{ sti: "freezer/<nøkkel>", type: "slett", forventet: "<versjonen fra samme data_hent>" }] }`.
   - Stien er alltid nodenøkkelen fra `data_les`, aldri et lagret `id`-felt.
   - Det skrives aldri på `freezer`.

## 5. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall                             | Handling                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `committed`                        | Les tilbake (6).                                                                                                                                                                                                                                                                              |
| `replay`                           | Allerede slettet med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                                                              |
| `konflikt`                         | Posten er endret eller fjernet siden lesingen. Ingenting er slettet. Les på nytt med `data_hent`, og vis den nye tilstanden. Grunnlaget er endret, så det avklares med brukeren før en eventuell ny sletting med ny versjon og nytt opId. Mangler posten nå, meld at den allerede er fjernet. |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri nytt opId. Kvitteringen gjør retry idempotent. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen.          |
| `utlopt`                           | Kvitteringen kan ikke lenger bevise utfallet. Les posten uten å skrive. At den mangler, er ikke bevis for at dette kallet slettet den, så rapporter utfallet som uavklart. Finnes den, avklar med brukeren før en eventuell ny sletting med nytt opId.                                        |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen.                                                                                                                                                            |

## 6. Les tilbake og meld

- **Den innebygde tilbakelesingen** i svaret fra `data_skriv` sier hvilken versjon som ble lagret, og om noden er endret senere (`senereEndret`). Utfallet av den opprinnelige operasjonen er det `data_skriv` bekreftet: `committed` eller `replay`.
- **En separat, fersk `data_hent { sti: "freezer/<nøkkel>" }`** viser hva som finnes nå. Forventet resultat er at noden mangler.
- **Finnes noden likevel,** meldes det. Det gjelder også om den innebygde tilbakelesingen viste `senereEndret: false` eller feilet. Meld to ting hver for seg:
  - det bekreftede utfallet for den opprinnelige slettingen;
  - hva som faktisk finnes på noden nå, med navn og batcher.

  Påstå ingen årsak til at noden finnes. Den beholdes, og den fjernes ikke på nytt uten en ny eksplisitt bestilling.

- **Ved `replay`** gjelder det samme: kvitteringen bekrefter den opprinnelige slettingen, og den ferske lesingen viser nåtilstanden.
- **Meld brukeren** hvilken post som ble fjernet, med navn og batcher slik de var i grunnlaget.

## 7. Kodeankre og tester

- **Kontrakt:**
  - `web/src/data/freezer.repository.ts` (`subscribeFreezer`, `transactFreezerNode`);
  - `web/src/domain/freezer/freezer.ts` (`fjernHvisUendret`, `grunnlag`, `sletteTekst`, `batchLabel`, `observertMaal`);
  - `web/src/hooks/useFreezer.ts` (`removeItem`);
  - `web/src/features/hverdagsflyt/mat/freezer/FreezerScreen.tsx` (`fjern`).
- **Eksisterende dekning:**
  - `fjern.test.ts` dekker uendret React- og eldre post, endret batch, antall, navn, `itemId` og ukjente felt, et avvikende `id`-felt og manglende post;
  - `freezer.fjern.integration.test.ts` dekker de samme mot emulatoren, og `avvist`;
  - `mcp-server/src/store/dataSkriving.integration.test.ts` dekker `slett`, konflikt, replay og tilbakelesing.
- **Ingen ny test.** Dekningen var komplett for det arbeidsflyten bygger på.
