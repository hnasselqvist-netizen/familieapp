import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Tynn Playwright-globalSetup som delegerer selve seedingen til en ren
 * node-prosess (§seed.mjs) — se kommentaren der for hvorfor.
 */
export default function globalSetup() {
  execFileSync(process.execPath, [path.join(import.meta.dirname, "seed.mjs")], {
    stdio: "inherit",
  });
}
