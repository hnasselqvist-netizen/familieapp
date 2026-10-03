/**
 * Kontrakten for `forvaltning_cutover_kontroll` (Issue #34). Input er kun
 * sammenligningsparametre — ingen stier, ingen familyId (den utledes alltid
 * fra koblingen, se `auth/authorize.ts`).
 */
import { z } from "zod";
import { ANTALL_BOTTER, FORSONINGSNODER } from "./cutoverKontroll";

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
