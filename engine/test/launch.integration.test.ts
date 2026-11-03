import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { LEAF_ENCODING } from "../src/allowlist/build";
import { RpcScanHistory } from "../src/data/history";
import { Rpc } from "../src/data/rpc";
import { disputeMessage, registrationMessage } from "../src/launch/registration";
import { LaunchError, LaunchService } from "../src/launch/service";
import { LaunchStore } from "../src/launch/store";
import { chainFor } from "../src/sandbox/relayer";

const PORT = 8548;
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

describe("LaunchService on a local chain", () => {
  test("register → build → dispute → unlink → rebuild", async () => {
    // 3 wallets funded by one funder; 1 aged wallet; 2 fresh wallets. No shared funding among the last 3.
    const funder = acct();
    await setBalance(funder.address, parseEther("10"));
    const fw = createWalletClient({ chain, transport: http(RPC), account: funder });
    const linked = [acct(), acct(), acct()];
    for (const w of linked) await pub.waitForTransactionReceipt({ hash: await fw.sendTransaction({ to: w.address, value: parseEther("0.1") }) });
    const aged = acct();
    await setBalance(aged.address, parseEther("1"));
    const aw = createWalletClient({ chain, transport: http(RPC), account: aged });
    await pub.waitForTransactionReceipt({ hash: await aw.sendTransaction({ to: aged.address, value: 1n }) });
    const fresh = [acct(), acct()];
    for (const w of fresh) await setBalance(w.address, parseEther("1"));

    const store = new LaunchStore(mkdtempSync(join(tmpdir(), "kin-launch-")));
    const svc = new LaunchService({
      store,
      verify: (address, message, signature) => pub.verifyMessage({ address, message, signature }),
      rpc: () => new Rpc(RPC),
      history: (rpc) => new RpcScanHistory(rpc),
      excluded: new Set(),
      exclusionsSource: { test: true },
      fundingWindowHours: 72,
    });
    const slug = "test-launch";
    svc.create({
      slug,
      chainId: 31337,
      name: "Test",
      symbol: "TST",
      registrationClosesAt: Math.floor(Date.now() / 1000) + 3600,
      tiers: { capWei: parseEther("1").toString(), freshPoolCapWei: parseEther("0.5").toString(), verifiedCapWei: parseEther("3").toString(), freshMaxNonce: 0 },
      window: { delayAfterBuildSec: 60, lengthSec: 600, lockSec: 300 },
    });

    const all = [...linked, aged, ...fresh];
    for (const a of all) {
      const sig = await a.signMessage({ message: registrationMessage(slug, a.address, 31337) });
      const r = await svc.register(slug, a.address, sig);
      expect(r.alreadyRegistered).toBe(false);
    }
    // Wrong signer is refused.
    const intruder = acct();
    const badSig = await intruder.signMessage({ message: registrationMessage(slug, linked[0]!.address, 31337) });
    const other = acct();
    await expect(svc.register(slug, other.address, badSig)).rejects.toBeInstanceOf(LaunchError);

    const v1 = await svc.build(slug);
    expect(v1.version).toBe(1);
    expect(v1.stats).toEqual({ allowlistedWallets: 6, entities: 3, linkedWallets: 3, freshWallets: 2 });
    const ev1 = JSON.parse(svc.evidence(slug));
    const linkedEntity = ev1.entities.find((e: { tier: string }) => e.tier === "linked");
    expect(linkedEntity.links.length).toBe(2);
    for (const l of linkedEntity.links) expect(l.txHashes.length).toBe(2);

    // Every proof verifies against the root.
    for (const a of all) {
      const e = svc.proof(slug, a.address);
      expect(StandardMerkleTree.verify(v1.root, [...LEAF_ENCODING], [e.wallet, e.entityId, e.cap], e.proof)).toBe(true);
    }

    // linked[0] disputes; the admin accepts and unlinks it.
    const reason = "I bought my wallet's ETH from a friend, not a bundler";
    const dsig = (await linked[0]!.signMessage({ message: disputeMessage(slug, linked[0]!.address, 31337, reason) })) as Hex;
    const d = await svc.dispute(slug, linked[0]!.address, reason, dsig);
    expect(d.status).toBe("open");
    svc.resolveDispute(slug, d.id, true, "accepted after review", true);

    const v2 = await svc.build(slug);
    expect(v2.version).toBe(2);
    expect(v2.root).not.toBe(v1.root);
    // The two remaining linked wallets still share a funder; linked[0] is now a fresh wallet.
    expect(v2.stats).toEqual({ allowlistedWallets: 6, entities: 3, linkedWallets: 2, freshWallets: 3 });
    expect(svc.proof(slug, linked[0]!.address).tier).toBe("fresh");
    const ev2 = JSON.parse(svc.evidence(slug));
    expect(ev2.method.overrides[0].wallet).toBe(linked[0]!.address);

    // Once the window has started, the allowlist is frozen.
    svc.attachOnchain(slug, {
      poolId: ("0x" + "11".repeat(32)) as Hex,
      token: linked[0]!.address,
      launchTx: ("0x" + "22".repeat(32)) as Hex,
      windowStart: Math.floor(Date.now() / 1000) - 1,
      windowEnd: Math.floor(Date.now() / 1000) + 600,
      lockDuration: 300,
      rootVersion: 2,
    });
    await expect(svc.build(slug)).rejects.toThrow("frozen");
    await expect(svc.dispute(slug, linked[1]!.address, "too late", dsig)).rejects.toThrow("window starts");
  }, 60_000);
});
