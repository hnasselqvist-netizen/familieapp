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

| Appens vern                                     | Arbeidsflyten                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hele posten sammenlignes med det brukeren så    | `slett` på `freezer/<id>` med `forventet` lik **nodeversjonen** fra `data_hent`. Versjonen dekker hele noden, så enhver endring etter lesingen gir `konflikt`, og ingenting slettes. |
| `id`-felt lik nøkkelen ignoreres                | Feltet endrer seg ikke av seg selv, så versjonen gir samme resultat.                                                                                                                 |
| `id`-felt som avviker fra nøkkelen gir `endret` | **Stopp uten skriving.** Appen ville aldri fjernet posten.                                                                                                                           |
| `mangler` gjenoppretter ikke                    | `data_hent` uten verdi betyr stopp, og posten meldes som allerede fjernet. `forventet: "mangler"` brukes aldri for å slette.                                                         |
| Én transaksjon på noden                         | `data_skriv` lagrer alt i én RTDB-transaksjon på `families/{f}`, alt eller ingenting, med kvitteringen i samme transaksjon.                                                          |

Ved samtidige ＋/−, ny batch eller «Legg til» i appen etter lesingen har noden ny versjon. `slett` gir da `konflikt` og skriver ingenting.

## 3. Les smalt og bekreft

1. **Finn posten:** `data_les { sti: "freezer" }`. Bare nøkkel, `name` og batchene brukes.
   - Treff er poster der `name` er lik brukerens navn uten hensyn til store og små bokstaver, som appens `sammeNavn`. Brukerens navn trimmes først.
   - Ingen treff, flere treff eller bare liknende navn: vis kandidatene og la brukeren velge. Gjett aldri.
2. **Bestillingen må være entydig.** Brukeren må be om å fjerne **hele** posten, som «fjern laks fra matlageret».
   - «Brukt opp», «tom» eller «spist» kan bety én batch, mengde 0 eller forbruk. Spør hva som menes, og fjern ikke på denne tolkningen.
   - Gjelder bestillingen én batch eller en mengde, er det ikke denne arbeidsflyten.
3. **Grunnlaget:** `data_hent { sti: "freezer/<id>" }` gir `verdi` og `versjon` fra samme lesing.
   - Mangler verdien: stopp, og meld at posten allerede er fjernet.
   - Har verdien et `id`-felt som avviker fra `<id>`: stopp uten skriving og vis det.
4. **Vis før sletting:** navn og alle batcher med `batchLabel`, for eksempel «2 pk à 400 g · 1 stk». Be brukeren bekrefte at hele posten skal fjernes.

## 4. Skriv

1. Lag opId **én gang** etter `OPID` i `mcp-server/src/data/skriving.ts`: `ÅÅÅÅ-MM-DD_<suffiks>` med UTC-dato og et tilfeldig suffiks på 8–80 tegn. opId og operasjonen noteres uendret.
2. Send `data_skriv { opId, ops: [{ sti: "freezer/<id>", type: "slett", forventet: "<versjonen fra samme data_hent>" }] }`.
   - Stien er alltid nodenøkkelen fra `data_les`, aldri et lagret `id`-felt.
   - Det skrives aldri på `freezer`.

## 5. Utfall, konflikt og retry

Ingen utfall fører til en ny automatisk skriving.

| Utfall                             | Handling                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `committed`                        | Les tilbake (6).                                                                                                                                                                                                                                                                     |
| `replay`                           | Allerede slettet med samme opId. Ingen ny skriving. Les tilbake.                                                                                                                                                                                                                     |
| `konflikt`                         | Posten er endret eller fjernet siden lesingen. Ingenting er slettet. Les på nytt med `data_hent`, vis den nye tilstanden, og spør brukeren. En ny sletting krever ny bekreftelse, ny versjon og nytt opId. Mangler posten nå, meld at den allerede er fjernet.                       |
| `ukjent_utfall`, `skriving_feilet` | Uavklart. Bare på brukerens forespørsel, og innenfor gyldighetsvinduet (30 dager, og etter `_mcp/vannmerke`), prøves det igjen med **samme opId og samme operasjon**, aldri nytt opId. Kvitteringen gjør retry idempotent. Er `skriving_feilet` `vedvarende`, stopp og meld grunnen. |
| `utlopt`                           | Kvitteringen kan ikke lenger bevise utfallet. Les posten uten å skrive. At den mangler, er ikke bevis for at dette kallet slettet den, så rapporter utfallet som uavklart. Finnes den, avklar med brukeren før en eventuell ny sletting med nytt opId.                               |
| Andre feil                         | `ugyldig_skriving`, `invalid_path`, `beskyttet`, `not_member` og `idempotency_conflict` skriver garantert ingenting. Meld grunnen.                                                                                                                                                   |

## 6. Les tilbake og meld

- Les `data_hent { sti: "freezer/<id>" }` uten å skrive. Forventet resultat er at noden mangler.
- Finnes noden igjen med `senereEndret: true`, er posten lagt til på nytt etterpå, for eksempel med «Legg til» i appen. Meld det som det er, og fjern den ikke på nytt.
- Meld brukeren hvilken post som ble fjernet, med navn og batcher slik de var.

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
