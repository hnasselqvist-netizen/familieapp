/**
 * Kontrakten for `forvaltning_cutover_kontroll` (Issue #34). Input er kun
 * sammenligningsparametre — ingen stier, ingen familyId (den utledes alltid
 * fra koblingen, se `auth/authorize.ts`).
 */
import { z } from "zod";
import { ANTALL_BOTTER, FORSONINGSNODER } from "./cutoverKontroll";
import { MAKS_ANTALL, STANDARD_ANTALL, TILSTANDER } from "./transaksjonSok";

const isoTidspunkt = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
    "ISO-tidspunkt i UTC, f.eks. 2026-10-04T18:00:00Z",
  );
const digest = z.string().regex(/^[0-9a-f]{16}$/);

const nodeGrunnlag = z.object({
  antall: z.number().int().min(0),
  digest,
  botter: z.array(digest).length(ANTALL_BOTTER),
});

export const sammenligningsgrunnlag = z.object({
  lest: z.string().max(40),
  noder: z.object(
    Object.fromEntries(FORSONINGSNODER.map((n) => [n, nodeGrunnlag])) as Record<
      (typeof FORSONINGSNODER)[number],
      typeof nodeGrunnlag
    >,
  ),
  referansebrudd: z.record(z.string().max(80), z.number().int().min(0)),
});

export const cutoverKontrollInput = {
  forrige: sammenligningsgrunnlag
    .optional()
    .describe(
      "`sammenligningsgrunnlag` fra et tidligere kall (f.eks. før-snapshotet). Gir `sammenligning`: hvilke noder og bøtter som er endret, og endring i referansebrudd.",
    ),
  endretEtter: isoTidspunkt
    .optional()
    .describe(
      "Lister elementer med tidsstempel ≥ dette tidspunktet. Sammen med `forrige`: endrede bøtter uten slike elementer meldes som uforklarte.",
    ),
};

const nodeRapport = z.object({
  form: z.enum(["tom", "array", "array_med_hull", "objekt", "ugyldig"]),
  antall: z.number().int(),
  hull: z.array(z.number().int()),
  ikkeArrayNokler: z.array(z.string()),
  ugyldigeElementer: z.number().int(),
  utenId: z.object({ antall: z.number().int(), nokler: z.array(z.string()) }),
  dupliserteIder: z.array(z.object({ id: z.string(), antall: z.number().int() })),
  fordeling: z.record(z.string(), z.number().int()),
  digest: z.string(),
});

const nodeEndring = z.object({
  antallFor: z.number().int(),
  antallEtter: z.number().int(),
  endret: z.boolean(),
  endredeBotter: z.array(z.string()),
  uforklarteBotter: z.array(z.string()).optional(),
});

const perNode = <T extends z.ZodType>(schema: T) =>
  z.object(
    Object.fromEntries(FORSONINGSNODER.map((n) => [n, schema])) as Record<
      (typeof FORSONINGSNODER)[number],
      T
    >,
  );

export const cutoverKontrollOutput = {
  format: z.literal(1),
  lest: z.string(),
  vurdering: z.object({ strukturOk: z.boolean(), merknader: z.array(z.string()) }),
  noder: perNode(nodeRapport),
  kvitteringsbilder: z.object({
    drive: z.number().int(),
    base64: z.number().int(),
    annenImageUrl: z.number().int(),
    forkastet: z.number().int(),
  }),
  referansebrudd: z.array(
    z.object({ type: z.string(), antall: z.number().int(), eksempler: z.array(z.string()) }),
  ),
  fortegn: z.array(
    z.object({
      id: z.string(),
      resultat: z.enum(["allerede_korrekt", "trenger_retting", "hoppet_over", "finnes_ikke"]),
      grunn: z.string().optional(),
      belop: z.number().optional(),
      rettetBelop: z.number().optional(),
    }),
  ),
  sammenligningsgrunnlag,
  sammenligning: z
    .object({
      forrigeLest: z.string(),
      noder: perNode(nodeEndring),
      referansebrudd: z.array(
        z.object({ type: z.string(), for: z.number().int(), etter: z.number().int() }),
      ),
    })
    .optional(),
  endretEtter: z
    .object({
      tidspunkt: z.string(),
      noder: perNode(
        z.object({
          antall: z.number().int(),
          ider: z.array(z.string()),
          viaReferanse: z.object({ antall: z.number().int(), ider: z.array(z.string()) }),
        }),
      ),
    })
    .optional(),
};

/** Kontrakten for `transaksjon_sok` (#27/#59). Ingen familyId: den utledes fra koblingen. */
const datoFilter = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ÅÅÅÅ-MM-DD")
  .optional();

export const transaksjonSokInput = {
  konto: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Bankkonto, samme nøkler som kontofilteret i Transaksjoner: «MC», «regningskonto», «felleskonto», «helen», «eivind», «krav».",
    ),
  ansvar: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Person i ansvaret (felles/privat) på transaksjonens hendelse, f.eks. «Felles», «Helen», «Eivind». Treffer når personen har en andel > 0 i minst én fordeling — «Helen» betyr altså ikke 100 % Helen; det kontrolleres i treffets `fordelinger`. Transaksjoner uten hendelse har ikke noe ansvar.",
    ),
  tekst: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Del av banktekst/motpart, f.eks. «Fellesforbundet» eller «Skruvat» (store/små bokstaver likt).",
    ),
  fraDato: datoFilter.describe("Fra og med dato (ÅÅÅÅ-MM-DD)."),
  tilDato: datoFilter.describe("Til og med dato (ÅÅÅÅ-MM-DD)."),
  status: z
    .array(z.enum(TILSTANDER))
    .max(TILSTANDER.length)
    .optional()
    .describe("Behandlingsstatus som i kontrolloversikten; flere = enten-eller."),
  antall: z
    .number()
    .int()
    .min(1)
    .max(MAKS_ANTALL)
    .default(STANDARD_ANTALL)
    .describe("Maks antall treff per side."),
  etter: z
    .string()
    .max(400)
    .optional()
    .describe("Markør: `neste` fra forrige svar. Utelatt = første side."),
};

const eierandel = z.object({ person: z.string(), prosent: z.number() });

export const transaksjonSokOutput = {
  treff: z.array(
    z.object({
      sti: z.string(),
      versjon: z.string(),
      id: z.string().nullable(),
      dato: z.string().nullable(),
      tekst: z.string().nullable(),
      belop: z.number().nullable(),
      retning: z.string().nullable(),
      konto: z.string(),
      status: z.enum(TILSTANDER),
      hendelse: z.object({ sti: z.string(), versjon: z.string() }).nullable(),
      fordelinger: z.array(
        z.object({ post: z.string(), belop: z.number(), eiere: z.array(eierandel) }),
      ),
    }),
  ),
  antallTreff: z.number().int().min(0),
  neste: z.string().nullable(),
};
