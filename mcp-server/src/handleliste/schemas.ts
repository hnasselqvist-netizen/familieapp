/**
 * Typed verktøykontrakt for Handleliste-skiven — godkjent i Issue #27
 * (5936936743 §2, 5937138669 pkt. 2). Grensene her er en del av
 * kontrakten: de holder én forespørsel liten nok til å være lesbar i
 * ChatGPTs egen bekreftelses-UI og i audit-recorden.
 */
import { SHOP_CATS } from "@domain/shared/constants";
import { z } from "zod";

/** Ingen kontrolltegn (linjeskift, NUL osv.) i noe som havner i Firebase. */
const noControlChars = (s: string) => !/\p{Cc}/u.test(s);

const shopCategory = z.enum(SHOP_CATS);

export const LIMITS = {
  queryMax: 60,
  searchLimitMax: 10,
  searchLimitDefault: 5,
  nameMax: 80,
  amountMax: 20,
  itemsMax: 20,
} as const;

// ── shopping_list_get ───────────────────────────────────────────────
export const shoppingListGetInput = {
  includeDone: z
    .boolean()
    .optional()
    .describe("Ta med varer som allerede er krysset av. Standard: false."),
};

const listEntryView = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.string(),
  cat: z.string(),
  done: z.boolean(),
});

export const shoppingListOutput = {
  items: z.array(listEntryView),
  pendingCount: z.number().int(),
  doneCount: z.number().int(),
};

// ── items_search ────────────────────────────────────────────────────
export const itemsSearchInput = {
  query: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.queryMax)
    .refine(noControlChars, "Ugyldige tegn")
    .describe("Del av et varenavn, f.eks. «melk»."),
  limit: z.number().int().min(1).max(LIMITS.searchLimitMax).optional(),
};

export const itemsSearchOutput = {
  items: z.array(z.object({ id: z.string(), name: z.string(), cat: z.string() })),
};

// ── shopping_list_add_items ─────────────────────────────────────────
export const addItemInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.nameMax)
    .refine(noControlChars, "Ugyldige tegn")
    .describe("Varenavn, f.eks. «Melk»."),
  amount: z
    .string()
    .trim()
    .max(LIMITS.amountMax)
    .refine(noControlChars, "Ugyldige tegn")
    .optional()
    .describe(
      "Mengde som fritekst, f.eks. «2» eller «1 l». Tallmengder summeres med en eksisterende post.",
    ),
  cat: shopCategory
    .optional()
    .describe("Kategori for en NY vare. Ignoreres når varen allerede finnes i varebasen."),
});

export type AddItemInput = z.infer<typeof addItemInput>;

export const shoppingListAddItemsInput = {
  requestId: z
    .uuid()
    .describe(
      "Ny UUID per brukerforespørsel. Gjenbruk SAMME requestId ved retry av samme forespørsel — da utføres den aldri to ganger.",
    ),
  items: z.array(addItemInput).min(1).max(LIMITS.itemsMax),
};

const addItemOutcomeView = z.object({
  inputName: z.string(),
  outcome: z.enum(["added", "merged", "already_on_list"]),
  entryId: z.string(),
  itemId: z.string(),
  name: z.string(),
  amount: z.string(),
  previousAmount: z.string().optional(),
  cat: z.string(),
  newItemCreated: z.boolean(),
});

export const shoppingListAddItemsOutput = {
  requestId: z.string(),
  replayed: z.boolean(),
  results: z.array(addItemOutcomeView),
  /** Tilbakelest liste etter handlingen; `null` hvis tilbakelesingen feilet (handlingen er uansett utført). */
  list: z.object(shoppingListOutput).nullable(),
};
