import type { Person } from "@app-types/gaver";
import { budsjettTekst, effektivStandard, type Grupper } from "@domain/gaver/gaver";

const kildeTekst = { person: "eget valg", gruppe: "fra gruppen", standard: "standard" } as const;

export function julTekst(p: Person, grupper: Grupper): string {
  const e = effektivStandard(p, grupper, "jul");
  if (!e.aktiv) return `Ikke med i jul (${kildeTekst[e.aktivFra]})`;
  return `Med i jul · budsjett ${budsjettTekst(e.budsjett).toLowerCase()} (${kildeTekst[e.budsjettFra]})`;
}

export function bursdagBudsjettTekst(p: Person, grupper: Grupper): string {
  const e = effektivStandard(p, grupper, "bursdag");
  return `Bursdag · budsjett ${budsjettTekst(e.budsjett).toLowerCase()} (${kildeTekst[e.budsjettFra]})`;
}
