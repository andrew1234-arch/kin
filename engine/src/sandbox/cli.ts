/** Run one sandbox attack from the command line and print the result. Env: see sandbox/config.ts. */
import { sandboxConfigFromEnv } from "./config";
import { runSandbox } from "./relayer";

const cfg = sandboxConfigFromEnv();
const result = await runSandbox(cfg, (e) => {
  if (e.type === "step") console.log(`[${e.step}] ${e.detail}`);
  if (e.type === "attempt" && e.status !== "pending") console.log(`  ${e.pool.padEnd(5)} #${e.index} ${e.status}`);
});
console.log(JSON.stringify(result, null, 2));
console.log(
  `Kin pool: ${result.kin.landed}/${result.bundleSize} landed (cap allows ${result.expectedKinMax}); ` +
    `plain pool: ${result.plain.landed}/${result.bundleSize}. Rejection reason: ${result.kin.rejectReason}. ` +
    `${(result.elapsedMs / 1000).toFixed(1)}s`,
);
// Give the background sweep a moment before exiting.
await new Promise((r) => setTimeout(r, 3000));
process.exit(0);
