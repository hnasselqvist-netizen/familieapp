/**
 * Konfigurasjon for vedleggstjenesten (#59, B1). Som MCP-serveren nekter
 * den å starte mot ekte data uten eksplisitt beslutning, og produksjons-
 * aktiveringen er AV i denne leveransen.
 *
 * | Variabel                              | Påkrevd | Merknad                                     |
 * |---------------------------------------|---------|---------------------------------------------|
 * | `FIREBASE_DATABASE_URL`               | ja      | RTDB for medlemskapssjekk (kun lesing)      |
 * | `FIREBASE_DATABASE_EMULATOR_HOST`     | —       | settes for emulator                         |
 * | `FIREBASE_AUTH_EMULATOR_HOST`         | —       | settes for emulator                         |
 * | `VEDLEGG_LAGER`                       | nei     | `minne` (standard) eller `gcs`              |
 * | `VEDLEGG_BUCKET`                      | ved gcs | bøttenavn                                   |
 * | `VEDLEGG_MAKS_BYTES`                  | nei     | standard 10 MiB                             |
 * | `VEDLEGG_ALLOW_PRODUCTION`            | nei     | må være `true` for ekte RTDB/Auth/bøtte     |
 * | `PORT`                                | nei     | standard 8080                               |
 */
import { STANDARD_MAKS_BYTES } from "./kjerne";

export interface VedleggConfig {
  databaseUrl: string;
  usesEmulator: boolean;
  lager: "minne" | "gcs";
  bucket?: string;
  maksBytes: number;
  port: number;
}

export class VedleggConfigFeil extends Error {
  constructor(m: string) {
    super(m);
    this.name = "VedleggConfigFeil";
  }
}

export function lastVedleggConfig(env: NodeJS.ProcessEnv = process.env): VedleggConfig {
  const databaseUrl = env.FIREBASE_DATABASE_URL;
  if (!databaseUrl) throw new VedleggConfigFeil("Mangler FIREBASE_DATABASE_URL.");
  const usesEmulator =
    Boolean(env.FIREBASE_DATABASE_EMULATOR_HOST) && Boolean(env.FIREBASE_AUTH_EMULATOR_HOST);
  if (!usesEmulator && env.VEDLEGG_ALLOW_PRODUCTION !== "true") {
    throw new VedleggConfigFeil(
      "Nekter å koble til ekte Firebase: sett emulatorvariablene (RTDB og Auth), " +
        "eller VEDLEGG_ALLOW_PRODUCTION=true etter eksplisitt beslutning.",
    );
  }
  const lager = (env.VEDLEGG_LAGER ?? "minne") as VedleggConfig["lager"];
  if (lager !== "minne" && lager !== "gcs") {
    throw new VedleggConfigFeil("VEDLEGG_LAGER må være «minne» eller «gcs».");
  }
  if (lager === "gcs" && !env.VEDLEGG_BUCKET) {
    throw new VedleggConfigFeil("VEDLEGG_BUCKET må settes når VEDLEGG_LAGER=gcs.");
  }
  if (lager === "minne" && !usesEmulator) {
    throw new VedleggConfigFeil("Minnelager er bare for emulator/test.");
  }
  const maksBytes = env.VEDLEGG_MAKS_BYTES ? Number(env.VEDLEGG_MAKS_BYTES) : STANDARD_MAKS_BYTES;
  if (!Number.isInteger(maksBytes) || maksBytes <= 0) {
    throw new VedleggConfigFeil("VEDLEGG_MAKS_BYTES må være et positivt heltall.");
  }
  return {
    databaseUrl,
    usesEmulator,
    lager,
    bucket: env.VEDLEGG_BUCKET,
    maksBytes,
    port: env.PORT ? Number(env.PORT) : 8080,
  };
}
