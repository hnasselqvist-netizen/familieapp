/**
 * Kontrakten for full lesing (`data_nokler`, `data_les`). Ingen familyId:
 * den utledes alltid fra koblingen (`auth/authorize.ts`). Stien er relativ
 * til familienoden og valideres i `sti.ts`.
 */
import { z } from "zod";
import { MAKS_DYBDE } from "./sti";

export const STANDARD_MAKS_BYTES = 100_000;

const sti = z
  .string()
  .max(MAKS_DYBDE * 800)
  .default("")
  .describe(
    "Sti relativt til familiens data, segmenter skilt med «/». Tom = familienoden selv (oversikt over alle datanoder). Eksempler: «transaksjoner», «transaksjoner/12», «mealLibrary».",
  );
const etter = z
  .string()
  .max(800)
  .optional()
  .describe("Markør: `neste` fra forrige side. Utelatt = første side.");

export const dataNoklerInput = {
  sti,
  etter,
  antall: z.number().int().min(1).max(1000).default(200).describe("Maks antall nøkler per side."),
};

export const dataNoklerOutput = {
  sti: z.string(),
  type: z.enum(["mangler", "verdi", "node"]),
  nokler: z.array(z.string()),
  neste: z.string().nullable(),
  totalt: z.number().int().min(0),
};

export const dataLesInput = {
  sti,
  etter,
  antall: z.number().int().min(1).max(500).default(50).describe("Maks antall barn per side."),
  maksBytes: z
    .number()
    .int()
    .min(1_000)
    .max(500_000)
    .default(STANDARD_MAKS_BYTES)
    .describe(
      "Omtrentlig størrelsesgrense for svaret per side (ikke for det som hentes). Et barn som alene er større, rapporteres som `forStor` og leses på sin egen sti. For tekstdeler er grensen i UTF-16-tegn. Sidene er ikke et konsistent øyeblikksbilde ved samtidige endringer.",
    ),
  fraTegn: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("For en lang tekstverdi: startposisjon (`nesteFraTegn` fra forrige del)."),
};

const primitiv = z.union([z.string(), z.number(), z.boolean()]);

export const dataLesOutput = {
  sti: z.string(),
  type: z.enum(["mangler", "verdi", "tekstdel", "node"]),
  verdi: primitiv.optional(),
  lengde: z.number().int().optional(),
  fraTegn: z.number().int().optional(),
  del: z.string().optional(),
  nesteFraTegn: z.number().int().nullable().optional(),
  barn: z
    .array(
      z.object({
        nokkel: z.string(),
        verdi: z.unknown().optional(),
        forStor: z
          .object({
            bytes: z.number().int(),
            type: z.enum(["node", "tekst"]),
            antallBarn: z.number().int().optional(),
            lengde: z.number().int().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  neste: z.string().nullable().optional(),
};

// --- Generell skriving (`data_hent`, `data_skriv`, #27 6509067353) ----------

const versjon = z
  .string()
  .max(40)
  .describe(
    "Versjon fra data_hent for nøyaktig denne stien, eller «mangler» hvis den ikke finnes.",
  );

export const dataHentInput = {
  sti: z
    .string()
    .max(MAKS_DYBDE * 800)
    .default("")
    .describe(
      "Sti relativt til familiens data. Gir verdien OG versjonen fra samme lesing — grunnlaget for data_skriv. For store noder: hent en smalere sti.",
    ),
};

export const dataHentOutput = {
  sti: z.string(),
  finnes: z.boolean(),
  verdi: z.unknown().optional(),
  versjon: z.string().optional(),
  bytes: z.number().int().min(0),
  forStor: z.boolean().optional(),
};

const skriveOp = z.object({
  sti: z
    .string()
    .max(MAKS_DYBDE * 800)
    .describe("Sti relativt til familiens data. Tom = familieroten."),
  type: z
    .enum(["set", "update", "slett"])
    .describe(
      "set: erstatt noden med `verdi`. update: erstatt bare de navngitte direkte barna (`verdi` = { nøkkel: ny verdi }); urørte barn bevares. slett: fjern noden.",
    ),
  verdi: z
    .unknown()
    .optional()
    .describe(
      "JSON-verdien. Ingen null, tomme objekter/lister eller ikke-endelige tall; slett med type «slett».",
    ),
  forventet: z
    .union([versjon, z.record(z.string(), versjon)])
    .describe(
      "Versjonen klienten så (fra data_hent). For update: { nøkkel: versjon } for hvert barn i `verdi`. Avviker den, skrives ingenting.",
    ),
});

export const dataSkrivInput = {
  opId: z
    .string()
    .max(100)
    .describe(
      "Unik id for denne endringen: «ÅÅÅÅ-MM-DD_<tilfeldig>» med dagens UTC-dato, f.eks. «2026-10-30_3f9c2a71b4». Bruk SAMME opId hvis kallet prøves på nytt; da gjøres endringen aldri to ganger.",
    ),
  ops: z.array(skriveOp).min(1).max(100).describe("Endringene. Alle lagres samlet, eller ingen."),
};

const utfallSkriving = z.object({
  sti: z.string(),
  type: z.enum(["set", "update", "slett"]),
  foer: z.string(),
  etter: z.string(),
  bevart: z.array(z.string()),
});

export const dataSkrivOutput = {
  utfall: z.enum(["committed", "replay"]),
  opId: z.string(),
  skrivinger: z.array(utfallSkriving),
  tilbakelesing: z.union([
    z.object({
      ok: z.literal(true),
      skrivinger: z.array(
        z.object({ sti: z.string(), versjon: z.string(), senereEndret: z.boolean() }),
      ),
    }),
    z.object({ ok: z.literal(false) }),
  ]),
};
