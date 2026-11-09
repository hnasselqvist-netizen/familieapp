# Arbeidsflyt: notat på én middag i Middagsbiblioteket (ChatGPT via MCP) — stoppet

Dette er roadmap «Praktisk vedlikehold via ChatGPT», bestilt i #27 (6747848773): endre notatet på én eksisterende middag i Middagsbiblioteket etter eksplisitt brukerbestilling.

**Status: grenen er stoppet før noe kall beskrives.** Det finnes ikke noe lagret notatfelt på en bibliotekmiddag. Et felt skrevet utenfor appen ville dessuten bli strøket stille ved neste vanlige endring i appen. ChatGPT skal derfor svare at notat på bibliotekmiddager ikke støttes ennå, og ikke skrive.

**Oppdatert etter #20 6749312086:** steg 1 i §3 er levert. `transactMealLibraryEntry` bevarer nå ukjente felt (§2 punkt 2 beskriver tilstanden før rettingen). Notatfeltet finnes fortsatt ikke, så stoppen gjelder fortsatt.

## 1. Hva koden og dataene faktisk har

Verifisert mot fersk `main` (`3480644`).

- **Sti og skrivevei:** én middag er én node, `mealLibrary/{id}`. Appen skriver per post med `transactMealLibraryEntry` (`web/src/data/mealLibrary.repository.ts`). Enkeltfelt endres med domenets `updateEntryFields` (`web/src/domain/mealLibrary/mealLibrary.ts`) via `useMealLibrary`.
- **Lagrede felt** (`MealLibraryEntry` i `web/src/types/shopping.ts`):
  - `name`;
  - `shoppingBase` (handlegrunnlag);
  - `variants`;
  - `lettvint`;
  - `variationTags`.

  Det finnes ikke noe notatfelt. `updateEntryFields` tar bare `name`, `lettvint` og `variationTags`.

- **Visning:**
  - `MealLibraryScreen` (React) viser og redigerer ikke noe notat.
  - `index.html` (`MealLibraryScreen`, linje ~3113–3174) gjør det heller ikke.
- **Produksjon:** skjemalesing uten skriving, gjort 09.11 og rapportert bare som tellinger. Det er 24 bibliotekmiddager. Feltene som finnes på toppnivå:

  | Felt            | Antall middager |
  | --------------- | --------------- |
  | `name`          | 24              |
  | `variationTags` | 12              |
  | `shoppingBase`  | 10              |
  | `variants`      | 7               |
  | `lettvint`      | 5               |

  Ingen middag har noe notat-, note- eller beskrivelsesfelt.

## 2. Hvorfor grenen stoppes

1. **Det finnes ingen kildeform å endre.** «Endre notatet» forutsetter et lagret felt. Å innføre et nytt felt, for eksempel `notat`, er en beslutning om datamodell og produkt. Det er ikke en vedlikeholdsoperasjon.
2. **Råformen bevares ikke av appen.** Ved hver vanlige skriving kaster appen felt den ikke kjenner:
   - `transactMealLibraryEntry` bygger det som skrives fra en fast liste (`name`, `shoppingBase`, `variants`, `lettvint`, `variationTags`);
   - `parseShoppingBaseItem` og `parseMealVariant` gjør det samme for varelinjer og varianter.

   Et felt som `data_skriv` legger på en middag, en varelinje eller en variant, strykes derfor stille neste gang samme middag endres i appen. Det gjelder navn, «Lettvint», variasjonsmerker, handlegrunnlag og varianter.

   Dette er vist mot emulatoren med syntetiske data, i en test som ikke er sjekket inn. Rått `notat` på toppnivå, på en varelinje og på en variant var borte etter `updateEntryFields(…, { lettvint: true })`. Det nye feltet `lettvint` ble lagret.

3. **Det finnes ingen semantikk for å tømme et notat.** Ingen appvei setter eller tømmer et notat. Da er det ingenting å speile, verken tom streng eller fjernet nøkkel.
4. **Brukeren ville ikke sett resultatet.** Ingen skjerm viser feltet.

Teknisk ville `data_skriv` `update` på `mealLibrary/{id}` med `verdi: { notat: "…" }` og `forventet: { notat: "mangler" }` blitt committet. Det skal likevel ikke gjøres. Feltet er usynlig, og appen sletter det ved neste endring.

## 3. Hva som må til for å åpne grenen (forslag, ikke bestilt)

1. **Bevar råfelt i `transactMealLibraryEntry`.** Det gjelder felt på toppnivå, på varelinjer og på varianter, etter samme mønster som Kokebok (#134, `medBevarteFelt`) og Middagsplan (#136). Dette kan tas uavhengig av resten. Det beskytter også andre felt som skrives via MCP. Det må dekkes av regresjoner mot emulatoren. **Levert** (#20 6749312086): `medBevartePostfelt` i `web/src/data/mealLibrary.repository.ts`, med emulatorregresjoner.
2. **En produktbeslutning om notatfeltet:**
   - navn, foreslått `notat`;
   - type: streng;
   - tømming: foreslått at nøkkelen fjernes, så det bare finnes én «tom» form;
   - om notatet hører til middagen eller til varianten.
3. **Selve feltet i appen:** `MealLibraryEntry`, lesing (`parseMealLibraryEntry`), skriving (listen i `transactMealLibraryEntry`), `updateEntryFields` og visning og redigering i `MealLibraryScreen`.
4. **Deretter dokumentasjon av kallet,** etter mønsteret i [`oppskrift-til-middagsplan.md`](oppskrift-til-middagsplan.md):
   - les smalt;
   - krev entydig treff på navn;
   - bruk `data_hent` på `mealLibrary/{id}/notat`;
   - skriv med `data_skriv` og kildeversjon;
   - håndter konflikt, retry og utløpt opId;
   - les tilbake etterpå.

Ingenting i denne leveransen endrer kode, data, verktøy, IAM eller rules.
