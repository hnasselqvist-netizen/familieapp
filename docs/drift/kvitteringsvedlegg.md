# Aktiveringsvedlegg: kvitteringsfiler (B1)

Status: **kode levert, produksjonsaktivering AV.** Ingenting under er utført.
Hvert steg krever Helens godkjenning av en ferdig gjennomgått løsning
(#59 6546642665). Ingen sikkerhets- eller driftsendring gjøres automatisk.

## Hva som er bygget

- **Vedleggstjenesten:** `mcp-server/src/vedlegg/`.
  - Egen bundle: `npm run build:vedlegg`.
  - Eget image: `mcp-server/Dockerfile.vedlegg`.
  - Adskilt fra MCP-serveren; deler bare repo og byggeverktøy.
- **Tilgang** sjekkes per forespørsel:
  - Firebase ID-token, verifisert med tilbakekallingssjekk;
  - dagens `families/{f}/members/{uid}` for familien i stien.
  - Tjenesten skriver aldri til RTDB.
- **Lagring:** originalbytes for JPEG, PNG, WebP og PDF. Signatur og størrelse sjekkes på serveren.
  - Objektene ligger innholdsadressert i `families/{f}/kvitteringer/{receiptId}/{sha256}`.
  - De skrives med `ifGenerationMatch: 0`, så et objekt bare opprettes, aldri overskrives.
  - Ingen sletting, og ingen URL-er lagres.
- **Klient:**
  - `KvitteringFiler` vises bare med `VITE_VEDLEGG_TJENESTE=aktiv`.
  - Metadata legges i `receipts[].vedlegg` med stabil kvitterings-ID, via helnode-transaksjonen.
  - En ny fil gir «Endret etter kontroll» i kvalitetssikringen.

## Ukjente driftsforhold

Disse må avklares eller verifiseres før aktivering. Jeg har **ikke** kunnet verifisere dem fra økten: firebase.google.com og docs.cloud.google.com er blokkert.

| Forhold                                                                           | Status                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grenser for Hosting-rewrite til Cloud Run (maks request body, tidsavbrudd)        | **Ikke verifisert.** Må leses i offisiell Firebase-dokumentasjon. `VEDLEGG_MAKS_BYTES` (standard 10 MiB) og `MAKS_FILBYTES` i klienten må settes lavere enn eller lik grensen. |
| Cloud Runs grense for request-størrelse                                           | **Ikke verifisert** fra økten.                                                                                                                                                 |
| Om bøtta `familieapp-a5d15.firebasestorage.app` finnes, og hvilken region den har | **Ukjent.** Navnet står i configen uansett om bøtta finnes. Kontrolleres i konsollen, kun lesing.                                                                              |
| Billing/Blaze på prosjektet                                                       | Sterk indikasjon, siden Cloud Run kjører, men **ikke verifisert**.                                                                                                             |
| Lagringspris per GiB-måned i europe-west1                                         | **Ikke verifisert.** Øvrige offisielle priser og regneeksempel står i #59 6541616036. Eldre kostnadsanslag brukes ikke uten ny kildekontroll.                                  |
| GCS-adapteren mot ekte objektlager (`ifGenerationMatch: 0`, 412, 404)             | **Ikke verifisert.** Adapteren er bare typekontrollert. Opprett-bare-kontrakten er testet mot det falske lageret. Se «Adapterverifikasjon» under.                              |

## Steg ved aktivering

Rekkefølgen gjelder, og ingenting gjøres før Helen har godkjent.

1. **Kun lesing:** bekreft billing, og om bøtta finnes og i hvilken region. Verifiser rewrite-grensene ovenfor.
2. **Bøtte:** europe-west1, Standard, uniform bucket-level access, public access prevention _enforced_.
3. **Storage-regler:** «alt nektes» for klienter. Deployes **manuelt**, som RTDB-reglene.
4. **Egen runtime-SA for tjenesten, med minste rettigheter:**
   - `roles/storage.objectCreator` og `roles/storage.objectViewer` **på bøtta**. Ingen sletting, og ingenting på prosjektnivå.
   - Lesetilgang til RTDB for medlemskapssjekken.
   - Tilgang for `verifyIdToken` med tilbakekallingssjekk (Firebase Auth).
5. **Egen Cloud Run-tjeneste** fra `Dockerfile.vedlegg`, med disse variablene:
   - `FIREBASE_DATABASE_URL`;
   - `VEDLEGG_LAGER=gcs`;
   - `VEDLEGG_BUCKET`;
   - `VEDLEGG_ALLOW_PRODUCTION=true`;
   - eventuelt `VEDLEGG_MAKS_BYTES`.
   - **ingen** emulatorvariabler. Tjenesten nekter å starte med blandet oppsett: halv emulator, en Storage-emulatorvariabel i ekte modus, eller GCS mot emulator.
6. **Hosting-rewrite** `/api/vedlegg/**` → tjenesten, foran `**` → `/index.html` i `firebase.json`. Det legges **ikke** inn før tjenesten finnes.
7. **Web-bygget** får `VITE_VEDLEGG_TJENESTE=aktiv`, og så deployes det.
8. **Skrivefri etterkontroll:** tellinger og digester for forsoningsnodene uendret. Ingen testkvitteringer eller testfiler skrives i produksjon som del av etterkontrollen.
9. **Budsjettvarsel** på billing-kontoen.

Ingen claims, ingen CORS på bøtta (samme origin) og ingen endring i Auth0 eller i MCP-scopes.

## Adapterverifikasjon

Ingen skriving til en ekte bøtte og ingen produksjonstest er autorisert i B1. Der er alt testet mot emulator og falskt lager.

Trengs reell verifikasjon av GCS-adapteren, skal den inngå konkret i aktiveringspakken:

- med et avklart, separat testmiljø (ikke produksjonsbøtta eller produksjonsdata);
- med eksplisitt autorisasjon før den utføres.

Offisielle grenser og priser som ikke er verifisert, står som ukjente til de er kontrollert mot kilden.

## Tilbakerulling

- Fjern `VITE_VEDLEGG_TJENESTE` og deploy web på nytt: filkontrollene forsvinner.
- Metadata i `receipts` og objekter i bøtta blir liggende urørt. Ingenting slettes automatisk.
