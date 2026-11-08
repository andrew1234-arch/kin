import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { kinHookAbi, kinLaunchFactoryAbi } from "../abi/kin";
import { chainFor } from "../sandbox/relayer";
import type { LaunchService } from "./service";
import { launchParams } from "../launchParams";
import { dataDir } from "../paths";

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

/**
 * factory.createLaunch. Allowlist launches commit the built root; the window opens after the dispute period.
 * Instant launches commit root 0 and the hash of their policy file; the window opens after `delayAfterBuildSec`
 * (at least the hook's minimum review period), and buyers get permits from the engine.
 */
export async function deployLaunch(svc: LaunchService, slug: string, c: Clients) {
  const rec = svc.get(slug);
  const instant = rec.mode === "instant";
  if (!instant && !rec.allowlist) throw new Error("build the allowlist first");
  if (rec.onchain) throw new Error("already deployed");
  let commit = rec.allowlist
    ? { root: rec.allowlist.root, evidenceHash: rec.allowlist.evidenceHash, stats: rec.allowlist.stats, version: rec.allowlist.version }
    : null;
  if (instant) {
    const signer = await c.pub.readContract({ address: c.hook, abi: kinHookAbi, functionName: "permitSigner" });
    const policy = svc.instantPolicyFor(rec);
    const want = (JSON.parse(policy.json) as { permitSigner: string }).permitSigner;
    if (signer.toLowerCase() !== want.toLowerCase()) {
      throw new Error(`this hook trusts permit signer ${signer}, but PERMIT_SIGNER_KEY is ${want}`);
    }
    svc.setInstantPolicy(slug, policy.json, policy.hash);
    const zero = `0x${"00".repeat(32)}` as Hex;
    commit = { root: zero, evidenceHash: policy.hash, stats: { allowlistedWallets: 0, entities: 0, linkedWallets: 0, freshWallets: 0 }, version: 0 };
  }
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
        ...launchParams(),
        root: commit!.root,
        evidenceHash: commit!.evidenceHash,
        stats: commit!.stats,
        windowStart,
        windowEnd: windowStart + BigInt(rec.window.lengthSec),
        lockDuration: BigInt(rec.window.lockSec),
        // Hashed, not padded: a padded string overflows bytes32 for slugs longer than 14 characters.
        salt: keccak256(toBytes(`kin:${slug}:${Date.now()}`)),
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
  const onchain = svc.attachOnchain(slug, {
    poolId: ev!.args.id as Hex,
    key: { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks },
    token: ev!.args.token,
    launchTx: hash,
    windowStart: Number(windowStart),
    windowEnd: Number(windowStart) + rec.window.lengthSec,
    lockDuration: rec.window.lockSec,
    rootVersion: commit!.version,
  }).onchain!;
  if (!instant) await publishMirror(svc, slug);
  return onchain;
}

/**
 * Write DATA_DIR/publish/<slug>.json: the public launch record plus every allowlist entry with its proof, for the
 * version that is onchain. Pin or host it anywhere static (IPFS, a bucket) and point the web app's
 * NEXT_PUBLIC_LAUNCH_MIRROR at it, so buyers can still get their proofs if this engine is down during the window.
 */
export async function publishMirror(svc: LaunchService, slug: string) {
  const dir = join(dataDir(), "publish");
  mkdirSync(dir, { recursive: true });
  const body = { schema: "kin-launch-mirror/1", launch: svc.publicView(svc.get(slug)), entries: await svc.entries(slug) };
  const path = join(dir, `${slug}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
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
  // A late root change pushes the window back (the hook keeps a minimum review period): record where it is now.
  const l = await c.pub.readContract({ address: c.hook, abi: kinHookAbi, functionName: "getLaunch", args: [rec.onchain.poolId] });
  svc.attachOnchain(slug, {
    ...rec.onchain,
    rootVersion: rec.allowlist.version,
    windowStart: Number(l.windowStart),
    windowEnd: Number(l.windowEnd),
  });
  await publishMirror(svc, slug);
  return hash;
}

/** Optional: emits the receipt event. The receipt is final at windowEnd without it. */
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
