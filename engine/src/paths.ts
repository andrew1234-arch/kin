import { join } from "node:path";
import { envStr } from "./env";

/** Where launch state, sandbox runs, the scan cache and replay reports live. */
export function dataDir(): string {
  return envStr("DATA_DIR") ?? join(import.meta.dir, "../data/runtime");
}
