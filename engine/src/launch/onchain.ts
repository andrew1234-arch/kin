import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { kinHookAbi, kinLaunchFactoryAbi } from "../abi/kin";
import { chainFor } from "../sandbox/relayer";
import type { LaunchService } from "./service";

/** Launch-side onchain actions, shared by the admin CLI and the local seeding script. */
export function adminClients(opts: { rpcUrl: string; chainId: number; adminKey: Hex; deploymentPath: string }) {
  const dep = JSON.parse(readFileSync(opts.deploymentPath, "utf8"));
  const chain = chainFor(opts.chainId, opts.rpcUrl);
  return {
    pub: createPublicClient({ chain, transport: http(opts.rpcUrl) }) as PublicClient,
    wallet: createWalletClient({ chain, transport: http(opts.rpcUrl), account: privateKeyToAccount(opts.adminKey) }),
    factory: getAddress(dep.factory) as Address,
    hook: getAddress(dep.kinHook) as Address,
  };
}
type Clients = ReturnType<typeof adminClients>;

/** factory.createLaunch with the built root; the window opens after the dispute period. */
export async function deployLaunch(svc: LaunchService, slug: string, c: Clients) {
  const rec = svc.get(slug);
  if (!rec.allowlist) throw new Error("build the allowlist first");
  if (rec.onchain) throw new Error("already deployed");
  const head = await c.pub.getBlock();
  const windowStart = head.timestamp + BigInt(rec.window.delayAfterBuildSec);
  const hash = await c.wallet.writeContract({
    address: c.factory,
    abi: kinLaunchFactoryAbi,
    functionName: "createLaunch",
    args: [
      {
        name: rec.name,
        symbol: rec.symbol,
        totalSupply: 1_000_000_000n * 10n ** 18n,
        creatorAllocation: 0n,
        fee: 10_000,
        tickSpacing: 200,
        startTick: 184_200,
        tickLower: 69_000,
        root: rec.allowlist.root,
        evidenceHash: rec.allowlist.evidenceHash,
        stats: rec.allowlist.stats,
        windowStart,
        windowEnd: windowStart + BigInt(rec.window.lengthSec),
        lockDuration: BigInt(rec.window.lockSec),
        salt: toHex(`kin:${slug}:${Date.now()}`, { size: 32 }),
      },
      false,
    ],
    chain: c.wallet.chain,
    account: c.wallet.account,
  });
  const rcpt = await c.pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`createLaunch reverted: ${hash}`);
  const [ev] = parseEventLogs({ abi: kinLaunchFactoryAbi, logs: rcpt.logs, eventName: "LaunchCreated" });
  const k = ev!.args.key;
  return svc.attachOnchain(slug, {
    poolId: ev!.args.id as Hex,
    key: { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks },
    token: ev!.args.token,
    launchTx: hash,
    windowStart: Number(windowStart),
    windowEnd: Number(windowStart) + rec.window.lengthSec,
    lockDuration: rec.window.lockSec,
    rootVersion: rec.allowlist.version,
  }).onchain!;
}

export async function updateRoot(svc: LaunchService, slug: string, c: Clients) {
  const rec = svc.get(slug);
  if (!rec.onchain || !rec.allowlist) throw new Error("not deployed");
  if (rec.allowlist.version === rec.onchain.rootVersion) throw new Error("onchain root is already the latest version");
  const hash = await c.wallet.writeContract({
    address: c.hook,
    abi: kinHookAbi,
    functionName: "updateAllowlist",
    args: [rec.onchain.poolId, rec.allowlist.root, rec.allowlist.evidenceHash, rec.allowlist.stats],
    chain: c.wallet.chain,
    account: c.wallet.account,
  });
  const rcpt = await c.pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`updateAllowlist reverted: ${hash}`);
  svc.attachOnchain(slug, { ...rec.onchain, rootVersion: rec.allowlist.version });
  return hash;
}

export async function finalizeLaunch(svc: LaunchService, slug: string, c: Clients) {
  const rec = svc.get(slug);
  if (!rec.onchain) throw new Error("not deployed");
  const hash = await c.wallet.writeContract({
    address: c.hook,
    abi: kinHookAbi,
    functionName: "finalize",
    args: [rec.onchain.poolId],
    chain: c.wallet.chain,
    account: c.wallet.account,
  });
  const rcpt = await c.pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`finalize reverted: ${hash}`);
  return hash;
}
