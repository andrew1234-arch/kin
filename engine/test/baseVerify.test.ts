import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, parseEther, verifyMessage, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { assignEntities } from "../src/allowlist/build";
import { registrationMessage } from "../src/launch/registration";
import { LaunchError, LaunchService } from "../src/launch/service";
import { LaunchStore } from "../src/launch/store";
import { BaseVerifyClient, BaseVerifyError, verifyAction, type BaseVerifyConfig } from "../src/verify/baseVerify";
import { addr } from "./scenario";

const cfg: BaseVerifyConfig = {
  secretKey: "test-secret",
  apiUrl: "https://verify.example/v1",
  webAppUrl: "https://verify.example",
  appUrl: "https://kin.example",
  provider: "coinbase",
  traits: { coinbase_one_active: "true", followers: "gte:10" },
  siweChainId: 8453,
  messageTtlSec: 600,
};

/** A stand-in for Base Verify: `accounts` maps a wallet to the provider account it verified (if any). */
function fakeBaseVerify(accounts: Map<string, string>, calls: { auth: string | null; body: { message: string } }[] = []) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { message: string; signature: Hex };
    calls.push({ auth: new Headers(init?.headers).get("authorization"), body });
    const siwe = parseSiweMessage(body.message);
    const wallet = getAddress(siwe.address!);
    if (!(await verifyMessage({ address: wallet, message: body.message, signature: body.signature }))) {
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }
    const account = accounts.get(wallet);
    if (!account) return Response.json({ error: "verification_not_found" }, { status: 404 });
    const action = siwe.resources!.find((r) => r.startsWith("urn:verify:action:"))!.slice("urn:verify:action:".length);
    return Response.json({ token: `token-of-${account}-for-${action}`, action, wallet });
  }) as typeof fetch;
}

describe("Base Verify client", () => {
  test("the message is SIWE, built by Kin, with provider, traits and the launch's action", () => {
    const c = new BaseVerifyClient(cfg, fakeBaseVerify(new Map()));
    const w = privateKeyToAccount(generatePrivateKey());
    const { message } = c.issueMessage("demo-live", w.address);
    const siwe = parseSiweMessage(message);
    expect(siwe.domain).toBe("kin.example");
    expect(siwe.address).toBe(w.address);
    expect(siwe.chainId).toBe(8453);
    expect(siwe.resources).toEqual([
      "urn:verify:provider:coinbase",
      "urn:verify:provider:coinbase:coinbase_one_active:eq:true",
      "urn:verify:provider:coinbase:followers:gte:10",
      `urn:verify:action:${verifyAction("demo-live")}`,
    ]);
    expect(verifyAction("demo-live")).toBe("kin_launch_demo_live");
  });

  test("a message is accepted once, only for its wallet and launch, and before it expires", async () => {
    let now = 1_000_000;
    const w = privateKeyToAccount(generatePrivateKey());
    const calls: { auth: string | null; body: { message: string } }[] = [];
    const c = new BaseVerifyClient(cfg, fakeBaseVerify(new Map([[w.address, "acct-1"]]), calls), () => now);
    const { message, nonce } = c.issueMessage("l1", w.address);
    const sig = await w.signMessage({ message });
    await expect(c.verify("l2", w.address, nonce, sig)).rejects.toBeInstanceOf(BaseVerifyError); // wrong launch: nonce consumed
    const again = c.issueMessage("l1", w.address);
    const sig2 = await w.signMessage({ message: again.message });
    const ok = await c.verify("l1", w.address, again.nonce, sig2);
    expect(ok.kind).toBe("verified");
    expect(calls.at(-1)!.auth).toBe("Bearer test-secret");
    await expect(c.verify("l1", w.address, again.nonce, sig2)).rejects.toThrow("unknown or mismatched"); // single use
    const late = c.issueMessage("l1", w.address);
    now += 601_000;
    await expect(c.verify("l1", w.address, late.nonce, await w.signMessage({ message: late.message }))).rejects.toThrow("expired");
  });

  test("not verified yet → a link to the Base Verify mini app that returns to the launch", async () => {
    const w = privateKeyToAccount(generatePrivateKey());
    const c = new BaseVerifyClient(cfg, fakeBaseVerify(new Map()));
    const { message, nonce } = c.issueMessage("demo", w.address);
    const r = await c.verify("demo", w.address, nonce, await w.signMessage({ message }));
    expect(r.kind).toBe("not_verified");
    if (r.kind === "not_verified") {
      const u = new URL(r.redirectUrl);
      expect(u.origin).toBe("https://verify.example");
      expect(u.searchParams.get("redirect_uri")).toBe("https://kin.example/launch/demo");
      expect(u.searchParams.get("providers")).toBe("coinbase");
    }
  });

  test("traits not satisfied, a rejected key, and an answer for another wallet are told apart", async () => {
    const w = privateKeyToAccount(generatePrivateKey());
    const respond = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
    const run = async (f: typeof fetch) => {
      const c = new BaseVerifyClient(cfg, f);
      const { message, nonce } = c.issueMessage("x", w.address);
      return c.verify("x", w.address, nonce, await w.signMessage({ message }));
    };
    expect((await run(respond(400, { code: 9, message: "verification_traits_not_satisfied" }))).kind).toBe("traits_not_satisfied");
    await expect(run(respond(401, { error: "unauthorized" }))).rejects.toThrow("rejected the server's key");
    await expect(run(respond(200, { token: "t", action: verifyAction("x"), wallet: addr("someone-else") }))).rejects.toThrow("another wallet");
    await expect(run(respond(200, { token: "t", action: "other_action", wallet: w.address }))).rejects.toThrow("action");
  });
});

describe("verified tier in a launch", () => {
  test("one verified account verifies one wallet per launch; the wallet shows as verified", async () => {
    const human = privateKeyToAccount(generatePrivateKey());
    const humansSecondWallet = privateKeyToAccount(generatePrivateKey());
    const accounts = new Map([
      [human.address, "acct-human"],
      [humansSecondWallet.address, "acct-human"], // same Coinbase account, another wallet
    ]);
    const svc = new LaunchService({
      store: new LaunchStore(mkdtempSync(join(tmpdir(), "kin-bv-"))),
      verify: (address, message, signature) => verifyMessage({ address, message, signature }),
      rpc: () => {
        throw new Error("no chain needed");
      },
      history: () => {
        throw new Error("no chain needed");
      },
      excluded: new Set(),
      exclusionsSource: {},
      fundingWindowHours: 72,
      baseVerify: new BaseVerifyClient(cfg, fakeBaseVerify(accounts)),
    });
    svc.create({
      slug: "bv",
      chainId: 84532,
      name: "BV",
      symbol: "BV",
      registrationClosesAt: Math.floor(Date.now() / 1000) + 3600,
      tiers: { capWei: parseEther("0.01").toString(), freshPoolCapWei: parseEther("0.02").toString(), verifiedCapWei: parseEther("0.05").toString(), freshMaxNonce: 0 },
      window: { delayAfterBuildSec: 60, lengthSec: 600, lockSec: 60 },
    });
    // Must register before verifying.
    expect(() => svc.verifyMessage("bv", human.address)).toThrow(LaunchError);
    for (const w of [human, humansSecondWallet]) {
      await svc.register("bv", w.address, await w.signMessage({ message: registrationMessage("bv", w.address, 84532) }));
    }
    const m1 = svc.verifyMessage("bv", human.address);
    expect((await svc.submitVerification("bv", human.address, m1.nonce, await human.signMessage({ message: m1.message }))).kind).toBe("verified");
    expect(svc.walletStatus("bv", human.address).verified).toBe(true);

    const m2 = svc.verifyMessage("bv", humansSecondWallet.address);
    await expect(
      svc.submitVerification("bv", humansSecondWallet.address, m2.nonce, await humansSecondWallet.signMessage({ message: m2.message })),
    ).rejects.toThrow("already verified another wallet");
    expect(svc.walletStatus("bv", humansSecondWallet.address).verified).toBe(false);
    expect(svc.publicView(svc.get("bv")).verifiedWallets).toBe(1);
  });

  test("verified wallets get the verified cap; a linked entity with a verified member gets it once", () => {
    const tiers = { capWei: 10n, freshPoolCapWei: 20n, verifiedCapWei: 50n, freshMaxNonce: 0 };
    const [v, a, b] = [addr("verified-solo"), addr("linked-a"), addr("linked-b")];
    const { entities, capOf } = assignEntities(
      [
        { wallet: v, nonce: 0, verified: true },
        { wallet: a, nonce: 3, verified: true },
        { wallet: b, nonce: 0 },
      ],
      [{ members: [a, b], links: [] }],
      tiers,
    );
    const solo = entities.find((e) => e.members.includes(v))!;
    const linked = entities.find((e) => e.members.includes(a))!;
    expect(solo.tier).toBe("verified");
    expect(capOf.get(solo.entityId)).toBe(50n);
    expect(linked.tier).toBe("linked");
    expect(capOf.get(linked.entityId)).toBe(50n); // one shared cap, not 50 per wallet
  });
});
