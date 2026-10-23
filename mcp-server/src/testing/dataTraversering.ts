/**
 * Testhjelper for full lesing: leser en hel node ved å følge `data_les`
 * sidedelingen (`neste`), gå ned i barn som er `forStor`, og sette sammen
 * lange tekster fra `tekstdel`. Resultatet sammenlignes med kildedataene,
 * så testene beviser at ingenting går tapt.
 */
interface Side {
  type: "mangler" | "verdi" | "tekstdel" | "node";
  verdi?: unknown;
  del?: string;
  nesteFraTegn?: number | null;
  barn?: { nokkel: string; verdi?: unknown; forStor?: unknown }[];
  neste?: string | null;
}

export type DataLes = (args: Record<string, unknown>) => Promise<Side>;

export async function lesAlt(les: DataLes, sti: string, valg: Record<string, unknown> = {}) {
  let side = await les({ ...valg, sti });
  if (side.type === "mangler") return undefined;
  if (side.type === "verdi") return side.verdi;
  if (side.type === "tekstdel") {
    let tekst = side.del!;
    while (side.nesteFraTegn !== null && side.nesteFraTegn !== undefined) {
      side = await les({ ...valg, sti, fraTegn: side.nesteFraTegn });
      tekst += side.del!;
    }
    return tekst;
  }
  const ut: Record<string, unknown> = {};
  for (;;) {
    for (const b of side.barn!) {
      ut[b.nokkel] = b.forStor
        ? await lesAlt(les, sti ? `${sti}/${b.nokkel}` : b.nokkel, valg)
        : b.verdi;
    }
    if (!side.neste) return ut;
    side = await les({ ...valg, sti, etter: side.neste });
  }
}

/**
 * Sammenligningsform: arrays (RTDB-ens visning av heltallsnøkler) blir
 * objekter med indeksnøkler, hull og `null` faller bort, nøkler sorteres.
 */
export function normaliser(v: unknown): unknown {
  if (Array.isArray(v)) {
    return normaliser(
      Object.fromEntries(
        v.flatMap((x, i) => (x === null || x === undefined ? [] : [[String(i), x]])),
      ),
    );
  }
  if (typeof v !== "object" || v === null) return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, normaliser((v as Record<string, unknown>)[k])]),
  );
}
