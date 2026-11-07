import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  formatEther,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { kinHookAbi, kinLaunchFactoryAbi, kinRouterAbi, kinVaultAbi } from "../abi/kin";
import { buildAllowlist } from "../allowlist/build";
import { CLUSTER_METHOD, clusterByFunding } from "../cluster/cluster";
import { registrationMessage } from "../launch/registration";
import type { FundingEdge, WalletProfile } from "../types";

/**
 * Attack sandbox: one funder funds N fresh wallets; all N register for a demo Kin launch; the engine
 * clusters them from the real funding transactions; then every wallet tries to buy in the window, on
 * the Kin pool and on a plain (hookless) pool with the same parameters. Every step is an onchain
 * transaction with a hash. Unused ETH is swept back to the relayer at the end.
 */
export interface SandboxConfig {
  rpcUrl: string;
  chainId: number;
  relayerKey: Hex;
  deployment: { kinRouter: Address; kinHook: Address; kinVault: Address; factory: Address };
  bundleSize: number;
  perWalletWei: bigint;
  /** The linked entity's cap = capBuys × perWalletWei. */
  capBuys: number;
  windowDelaySec: number;
  windowLengthSec: number;
  lockSec: number;
  explorerUrl: string | null;
}

export type SandboxEvent =
  | { type: "step"; step: string; detail: string; txs?: Hex[] }
  | { type: "attempt"; pool: "kin" | "plain"; index: number; wallet: Address; tx: Hex; status: "pending" | "landed" | "rejected" }
  | { type: "result"; result: SandboxResult }
  | { type: "error"; message: string };

export interface SandboxResult {
  chainId: number;
  explorerUrl: string | null;
  bundleSize: number;
  perWalletWei: string;
  entityCapWei: string;
  expectedKinMax: number;
  kin: { landed: number; rejected: number; poolId: Hex; token: Address; launchTx: Hex; rejectReason: string | null };
  plain: { landed: number; rejected: number; poolId: Hex; token: Address; launchTx: Hex };
  funder: Address;
  fundingTxs: Hex[];
  root: Hex;
  evidenceHash: Hex;
  entitySpentWei: string;
  vaultedTokens: string;
  elapsedMs: number;
}

const BUY_GAS = 600_000n;
/** v4-core CustomRevert.WrappedError: how PoolManager surfaces a hook's revert. */
export const V4_WRAPPED_ERROR = parseAbi(["error WrappedError(address target, bytes4 selector, bytes reason, bytes details)"]);
const TRANSFER_GAS = 21_000n;

export function chainFor(chainId: number, rpcUrl: string): Chain {
  return defineChain({
    id: chainId,
    name: chainId === 84532 ? "Base Sepolia" : chainId === 31337 ? "Anvil" : `chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export async function runSandbox(cfg: SandboxConfig, emit: (e: SandboxEvent) => void): Promise<SandboxResult> {
  const t0 = Date.now();
  const chain = chainFor(cfg.chainId, cfg.rpcUrl);
  const transport = http(cfg.rpcUrl);
  const pub = createPublicClient({ chain, transport }) as PublicClient;
  const relayer = createWalletClient({ chain, transport, account: privateKeyToAccount(cfg.relayerKey) });

  // ---- 1. Wallets and gas budget
  const funderKey = generatePrivateKey();
  const funder = createWalletClient({ chain, transport, account: privateKeyToAccount(funderKey) });
  const walletKeys = Array.from({ length: cfg.bundleSize }, () => generatePrivateKey());
  const wallets = walletKeys.map((k) => createWalletClient({ chain, transport, account: privateKeyToAccount(k) }));
  const fees = await pub.estimateFeesPerGas();
  const maxFee = fees.maxFeePerGas ?? (await pub.getGasPrice());
  const perWalletBudget = 2n * cfg.perWalletWei + (2n * BUY_GAS + TRANSFER_GAS) * maxFee * 2n;
  const funderBudget = perWalletBudget * BigInt(cfg.bundleSize) + TRANSFER_GAS * maxFee * BigInt(cfg.bundleSize + 2) * 2n;
  const relayerBal = await pub.getBalance({ address: relayer.account.address });
  const launchBudget = 20_000_000n * maxFee; // two createLaunch calls, generous
  if (relayerBal < funderBudget + launchBudget) {
    throw new Error(
      `relayer balance ${formatEther(relayerBal)} ETH is below this run's budget ${formatEther(funderBudget + launchBudget)} ETH`,
    );
  }
  emit({ type: "step", step: "wallets", detail: `1 funder and ${cfg.bundleSize} fresh wallets generated` });

  // ---- 2. Funding: relayer -> funder -> N wallets
  const fundFunder = await relayer.sendTransaction({ to: funder.account.address, value: funderBudget });
  const fundFunderRcpt = await pub.waitForTransactionReceipt({ hash: fundFunder });
  let nonce = await pub.getTransactionCount({ address: funder.account.address, blockTag: "pending" });
  const fundingTxs: Hex[] = [];
  for (const w of wallets) {
    fundingTxs.push(
      await funder.sendTransaction({ to: w.account.address, value: perWalletBudget, nonce: nonce++, gas: TRANSFER_GAS }),
    );
  }
  const fundingRcpts = await Promise.all(fundingTxs.map((hash) => pub.waitForTransactionReceipt({ hash })));
  emit({ type: "step", step: "funded", detail: `one funder sent ETH to ${cfg.bundleSize} wallets`, txs: [fundFunder, ...fundingTxs] });

  // ---- 3. Registration: every wallet signs the registration message
  const launchSlug = `sandbox-${Date.now()}`;
  for (const w of wallets) {
    const message = registrationMessage(launchSlug, w.account.address, cfg.chainId);
    const signature = await w.account.signMessage({ message });
    const ok = await pub.verifyMessage({ address: w.account.address, message, signature });
    if (!ok) throw new Error("registration signature did not verify");
  }
  emit({ type: "step", step: "registered", detail: `${cfg.bundleSize} wallets registered with signed messages` });

  // ---- 4. Clustering from the real funding transactions, then the allowlist
  const blockTs = new Map<bigint, number>();
  const tsOf = async (bn: bigint) => {
    if (!blockTs.has(bn)) blockTs.set(bn, Number((await pub.getBlock({ blockNumber: bn })).timestamp));
    return blockTs.get(bn)!;
  };
  const edges: FundingEdge[] = [];
  for (let i = 0; i < wallets.length; i++) {
    const r = fundingRcpts[i]!;
    edges.push({
      from: funder.account.address,
      to: wallets[i]!.account.address,
      txHash: r.transactionHash,
      blockNumber: r.blockNumber,
      timestamp: await tsOf(r.blockNumber),
      value: perWalletBudget,
      hop: 1,
    });
  }
  edges.push({
    from: relayer.account.address,
    to: funder.account.address,
    txHash: fundFunderRcpt.transactionHash,
    blockNumber: fundFunderRcpt.blockNumber,
    timestamp: await tsOf(fundFunderRcpt.blockNumber),
    value: funderBudget,
    hop: 2,
  });
  const addrs = wallets.map((w) => w.account.address);
  const clusters = clusterByFunding(addrs, edges, { maxHops: 2, excluded: new Set() });
  const profiles: WalletProfile[] = addrs.map((wallet) => ({ wallet, nonce: 0 }));
  const capWei = cfg.perWalletWei * BigInt(cfg.capBuys);
  const allowlist = buildAllowlist({
    launch: { chainId: cfg.chainId, launchId: launchSlug, snapshotBlock: fundingRcpts.at(-1)!.blockNumber.toString() },
    tiers: { capWei, freshPoolCapWei: capWei, verifiedCapWei: capWei, freshMaxNonce: 0 },
    wallets: profiles,
    clusters,
    method: { heuristic: CLUSTER_METHOD, maxHops: 2, source: "funding transactions observed by the sandbox relayer" },
  });
  emit({
    type: "step",
    step: "clustered",
    detail: `engine grouped ${allowlist.stats.linkedWallets} wallets into ${clusters.length} entity with one ${formatEther(capWei)} ETH cap`,
  });

  // ---- 5. Two launches: Kin (hooked) and plain (no hook), same parameters
  const latest = await pub.getBlock();
  const windowStart = latest.timestamp + BigInt(cfg.windowDelaySec);
  const base = {
    totalSupply: 1_000_000_000n * 10n ** 18n,
    creatorAllocation: 0n,
    fee: 10_000,
    tickSpacing: 200,
    startTick: 184_200,
    tickLower: 69_000,
    root: allowlist.root,
    evidenceHash: allowlist.evidenceHash,
    stats: allowlist.stats,
    windowStart,
    windowEnd: windowStart + BigInt(cfg.windowLengthSec),
    lockDuration: BigInt(cfg.lockSec),
  };
  const launch = async (plain: boolean) => {
    const hash = await relayer.writeContract({
      address: cfg.deployment.factory,
      abi: kinLaunchFactoryAbi,
      functionName: "createLaunch",
      args: [
        { ...base, name: plain ? "Plain Sandbox" : "Kin Sandbox", symbol: plain ? "PLAIN" : "KINSBX", salt: generatePrivateKey() },
        plain,
      ],
      gas: 8_000_000n,
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`createLaunch reverted (${hash})`);
    const [ev] = parseEventLogs({ abi: kinLaunchFactoryAbi, logs: rcpt.logs, eventName: "LaunchCreated" });
    return { hash, id: ev!.args.id as Hex, token: ev!.args.token as Address, key: ev!.args.key };
  };
  const kin = await launch(false);
  const plain = await launch(true);
  emit({ type: "step", step: "launched", detail: "Kin pool and plain pool created", txs: [kin.hash, plain.hash] });

  // ---- 6. Wait for the window
  for (;;) {
    const b = await pub.getBlock();
    if (b.timestamp >= windowStart) break;
    if (cfg.chainId === 31337) {
      await new Promise((r) => setTimeout(r, 1000));
      await pub.request({ method: "evm_mine" as never, params: [] as never });
    } else {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  emit({ type: "step", step: "window", detail: "launch window is open" });

  // ---- 7. The attack: every wallet buys on both pools
  const entry = (w: Address) => allowlist.entries.find((e) => e.wallet.toLowerCase() === w.toLowerCase())!;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sends: { pool: "kin" | "plain"; index: number; wallet: Address; tx: Hex }[] = [];
  await Promise.all(
    wallets.map(async (w, index) => {
      const e = entry(w.account.address);
      const allowance = { entityId: e.entityId, entityCap: BigInt(e.cap), proof: e.proof };
      for (const [pool, key, n] of [["kin", kin.key, 0], ["plain", plain.key, 1]] as const) {
        const tx = await w.writeContract({
          address: cfg.deployment.kinRouter,
          abi: kinRouterAbi,
          functionName: "swapExactIn",
          args: [key, true, cfg.perWalletWei, 0n, allowance, deadline],
          value: cfg.perWalletWei,
          gas: BUY_GAS,
          nonce: n,
        });
        sends.push({ pool, index, wallet: w.account.address, tx });
        emit({ type: "attempt", pool, index, wallet: w.account.address, tx, status: "pending" });
      }
    }),
  );
  const outcomes = await Promise.all(
    sends.map(async (s) => {
      const r = await pub.waitForTransactionReceipt({ hash: s.tx });
      const status = r.status === "success" ? ("landed" as const) : ("rejected" as const);
      emit({ type: "attempt", ...s, status });
      return { ...s, status };
    }),
  );

  // Exact revert reason for one more Kin buy, simulated (not sent).
  let rejectReason: string | null = null;
  try {
    const e = entry(wallets[0]!.account.address);
    await pub.simulateContract({
      account: wallets[0]!.account,
      address: cfg.deployment.kinRouter,
      abi: [...kinRouterAbi, ...kinHookAbi, ...V4_WRAPPED_ERROR],
      functionName: "swapExactIn",
      args: [kin.key, true, cfg.perWalletWei, 0n, { entityId: e.entityId, entityCap: BigInt(e.cap), proof: e.proof }, deadline],
      value: cfg.perWalletWei,
    });
  } catch (err) {
    rejectReason = extractReason(err);
  }

  const count = (pool: "kin" | "plain", st: "landed" | "rejected") =>
    outcomes.filter((o) => o.pool === pool && o.status === st).length;
  const entityId = entry(wallets[0]!.account.address).entityId;
  const entitySpent = (await pub.readContract({
    address: cfg.deployment.kinHook,
    abi: kinHookAbi,
    functionName: "entitySpent",
    args: [kin.id, entityId],
  })) as bigint;
  const vaulted = (await pub.readContract({
    address: cfg.deployment.kinVault,
    abi: kinVaultAbi,
    functionName: "totalOwed",
    args: [kin.id],
  })) as bigint;

  const result: SandboxResult = {
    chainId: cfg.chainId,
    explorerUrl: cfg.explorerUrl,
    bundleSize: cfg.bundleSize,
    perWalletWei: cfg.perWalletWei.toString(),
    entityCapWei: capWei.toString(),
    expectedKinMax: cfg.capBuys,
    kin: { landed: count("kin", "landed"), rejected: count("kin", "rejected"), poolId: kin.id, token: kin.token, launchTx: kin.hash, rejectReason },
    plain: { landed: count("plain", "landed"), rejected: count("plain", "rejected"), poolId: plain.id, token: plain.token, launchTx: plain.hash },
    funder: funder.account.address,
    fundingTxs,
    root: allowlist.root,
    evidenceHash: allowlist.evidenceHash,
    entitySpentWei: entitySpent.toString(),
    vaultedTokens: vaulted.toString(),
    elapsedMs: Date.now() - t0,
  };
  emit({ type: "result", result });

  // ---- 8. Sweep leftover ETH back to the relayer (best effort, after the result is out)
  void sweep(pub, [funderKey, ...walletKeys], chain, cfg.rpcUrl, relayer.account.address, maxFee);
  return result;
}

async function sweep(pub: PublicClient, keys: Hex[], chain: Chain, rpcUrl: string, to: Address, maxFee: bigint) {
  await Promise.allSettled(
    keys.map(async (k) => {
      const w = createWalletClient({ chain, transport: http(rpcUrl), account: privateKeyToAccount(k) });
      const bal = await pub.getBalance({ address: w.account.address });
      const cost = TRANSFER_GAS * maxFee;
      if (bal <= cost * 2n) return;
      await w.sendTransaction({ to, value: bal - cost, gas: TRANSFER_GAS, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxFee / 10n || 1n });
    }),
  );
}

function extractReason(err: unknown): string {
  const e = err as { cause?: { data?: { errorName?: string; args?: readonly unknown[] } }; shortMessage?: string };
  const data = e.cause?.data;
  if (data?.errorName === "WrappedError" && typeof data.args?.[2] === "string") {
    try {
      const inner = decodeErrorResult({ abi: kinHookAbi, data: data.args[2] as Hex });
      return inner.errorName + (inner.args?.length ? `(${inner.args.map(String).join(", ")})` : "");
    } catch {
      return (data.args[2] as string).slice(0, 10);
    }
  }
  return data?.errorName ?? e.shortMessage ?? "reverted";
}
