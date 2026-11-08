import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseEther,
  recoverTypedDataAddress,
  compactSignatureToSignature,
  serializeSignature,
  toBytes,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RpcScanHistory } from "../src/data/history";
import { Rpc } from "../src/data/rpc";
import { assignInstant, instantFreshPoolId, PERMIT_TYPES, type PermitAssignment } from "../src/launch/instant";
import { LaunchError, LaunchService } from "../src/launch/service";
import { LaunchStore } from "../src/launch/store";
import { chainFor } from "../src/sandbox/relayer";
import type { FundingEdge } from "../src/types";

const tiers = { capWei: parseEther("1"), freshPoolCapWei: parseEther("0.5"), freshMaxNonce: 0, freshMaxAgeHours: 0 };
const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const edge = (from: number, to: number, hop: 1 | 2): FundingEdge => ({
  from: A(from),
  to: A(to),
  txHash: `0x${(from * 1000 + to).toString(16).padStart(64, "0")}` as Hex,
  blockNumber: 1n,
  timestamp: 1,
  value: 1n,
  hop,
});
const row = (wallet: number, a: ReturnType<typeof assignInstant>): PermitAssignment => ({ wallet: A(wallet), ...a, at: 0, nonce: 5 });

describe("assignInstant", () => {
  test("wallets with the same funder share one entity and its cap, whoever buys first", () => {
    const first = assignInstant("x", [], { wallet: A(1), nonce: 5, edges: [edge(100, 1, 1)] }, tiers, 0, new Set());
    expect(first.tier).toBe("aged");
    const second = assignInstant("x", [row(1, first)], { wallet: A(2), nonce: 5, edges: [edge(100, 2, 1)] }, tiers, 0, new Set());
    expect(second.entityId).toBe(first.entityId);
    expect(second.tier).toBe("linked");
    expect(second.cap).toBe(first.cap);
    expect(second.via).toBe(A(100));
  });

  test("a shared funder two hops back links too; a wallet funded by an earlier buyer joins its entity", () => {
    const first = assignInstant("x", [], { wallet: A(1), nonce: 5, edges: [edge(100, 1, 1), edge(200, 100, 2)] }, tiers, 0, new Set());
    const viaHop2 = assignInstant("x", [row(1, first)], { wallet: A(3), nonce: 5, edges: [edge(300, 3, 1), edge(200, 300, 2)] }, tiers, 0, new Set());
    expect(viaHop2.entityId).toBe(first.entityId);
    const child = assignInstant("x", [row(1, first)], { wallet: A(4), nonce: 5, edges: [edge(1, 4, 1)] }, tiers, 0, new Set());
    expect(child.entityId).toBe(first.entityId);
  });

  test("exchanges never link; fresh wallets share the pool; unrelated aged wallets get their own cap", () => {
    const cex = new Set([A(999).toLowerCase()]);
    const a = assignInstant("x", [], { wallet: A(1), nonce: 5, edges: [edge(999, 1, 1)] }, tiers, 0, cex);
    const b = assignInstant("x", [row(1, a)], { wallet: A(2), nonce: 5, edges: [edge(999, 2, 1)] }, tiers, 0, cex);
    expect(b.entityId).not.toBe(a.entityId);
    expect(b.tier).toBe("aged");
    const f = assignInstant("x", [], { wallet: A(7), nonce: 0, edges: [] }, tiers, 0, new Set());
    expect(f.tier).toBe("fresh");
    expect(f.entityId).toBe(instantFreshPoolId("x"));
    expect(f.cap).toBe(tiers.freshPoolCapWei.toString());
    // Young by age: first funded an hour ago with freshMaxAgeHours = 24.
    const young = assignInstant("x", [], { wallet: A(8), nonce: 3, firstFundedAt: 1000, edges: [] }, { ...tiers, freshMaxAgeHours: 24 }, 1000 + 3600, new Set());
    expect(young.tier).toBe("fresh");
  });

  test("a wallet linked to a fresh-pool wallet joins the fresh pool (one cap, never a second one)", () => {
    const f = assignInstant("x", [], { wallet: A(1), nonce: 0, edges: [edge(100, 1, 1)] }, tiers, 0, new Set());
    const g = assignInstant("x", [row(1, f)], { wallet: A(2), nonce: 9, edges: [edge(100, 2, 1)] }, tiers, 0, new Set());
    expect(g.entityId).toBe(f.entityId);
    expect(g.tier).toBe("fresh");
  });
});

// ------------------------------------------------------------------ service, on a local chain

const PORT = 8549;
const RPC = `http://127.0.0.1:${PORT}`;
let anvil: ReturnType<typeof Bun.spawn> | null = null;
let pub: PublicClient;
const chain = chainFor(31337, RPC);
const acct = () => privateKeyToAccount(generatePrivateKey());

beforeAll(async () => {
  anvil = Bun.spawn(["anvil", "--port", String(PORT), "--silent"], { stdout: "ignore", stderr: "ignore" });
  pub = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getChainId();
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error("anvil did not start");
});
afterAll(() => anvil?.kill());

const setBalance = (a: `0x${string}`, wei: bigint) =>
  pub.request({ method: "anvil_setBalance" as never, params: [a, `0x${wei.toString(16)}`] as never });

describe("LaunchService instant launch", () => {
  test("no registration; permits trace funding at buy time and are signed for the hook", async () => {
    const funder = acct();
    await setBalance(funder.address, parseEther("10"));
    const fw = createWalletClient({ chain, transport: http(RPC), account: funder });
    const bundle = [acct(), acct(), acct()];
    for (const w of bundle) {
      await pub.waitForTransactionReceipt({ hash: await fw.sendTransaction({ to: w.address, value: parseEther("0.1") }) });
      // One transaction each, so they are not "fresh": a patient bundler ages its wallets.
      const ww = createWalletClient({ chain, transport: http(RPC), account: w });
      await pub.waitForTransactionReceipt({ hash: await ww.sendTransaction({ to: w.address, value: 1n }) });
    }
    // A brand-new wallet from the same funder joins the bundle's entity (linking wins over freshness).
    const late = acct();
    await pub.waitForTransactionReceipt({ hash: await fw.sendTransaction({ to: late.address, value: parseEther("0.1") }) });
    const aged = acct();
    await setBalance(aged.address, parseEther("1"));
    const aw = createWalletClient({ chain, transport: http(RPC), account: aged });
    await pub.waitForTransactionReceipt({ hash: await aw.sendTransaction({ to: aged.address, value: 1n }) });
    const fresh = acct();
    await setBalance(fresh.address, parseEther("1"));

    const signer = privateKeyToAccount(generatePrivateKey());
    const svc = new LaunchService({
      store: new LaunchStore(mkdtempSync(join(tmpdir(), "kin-instant-"))),
      verify: async () => false,
      rpc: () => new Rpc(RPC),
      history: (rpc) => new RpcScanHistory(rpc),
      excluded: new Set(),
      exclusionsSource: { test: true },
      fundingWindowHours: 72,
      permitSigner: signer,
    });
    const slug = "instant-test";
    const now = Math.floor(Date.now() / 1000);
    svc.create({
      slug,
      chainId: 31337,
      name: "Instant",
      symbol: "INS",
      mode: "instant",
      registrationClosesAt: now,
      tiers: { capWei: parseEther("1").toString(), freshPoolCapWei: parseEther("0.5").toString(), verifiedCapWei: parseEther("1").toString(), freshMaxNonce: 0 },
      window: { delayAfterBuildSec: 0, lengthSec: 600, lockSec: 60 },
    });

    // No registration, no allowlist, no disputes.
    await expect(svc.register(slug, aged.address, "0x" as Hex)).rejects.toThrow(LaunchError);
    await expect(svc.build(slug)).rejects.toThrow("no allowlist");
    // Not deployed yet: no permits.
    await expect(svc.permit(slug, aged.address)).rejects.toThrow("not deployed");

    const policy = svc.instantPolicyFor(svc.get(slug));
    expect(policy.hash).toBe(keccak256(toBytes(policy.json)));
    svc.setInstantPolicy(slug, policy.json, policy.hash);
    const hook = A(0x4c0);
    const poolId = keccak256(toBytes("pool")) as Hex;
    svc.attachOnchain(slug, {
      poolId,
      key: { currency0: A(0), currency1: A(0x70c), fee: 10000, tickSpacing: 200, hooks: hook },
      token: A(0x70c),
      launchTx: poolId,
      windowStart: now,
      windowEnd: now + 600,
      lockDuration: 60,
      rootVersion: 0,
    });
    expect(await svc.evidence(slug)).toBe(policy.json);

    const p1 = await svc.permit(slug, bundle[0]!.address);
    const p2 = await svc.permit(slug, bundle[1]!.address);
    const p3 = await svc.permit(slug, bundle[2]!.address);
    expect(new Set([p1.entityId, p2.entityId, p3.entityId]).size).toBe(1);
    expect(p3.tier).toBe("linked");
    expect(p3.entityMembers).toBe(3);
    const pa = await svc.permit(slug, aged.address);
    expect(pa.entityId).not.toBe(p1.entityId);
    expect(pa.tier).toBe("aged");
    const pf = await svc.permit(slug, fresh.address);
    expect(pf.tier).toBe("fresh");
    expect(pf.cap).toBe(parseEther("0.5").toString());

    // The proof is [deadline, r, yParityAndS], signed by the permit signer over exactly this buyer and entity.
    const [deadlineHex, r, yParityAndS] = p2.proof as [Hex, Hex, Hex];
    expect(Number(BigInt(deadlineHex))).toBe(p2.deadline);
    const recovered = await recoverTypedDataAddress({
      domain: { name: "KinHook", version: "1", chainId: 31337, verifyingContract: hook },
      types: PERMIT_TYPES,
      primaryType: "KinPermit",
      message: { poolId, buyer: bundle[1]!.address, entityId: p2.entityId, entityCap: BigInt(p2.cap), deadline: BigInt(p2.deadline) },
      signature: serializeSignature(compactSignatureToSignature({ r, yParityAndS })),
    });
    expect(recovered).toBe(signer.address);

    // Asking again returns the same entity (the cap is pinned onchain by the first buy).
    const again = await svc.permit(slug, bundle[1]!.address);
    expect(again.entityId).toBe(p2.entityId);
    const pl = await svc.permit(slug, late.address);
    expect(pl.entityId).toBe(p1.entityId);
    expect(pl.cap).toBe(p1.cap);
    expect(svc.permits(slug)).toHaveLength(6);
    const status = await svc.walletStatus(slug, bundle[0]!.address);
    expect(status.entry?.tier).toBe("linked");
    expect(status.entityMembers).toBe(4);
    const view = svc.publicView(svc.get(slug));
    expect(view.mode).toBe("instant");
    expect(view.instant).toMatchObject({ wallets: 6, entities: 3, linkedWallets: 4, freshWallets: 1 });
  }, 60_000);
});
