/**
 * Redigering av én Spillerom-post (#59, samtidighet, ordre 6675906923).
 * Bare feltene brukeren faktisk endret sendes, sammen med verdiene de hadde
 * da redigeringen startet (`grunnlag`). Datalaget skriver da bare disse
 * feltene, og avviser lagringen hvis et av dem er endret på serveren i
 * mellomtiden. Felt brukeren ikke rørte, kan dermed aldri overskrives av et
 * gammelt skjema.
 */
import type { LiquidityPost } from "@app-types/liquidity";

export type RedigerbareFelt = Pick<
  LiquidityPost,
  "name" | "amount" | "date" | "direction" | "type"
>;

export function endredeFelt(
  start: RedigerbareFelt,
  skjema: RedigerbareFelt,
): { patch: Partial<LiquidityPost>; grunnlag: Partial<LiquidityPost> } {
  const patch: Partial<LiquidityPost> = {};
  const grunnlag: Partial<LiquidityPost> = {};
  (Object.keys(start) as (keyof RedigerbareFelt)[]).forEach((k) => {
    if (start[k] !== skjema[k]) {
      (patch as Record<string, unknown>)[k] = skjema[k];
      (grunnlag as Record<string, unknown>)[k] = start[k];
    }
  });
  return { patch, grunnlag };
}
