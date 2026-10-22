import { describe, expect, it } from "vitest";
import { SHOP_CATS } from "@domain/shared/constants";
import { HANDLELISTE_KATEGORIORDEN, SISTE_KATEGORI, sorterKategorier } from "./kategoriorden";

describe("fast kategoriorden i handlelisten (§Issue #20)", () => {
  it("følger Helens endelige rekkefølge oversatt til eksisterende kategori-ID-er", () => {
    expect(sorterKategorier([...SHOP_CATS])).toEqual([
      "Frukt og grønt",
      "Kjøtt",
      "Fisk og sjømat",
      "Brød og bakst",
      "Ost og meieri",
      "Frysevarer",
      "Drikke",
      "Rengjøring",
      "Tørrvarer",
      "Diverse",
    ]);
  });

  it("dekker alle eksisterende kategori-ID-er uten å finne på nye", () => {
    const kjente = [...HANDLELISTE_KATEGORIORDEN, SISTE_KATEGORI];
    expect([...kjente].sort()).toEqual([...SHOP_CATS].sort());
  });

  it("er uavhengig av rekkefølgen varene kommer i", () => {
    const a = sorterKategorier(["Diverse", "Drikke", "Frukt og grønt", "Kjøtt"]);
    const b = sorterKategorier(["Kjøtt", "Frukt og grønt", "Diverse", "Drikke"]);
    expect(a).toEqual(b);
    expect(a).toEqual(["Frukt og grønt", "Kjøtt", "Drikke", "Diverse"]);
  });

  it("flytter ikke de andre kategoriene når én forsvinner eller kommer til", () => {
    const før = sorterKategorier(["Tørrvarer", "Frukt og grønt", "Drikke"]);
    const etterAvhuking = sorterKategorier(["Tørrvarer", "Drikke"]);
    const etterTilføying = sorterKategorier([
      "Ost og meieri",
      "Tørrvarer",
      "Frukt og grønt",
      "Drikke",
    ]);
    expect(før).toEqual(["Frukt og grønt", "Drikke", "Tørrvarer"]);
    expect(etterAvhuking).toEqual(["Drikke", "Tørrvarer"]);
    expect(etterTilføying).toEqual(["Frukt og grønt", "Ost og meieri", "Drikke", "Tørrvarer"]);
  });

  it("fjerner duplikater", () => {
    expect(sorterKategorier(["Drikke", "Drikke", "Kjøtt", "Drikke"])).toEqual(["Kjøtt", "Drikke"]);
  });

  it("legger ukjente kategorier alfabetisk etter de kjente, men før Diverse", () => {
    expect(sorterKategorier(["Diverse", "Snacks", "Krydder", "Drikke"])).toEqual([
      "Drikke",
      "Krydder",
      "Snacks",
      "Diverse",
    ]);
  });
});
