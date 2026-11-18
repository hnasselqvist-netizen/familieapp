import { describe, expect, it } from "vitest";
import type { FeltPlan } from "@domain/shopping/handlelisteFelt";
import type { MengdePlan } from "@domain/shopping/handlelisteMengde";
import type { StatusPlan } from "@domain/shopping/handlelisteStatus";
import { feltTekst } from "./feltTekst";
import { fjernTekst, fullforteTekst } from "./fjernTekst";
import { mengdeTekst } from "./mengdeTekst";
import { statusTekst } from "./statusTekst";

/**
 * Utfallet `byttet` (Mat #20, ordre 6979672219): innloggingen ble endret før
 * skrivingen ble sendt. Hver handling sier tydelig at ingenting er skrevet.
 */
const B = { utfall: "byttet" } as const;
const felt: FeltPlan = {
  id: "m",
  felt: "name",
  navn: "Melk",
  itemId: null,
  foer: "melk",
  ny: "Lettmelk",
} as FeltPlan;
const mengde: MengdePlan = { id: "m", navn: "Melk", itemId: null, foer: "1", ny: "2" };
const status: StatusPlan = { id: "m", navn: "Melk", itemId: null, maal: true };

describe("tekster for `byttet`", () => {
  it.each([
    [
      "Lagre navn",
      feltTekst(B, felt),
      /^Innloggingen ble endret før navnet på «Melk» ble lagret\. Ingenting er lagret\./,
    ],
    [
      "Fjern",
      fjernTekst(B, "Melk"),
      /^Innloggingen ble endret før «Melk» ble fjernet\. Ingenting er fjernet\.$/,
    ],
    [
      "Fjern fullførte",
      fullforteTekst(B),
      /^Innloggingen ble endret før de fullførte varene ble fjernet\. Ingenting er fjernet\.$/,
    ],
    [
      "Lagre mengde",
      mengdeTekst(B, mengde),
      /^Innloggingen ble endret før mengden på «Melk» ble lagret\. Ingenting er lagret — utkastet ditt står\.$/,
    ],
    [
      "Merk som fullført",
      statusTekst(B, status),
      /^Innloggingen ble endret før «Melk» ble merket som fullført\. Status er ikke endret\.$/,
    ],
  ])("%s", (_n, tekst, forventet) => {
    expect(tekst).toMatch(forventet);
  });
});
