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
