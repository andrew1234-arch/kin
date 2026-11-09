import { getAddress, isAddress, parseEther, type Hex } from "viem";
import { envNum, envStr } from "../env";
import type { launchRuntime } from "../runtime";
import { adminClients, deployLaunch } from "./onchain";
import { LaunchError } from "./service";
import type { LaunchRecord } from "./store";

/**
 * Public launches (PUBLIC_LAUNCHES=1): anyone can create and deploy an instant launch from the site's launch form,
 * on the launch chain (Base Sepolia), with the gas paid by the launch admin key. Bounded so its test ETH lasts:
 *   PUBLIC_LAUNCHES_PER_DAY (20)   launches per UTC day, all callers
 *   PUBLIC_LAUNCHES_PER_IP (3)     launches per IP per 24 h
 *   PUBLIC_MAX_CAP_ETH (0.05)      highest limit per buyer a form launch may set
 * Window and lock must also fit the hook's limits (deployment file); the window opens after the hook's review period.
 */
type Runtime = ReturnType<typeof launchRuntime>;

export interface PublicLaunchInput {
  name?: unknown;
  symbol?: unknown;
  capEth?: unknown;
  windowMin?: unknown;
  lockMin?: unknown;
  creator?: unknown;
}

const byIp = new Map<string, number[]>();

export function publicLaunchesEnabled() {
  return envStr("PUBLIC_LAUNCHES") === "1" && !!envStr("LAUNCH_ADMIN_KEY") && !!envStr("LAUNCH_DEPLOYMENT") && !!envStr("LAUNCH_RPC_URL");
}

/** Validates the form, creates the launch record and deploys its pool. Returns the deployed record. */
export async function createPublicLaunch(rt: Runtime, input: PublicLaunchInput, ip: string): Promise<LaunchRecord> {
  if (!publicLaunchesEnabled()) throw new LaunchError("Launching from the site is turned off on this server", 503);
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  const symbol = String(input.symbol ?? "").trim().replace(/^\$/, "").toUpperCase();
  if (!/^[\p{L}\p{N} .'&!-]{2,32}$/u.test(name)) throw new LaunchError("Name: 2 to 32 letters, numbers or spaces");
  if (!/^[A-Z0-9]{2,8}$/.test(symbol)) throw new LaunchError("Symbol: 2 to 8 letters or numbers");
  let cap: bigint;
  try {
    cap = parseEther(String(input.capEth ?? "").trim());
  } catch {
    throw new LaunchError("Limit per buyer: enter an amount in ETH, such as 0.001");
  }
  const maxCap = parseEther(envStr("PUBLIC_MAX_CAP_ETH") ?? "0.05");
  if (cap < parseEther("0.0001") || cap > maxCap) throw new LaunchError(`Limit per buyer: between 0.0001 and ${envStr("PUBLIC_MAX_CAP_ETH") ?? "0.05"} ETH`);

  const c = adminClients({
    rpcUrl: rt.rpcUrl!,
    chainId: rt.chainId,
    adminKey: envStr("LAUNCH_ADMIN_KEY") as Hex,
    deploymentPath: envStr("LAUNCH_DEPLOYMENT")!,
  });
  const windowMin = Math.round(Number(input.windowMin));
  const lockMin = Math.round(Number(input.lockMin));
  const minW = Math.ceil((c.limits?.minWindow ?? 300) / 60);
  const maxW = Math.floor((c.limits?.maxWindow ?? 86_400) / 60);
  const maxL = Math.floor((c.limits?.maxLock ?? 604_800) / 60);
  if (!Number.isFinite(windowMin) || windowMin < minW || windowMin > maxW) throw new LaunchError(`Buying window: ${minW} to ${maxW} minutes`);
  if (!Number.isFinite(lockMin) || lockMin < 0 || lockMin > maxL) throw new LaunchError(`Lock: 0 to ${maxL} minutes`);
  const creatorIn = String(input.creator ?? "");
  const creator = creatorIn && isAddress(creatorIn) ? getAddress(creatorIn) : undefined;

  // Rate limits: per IP, then the daily total.
  const now = Math.floor(Date.now() / 1000);
  const mine = (byIp.get(ip) ?? []).filter((t) => t > now - 86_400);
  if (mine.length >= envNum("PUBLIC_LAUNCHES_PER_IP", 3, { min: 1, integer: true })) {
    throw new LaunchError("You've made the most launches allowed per day from this connection. Try again tomorrow.", 429);
  }
  const dayStart = now - (now % 86_400);
  const today = rt.store.list().filter((r) => r.public && r.createdAt >= dayStart).length;
  if (today >= envNum("PUBLIC_LAUNCHES_PER_DAY", 20, { min: 0, integer: true })) {
    throw new LaunchError("Today's launches are used up. Try again after 00:00 UTC.", 429);
  }
  mine.push(now);
  byIp.set(ip, mine);

  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || symbol.toLowerCase();
  let slug = base;
  while (rt.store.get(slug)) slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  rt.service.create({
    slug,
    chainId: rt.chainId,
    name,
    symbol,
    mode: "instant",
    public: true,
    ...(creator ? { creator } : {}),
    registrationClosesAt: now,
    tiers: {
      capWei: cap.toString(),
      freshPoolCapWei: cap.toString(),
      verifiedCapWei: cap.toString(),
      freshMaxNonce: 0,
      freshMaxAgeHours: 168,
    },
    // deployLaunch raises the delay to the hook's review period (+2 min).
    window: { delayAfterBuildSec: 0, lengthSec: windowMin * 60, lockSec: lockMin * 60 },
  });
  try {
    await deployLaunch(rt.service, slug, c);
  } catch (e) {
    // Keep nothing half-made: a record without a pool would show as a launch that never opens.
    rt.store.remove(slug);
    byIp.set(ip, mine.slice(0, -1));
    throw new LaunchError(`The launch could not be deployed: ${(e as Error).message.split("\n")[0]}`, 502);
  }
  return rt.service.get(slug);
}
