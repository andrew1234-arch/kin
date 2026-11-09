import { chainTransport } from "../data/transport";
import { withAdminLock } from "../adminLock";
import { launchParams } from "../launchParams";
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  formatEther,
  parseAbi,
  parseEventLogs,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { kinHookAbi, kinLaunchFactoryAbi, kinRouterAbi, kinVaultAbi } from "../abi/kin";
import { CLUSTER_METHOD } from "../cluster/cluster";
import { assignInstant, instantPolicy, signPermit, type PermitAssignment } from "../launch/instant";
import type { FundingEdge } from "../types";

/**
 * Attack sandbox: one funder funds N new wallets, then every wallet tries to buy in a Kin launch and in a plain
 * (hookless) launch with the same parameters. The Kin launch runs on the same instant rules as every Kin launch: no
 * registration; each wallet's funding is traced when it buys, it is assigned an entity, and it gets a permit the hook
 * checks in the swap. Every step is an onchain transaction with a hash. Unused ETH is swept back to the relayer.
 */
export interface SandboxConfig {
  rpcUrl: string;
  chainId: number;
  relayerKey: Hex;
  /** `plainFactory` is the sandbox-only hookless factory: the Kin factory cannot create plain pools. */
  deployment: { kinRouter: Address; kinHook: Address; kinVault: Address; factory: Address; plainFactory: Address };
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
  /** Always zero: the sandbox runs instant launches (permits, not an allowlist). Kept for older clients. */
  root: Hex;
  /** keccak256 of the launch's instant policy file, committed onchain. */
  evidenceHash: Hex;
  mode: "instant";
  entities: number;
  linkedWallets: number;
  entitySpentWei: string;
  vaultedTokens: string;
  elapsedMs: number;
}

const BUY_GAS = 600_000n;
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
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
  const transport = chainTransport(cfg.rpcUrl, cfg.chainId);
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
  emit({ type: "step", step: "wallets", detail: `1 funder and ${cfg.bundleSize} new wallets generated` });

  // ---- 2. Funding: relayer -> funder -> N wallets
  const { fundFunder, fundFunderRcpt } = await withAdminLock(async () => {
    const fundFunder = await relayer.sendTransaction({ to: funder.account.address, value: funderBudget });
    return { fundFunder, fundFunderRcpt: await pub.waitForTransactionReceipt({ hash: fundFunder }) };
  });
  let nonce = await pub.getTransactionCount({ address: funder.account.address, blockTag: "pending" });
  const fundingTxs: Hex[] = [];
  for (const w of wallets) {
    fundingTxs.push(
      await funder.sendTransaction({ to: w.account.address, value: perWalletBudget, nonce: nonce++, gas: TRANSFER_GAS }),
    );
  }
  const fundingRcpts = await Promise.all(fundingTxs.map((hash) => pub.waitForTransactionReceipt({ hash })));
  emit({ type: "step", step: "funded", detail: `one funder sent ETH to ${cfg.bundleSize} wallets`, txs: [fundFunder, ...fundingTxs] });

  // ---- 3. Limits at buy time: trace each wallet's funding (the transfers above), assign entities, as in a live launch
  const launchSlug = `sandbox-${Date.now()}`;
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
  const capWei = cfg.perWalletWei * BigInt(cfg.capBuys);
  // No fresh tier in the sandbox's own launch (freshMaxNonce -1): every wallet here is new, so the funding link
  // alone decides, which is the thing the sandbox exists to show.
  const tiers = { capWei, freshPoolCapWei: capWei, freshMaxNonce: -1, freshMaxAgeHours: 0 };
  const now = Math.floor(Date.now() / 1000);
  const assigned: PermitAssignment[] = [];
  for (const w of wallets) {
    const a = assignInstant(launchSlug, assigned, { wallet: w.account.address, nonce: 0, edges }, tiers, now, new Set());
    assigned.push({ wallet: w.account.address, ...a, at: now, nonce: 0 });
  }
  const entityIds = new Set(assigned.map((a) => a.entityId));
  const linkedWallets = assigned.filter((a) => assigned.filter((b) => b.entityId === a.entityId).length > 1).length;
  const policy = instantPolicy({
    slug: launchSlug,
    chainId: cfg.chainId,
    tiers: { capWei: capWei.toString(), freshPoolCapWei: capWei.toString(), freshMaxNonce: -1, freshMaxAgeHours: 0 },
    permitSigner: relayer.account.address,
    method: { heuristic: CLUSTER_METHOD, maxHops: 2, source: "funding transactions observed by the sandbox relayer" },
  });
  emit({
    type: "step",
    step: "limits",
    detail: `Kin traced the funding: ${linkedWallets} of ${cfg.bundleSize} wallets share one funder, so they get one entity and one ${formatEther(capWei)} ETH limit`,
  });

  // ---- 5. Two launches: Kin (hooked) and plain (no hook), same parameters
  const latest = await pub.getBlock();
  const windowStart = latest.timestamp + BigInt(cfg.windowDelaySec);
  const base = {
    ...launchParams(),
    root: ZERO32,
    evidenceHash: policy.hash,
    stats: { allowlistedWallets: 0, entities: 0, linkedWallets: 0, freshWallets: 0 },
    windowStart,
    windowEnd: windowStart + BigInt(cfg.windowLengthSec),
    lockDuration: BigInt(cfg.lockSec),
  };
  const launch = (plain: boolean) => withAdminLock(async () => {
    const hash = await relayer.writeContract({
      address: plain ? cfg.deployment.plainFactory : cfg.deployment.factory,
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
  });
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

  // ---- 7. Permits for the Kin pool (signed by the hook's permit signer), then the attack on both pools
  const signer = await pub.readContract({ address: cfg.deployment.kinHook, abi: kinHookAbi, functionName: "permitSigner" });
  if ((signer as string).toLowerCase() !== relayer.account.address.toLowerCase()) {
    throw new Error(`the sandbox hook trusts permit signer ${signer}, not the relayer ${relayer.account.address}`);
  }
  const permitDeadline = Number(windowStart) + cfg.windowLengthSec;
  const proofs = new Map<string, Hex[]>();
  for (const a of assigned) {
    proofs.set(
      a.wallet.toLowerCase(),
      await signPermit(relayer.account, {
        chainId: cfg.chainId,
        hook: cfg.deployment.kinHook,
        poolId: kin.id,
        buyer: a.wallet,
        entityId: a.entityId,
        entityCap: BigInt(a.cap),
        deadline: permitDeadline,
      }),
    );
  }
  emit({ type: "step", step: "permits", detail: `${cfg.bundleSize} buy permits signed, one per wallet, all for the same entity and limit` });
  const entry = (w: Address) => {
    const a = assigned.find((x) => x.wallet.toLowerCase() === w.toLowerCase())!;
    return { entityId: a.entityId, cap: a.cap, proof: proofs.get(w.toLowerCase())! };
  };
  const deadline = BigInt(permitDeadline);
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

  // Exact revert reason for one more Kin buy, simulated (not sent), from a wallet whose Kin buy was refused: it still
  // holds that buy's ETH, so the simulation reaches the hook instead of failing on the balance.
  let rejectReason: string | null = null;
  const refused = outcomes.find((o) => o.pool === "kin" && o.status === "rejected");
  const probe = wallets[refused ? refused.index : 0]!;
  try {
    const e = entry(probe.account.address);
    await pub.simulateContract({
      account: probe.account,
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
    root: ZERO32,
    evidenceHash: policy.hash,
    mode: "instant",
    entities: entityIds.size,
    linkedWallets,
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
  const transport = chainTransport(rpcUrl, chain.id);
  await Promise.allSettled(
    keys.map(async (k) => {
      const w = createWalletClient({ chain, transport, account: privateKeyToAccount(k) });
      const bal = await pub.getBalance({ address: w.account.address });
      const cost = TRANSFER_GAS * maxFee;
      // Leave twice the L2 gas behind: on Base (OP stack) the L1 data fee is charged on top of gas × price, so
      // sending `balance - gas` exactly is rejected for insufficient funds and nothing comes back.
      if (bal <= cost * 3n) return;
      await w.sendTransaction({ to, value: bal - cost * 3n, gas: TRANSFER_GAS, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxFee / 10n || 1n });
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
