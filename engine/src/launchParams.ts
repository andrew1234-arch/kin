import { readFileSync } from "node:fs";
import { envStr } from "./env";

/**
 * Launch economics (supply, fee, ticks), shared with the forge scripts through contracts/launch-params.json so
 * the launch backend, the sandbox and Gate B always deploy the same curve. KIN_LAUNCH_PARAMS overrides the path.
 */
export function launchParams() {
  const path = envStr("KIN_LAUNCH_PARAMS") ?? new URL("../../contracts/launch-params.json", import.meta.url).pathname;
  const j = JSON.parse(readFileSync(path, "utf8"));
  return {
    totalSupply: BigInt(j.totalSupply),
    creatorAllocation: BigInt(j.creatorAllocation),
    fee: Number(j.fee),
    tickSpacing: Number(j.tickSpacing),
    startTick: Number(j.startTick),
    tickLower: Number(j.tickLower),
  };
}
