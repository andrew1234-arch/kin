import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { kinHookAbi } from "../abi/kin";
import { buildAllowlist, type AllowlistEntry } from "../allowlist/build";
import { clusterByFunding } from "../cluster/cluster";
import { traceFunding } from "../cluster/funding";
import type { HistoryProvider } from "../data/history";
import { hex, Rpc } from "../data/rpc";
import { measureBlockTime } from "../scan/earlyBuyers";
import type { WalletProfile } from "../types";
import { disputeMessage, registrationMessage } from "./registration";
import type { Dispute, LaunchRecord, LaunchStore } from "./store";
import { BaseVerifyError, type BaseVerifyClient, type VerifyOutcome } from "../verify/baseVerify";

export class LaunchError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface LaunchDeps {
  store: LaunchStore;
  /** Signature check (runtime.ts: EOA signatures only, unless smart wallets are explicitly allowed). */
  verify: (address: Address, message: string, signature: Hex) => Promise<boolean>;
  /** Chain access for allowlist builds (nonces, funding history). */
  rpc: () => Rpc;
  history: (rpc: Rpc) => HistoryProvider;
  excluded: Set<string>;
  exclusionsSource: Record<string, unknown>;
  /** Funding lookback before the snapshot; 0 = each wallet's whole history. */
  fundingWindowHours: number;
  /** ERC-20s whose wallet-to-wallet transfers count as funding links. */
  fundingTokens?: Address[];
  now?: () => number;
  /** Base Verify client; null when BASE_VERIFY_SECRET_KEY isn't set (the verified tier is then off). */
  baseVerify?: BaseVerifyClient | null;
}

export interface CreateLaunchInput {
  slug: string;
  chainId: number;
  name: string;
  symbol: string;
  registrationClosesAt: number;
  tiers: LaunchRecord["tiers"];
  window: LaunchRecord["window"];
  minBalanceWei?: string;
}

export class LaunchService {
  private readonly rootCache = new Map<string, { at: number; root: Hex; final: boolean }>();
  constructor(private readonly d: LaunchDeps) {}
  private now() {
    return this.d.now ? this.d.now() : Math.floor(Date.now() / 1000);
  }

  get(slug: string): LaunchRecord {
    const rec = this.d.store.get(slug);
    if (!rec) throw new LaunchError("launch not found", 404);
    return rec;
  }

  create(input: CreateLaunchInput): LaunchRecord {
    for (const k of ["capWei", "freshPoolCapWei", "verifiedCapWei"] as const) BigInt(input.tiers[k]);
    if (input.minBalanceWei !== undefined) BigInt(input.minBalanceWei);
    const rec: LaunchRecord = {
      ...input,
      createdAt: this.now(),
      registrations: [],
      verifications: [],
      disputes: [],
      overrides: [],
      allowlist: null,
      onchain: null,
    };
    if (!this.d.store.create(rec)) throw new LaunchError("launch already exists", 409);
    return rec;
  }

  /** Locked read-modify-write of one launch (see LaunchStore.update); LaunchErrors thrown by `fn` save nothing. */
  private update<T>(slug: string, fn: (rec: LaunchRecord) => T): T {
    this.get(slug);
    return this.d.store.update(slug, fn);
  }

  private registrationOpen(rec: LaunchRecord) {
    return this.now() < rec.registrationClosesAt;
  }

  async register(slug: string, walletIn: string, signature: Hex) {
    const rec = this.get(slug);
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const wallet = getAddress(walletIn);
    if (!this.registrationOpen(rec)) throw new LaunchError("registration is closed");
    const existing = rec.registrations.find((r) => r.wallet === wallet);
    if (existing) return { wallet, registeredAt: existing.at, alreadyRegistered: true };
    const ok = await this.d.verify(wallet, registrationMessage(slug, wallet, rec.chainId), signature);
    if (!ok) throw new LaunchError("signature does not match wallet (smart-contract wallets can't register: sign with an EOA)", 401);
    if (rec.minBalanceWei && BigInt(rec.minBalanceWei) > 0n) {
      const bal = BigInt(await this.d.rpc().call<Hex>("eth_getBalance", [wallet, "latest"]));
      if (bal < BigInt(rec.minBalanceWei)) {
        throw new LaunchError(`this wallet needs at least ${rec.minBalanceWei} wei on chain ${rec.chainId} to register`, 403);
      }
    }
    // Re-checked under the lock: registration may have closed, or this wallet registered, meanwhile.
    return this.update(slug, (cur) => {
      if (!this.registrationOpen(cur)) throw new LaunchError("registration is closed");
      const again = cur.registrations.find((r) => r.wallet === wallet);
      if (again) return { wallet, registeredAt: again.at, alreadyRegistered: true };
      const at = this.now();
      cur.registrations.push({ wallet, signature, at });
      return { wallet, registeredAt: at, alreadyRegistered: false };
    });
  }

  /**
   * Registrations → nonces + funding trace → clusters (with dispute overrides) → tiers → root + evidence.
   * Building closes registration first, so nobody is told "registered" for an allowlist they can't be on.
   */
  async build(slug: string) {
    const rec = this.update(slug, (cur) => {
      if (cur.onchain && this.now() >= cur.onchain.windowStart) throw new LaunchError("window has started; allowlist is frozen");
      if (cur.registrations.length === 0) throw new LaunchError("no registrations");
      cur.registrationClosesAt = Math.min(cur.registrationClosesAt, this.now());
      return cur;
    });
    const rpc = this.d.rpc();
    const history = this.d.history(rpc);
    const snapshot = BigInt(await rpc.call<Hex>("eth_blockNumber", []));
    const snapshotTs = Number(
      BigInt((await rpc.call<{ timestamp: Hex }>("eth_getBlockByNumber", [hex(snapshot), false])).timestamp),
    );
    const blockTime = await measureBlockTime(rpc, snapshot);
    const windowBlocks =
      blockTime > 0 && this.d.fundingWindowHours > 0
        ? BigInt(Math.ceil((this.d.fundingWindowHours * 3600) / blockTime))
        : snapshot;
    const wallets = rec.registrations.map((r) => r.wallet);

    const verifiedSet = new Set((rec.verifications ?? []).map((v) => v.wallet));
    const fundingTokens = this.d.fundingTokens ?? [];
    const traced = await traceFunding(
      history,
      wallets.map((wallet) => ({ wallet, beforeBlock: snapshot })),
      { windowBlocks, excluded: this.d.excluded, maxHops: 2, fundingTokens, rpc },
    );
    const profiles: WalletProfile[] = await Promise.all(
      wallets.map(async (wallet) => ({
        wallet,
        nonce: Number(BigInt(await rpc.call<Hex>("eth_getTransactionCount", [wallet, hex(snapshot)]))),
        firstFundedAt: traced.firstFundedAt.get(wallet.toLowerCase()),
        verified: verifiedSet.has(wallet),
      })),
    );
    // Accepted "unlink" disputes: the wallet's own funding edges no longer count, in either direction.
    const unlinked = new Set(rec.overrides.filter((o) => o.action === "unlink").map((o) => o.wallet.toLowerCase()));
    const edges = traced.edges.filter((e) => !unlinked.has(e.to.toLowerCase()) && !unlinked.has(e.from.toLowerCase()));
    const clusters = clusterByFunding(wallets, edges, { maxHops: 2, excluded: this.d.excluded });

    const out = buildAllowlist({
      launch: { chainId: rec.chainId, launchId: slug, snapshotBlock: snapshot.toString(), snapshotTimestamp: snapshotTs },
      tiers: {
        capWei: BigInt(rec.tiers.capWei),
        freshPoolCapWei: BigInt(rec.tiers.freshPoolCapWei),
        verifiedCapWei: BigInt(rec.tiers.verifiedCapWei),
        freshMaxNonce: rec.tiers.freshMaxNonce,
        freshMaxAgeHours: rec.tiers.freshMaxAgeHours ?? 0,
      },
      wallets: profiles,
      clusters,
      method: {
        heuristic: "shared funder (native ETH, or a funding token sent by a wallet) within 2 hops before the snapshot",
        fundingWindowHours: this.d.fundingWindowHours === 0 ? "whole history" : this.d.fundingWindowHours,
        fundingTokens,
        measuredBlockTimeSec: blockTime,
        historyProvider: history.name,
        exclusions: this.d.exclusionsSource,
        overrides: rec.overrides,
        disputes: rec.disputes.map((x) => ({ id: x.id, wallet: x.wallet, status: x.status, resolution: x.resolution })),
      },
    });
    // Saved under the lock, with the record as it is now: anything that changed during the build is kept.
    return this.update(slug, (cur) => {
      if (cur.onchain && this.now() >= cur.onchain.windowStart) throw new LaunchError("window has started; allowlist is frozen");
      const version = (cur.allowlist?.version ?? 0) + 1;
      this.d.store.saveVersion(slug, version, out.entries, out.evidenceJson);
      cur.versions = [...(cur.versions ?? []), { version, root: out.root }];
      cur.allowlist = {
        version,
        root: out.root,
        evidenceHash: out.evidenceHash,
        stats: out.stats,
        builtAt: this.now(),
        snapshotBlock: snapshot.toString(),
      };
      return cur.allowlist;
    });
  }

  /** The root actually onchain (cached briefly; for good once the window has started and the root is frozen). */
  private async onchainRoot(rec: LaunchRecord): Promise<Hex> {
    const o = rec.onchain!;
    const hit = this.rootCache.get(rec.slug);
    if (hit && (hit.final || Date.now() - hit.at < 10_000)) return hit.root;
    const data = await this.d.rpc().call<Hex>("eth_call", [
      { to: o.key.hooks, data: encodeFunctionData({ abi: kinHookAbi, functionName: "getLaunch", args: [o.poolId] }) },
      "latest",
    ]);
    const l = decodeFunctionResult({ abi: kinHookAbi, functionName: "getLaunch", data }) as { root: Hex; windowStart: bigint };
    this.rootCache.set(rec.slug, { at: Date.now(), root: l.root, final: this.now() >= Number(l.windowStart) });
    return l.root;
  }

  /**
   * The version whose root is onchain, read from the hook rather than trusted from this server's own record (a
   * root changed outside the admin CLI, or a failed save, would otherwise serve proofs for the wrong root).
   */
  private async liveVersion(rec: LaunchRecord): Promise<number> {
    if (!rec.allowlist) throw new LaunchError("allowlist not built yet", 404);
    if (!rec.onchain) return rec.allowlist.version;
    const root = (await this.onchainRoot(rec)).toLowerCase();
    const versions = rec.versions ?? [{ version: rec.onchain.rootVersion, root: rec.allowlist.root }];
    const match = [...versions].reverse().find((v) => v.root.toLowerCase() === root);
    if (!match) throw new LaunchError("the onchain root matches no allowlist version this server built", 409);
    return match.version;
  }

  async entries(slug: string): Promise<AllowlistEntry[]> {
    const rec = this.get(slug);
    return this.d.store.entries(slug, await this.liveVersion(rec));
  }

  async evidence(slug: string, version?: number): Promise<string> {
    const rec = this.get(slug);
    return this.d.store.evidence(slug, version ?? (await this.liveVersion(rec)));
  }

  async proof(slug: string, walletIn: string): Promise<AllowlistEntry> {
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const w = getAddress(walletIn);
    const e = (await this.entries(slug)).find((x) => x.wallet === w);
    if (!e) throw new LaunchError("wallet is not on the allowlist", 404);
    return e;
  }

  private verifier() {
    if (!this.d.baseVerify) throw new LaunchError("Base Verify isn't enabled on this server", 503);
    return this.d.baseVerify;
  }

  /** The SIWE message a registered wallet signs to verify with Base Verify (while registration is open). */
  verifyMessage(slug: string, walletIn: string) {
    const rec = this.get(slug);
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const wallet = getAddress(walletIn);
    if (!this.registrationOpen(rec)) throw new LaunchError("registration is closed");
    if (!rec.registrations.some((r) => r.wallet === wallet)) throw new LaunchError("register this wallet first");
    return this.verifier().issueMessage(slug, wallet);
  }

  /**
   * Check a signed verification message with Base Verify. One verified account can verify one wallet per
   * launch: a second wallet behind the same account is refused.
   */
  async submitVerification(slug: string, walletIn: string, nonce: string, signature: Hex) {
    const rec = this.get(slug);
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const wallet = getAddress(walletIn);
    if (!this.registrationOpen(rec)) throw new LaunchError("registration is closed");
    if (!rec.registrations.some((r) => r.wallet === wallet)) throw new LaunchError("register this wallet first");
    let outcome: VerifyOutcome;
    try {
      outcome = await this.verifier().verify(slug, wallet, nonce, signature);
    } catch (e) {
      if (e instanceof BaseVerifyError) throw new LaunchError(e.message, e.status);
      throw e;
    }
    if (outcome.kind !== "verified") return outcome;
    const tokenHash = outcome.tokenHash;
    return this.update(slug, (cur) => {
      // Under the lock: registration may have closed (an allowlist build started) meanwhile.
      if (!this.registrationOpen(cur)) throw new LaunchError("registration is closed");
      const list = cur.verifications ?? [];
      const sameAccount = list.find((v) => v.tokenHash === tokenHash);
      if (sameAccount && sameAccount.wallet !== wallet) {
        throw new LaunchError("this verified account already verified another wallet for this launch", 409);
      }
      if (!sameAccount) {
        list.push({ wallet, tokenHash, at: this.now() });
        cur.verifications = list;
      }
      return { kind: "verified" as const };
    });
  }

  /** What one wallet needs to see: registered? on the allowlist (live version)? its entry. */
  async walletStatus(slug: string, walletIn: string) {
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const w = getAddress(walletIn);
    const rec = this.get(slug);
    const reg = rec.registrations.find((r) => r.wallet === w) ?? null;
    let entry: AllowlistEntry | null = null;
    let entityMembers: number | null = null;
    if (rec.allowlist) {
      const all = await this.entries(slug);
      entry = all.find((x) => x.wallet === w) ?? null;
      if (entry) entityMembers = all.filter((x) => x.entityId === entry!.entityId).length;
    }
    const disputes = rec.disputes.filter((d) => d.wallet === w).map(({ signature: _s, ...d }) => d);
    const verified = (rec.verifications ?? []).some((v) => v.wallet === w);
    return { wallet: w, registered: !!reg, registeredAt: reg?.at ?? null, verified, entry, entityMembers, disputes };
  }

  async dispute(slug: string, walletIn: string, reason: string, signature: Hex): Promise<Dispute> {
    const rec = this.get(slug);
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const wallet = getAddress(walletIn);
    const text = reason.trim();
    if (text.length < 3 || text.length > 1000) throw new LaunchError("reason must be 3-1000 characters");
    if (rec.onchain && this.now() >= rec.onchain.windowStart) throw new LaunchError("disputes close when the window starts");
    const ok = await this.d.verify(wallet, disputeMessage(slug, wallet, rec.chainId, text), signature);
    if (!ok) throw new LaunchError("signature does not match wallet", 401);
    return this.update(slug, (cur) => {
      if (cur.onchain && this.now() >= cur.onchain.windowStart) throw new LaunchError("disputes close when the window starts");
      const d: Dispute = {
        id: `D${cur.disputes.length + 1}`,
        wallet,
        reason: text,
        signature,
        at: this.now(),
        status: "open",
        resolution: null,
      };
      cur.disputes.push(d);
      return d;
    });
  }

  /** Admin decision. `unlink` makes the next build ignore the wallet's funding links. */
  resolveDispute(slug: string, id: string, accept: boolean, note: string, unlink: boolean) {
    return this.update(slug, (rec) => {
      const d = rec.disputes.find((x) => x.id === id);
      if (!d) throw new LaunchError("dispute not found", 404);
      d.status = accept ? "accepted" : "rejected";
      d.resolution = note || null;
      if (accept && unlink && !rec.overrides.some((o) => o.wallet === d.wallet)) {
        rec.overrides.push({ wallet: d.wallet, action: "unlink", disputeId: d.id });
      }
      return d;
    });
  }

  attachOnchain(slug: string, onchain: NonNullable<LaunchRecord["onchain"]>) {
    this.rootCache.delete(slug);
    return this.update(slug, (rec) => {
      rec.onchain = onchain;
      return rec;
    });
  }

  /** Public view: no signatures. */
  publicView(rec: LaunchRecord) {
    return {
      slug: rec.slug,
      chainId: rec.chainId,
      name: rec.name,
      symbol: rec.symbol,
      createdAt: rec.createdAt,
      registrationClosesAt: rec.registrationClosesAt,
      minBalanceWei: rec.minBalanceWei ?? null,
      tiers: rec.tiers,
      window: rec.window,
      registrations: rec.registrations.length,
      verifiedWallets: (rec.verifications ?? []).length,
      baseVerify: !!this.d.baseVerify,
      disputes: rec.disputes.map(({ signature: _s, ...x }) => x),
      allowlist: rec.allowlist,
      onchain: rec.onchain,
    };
  }
}
