import { getAddress, isAddress, type Address, type Hex } from "viem";
import { buildAllowlist, type AllowlistEntry } from "../allowlist/build";
import { clusterByFunding } from "../cluster/cluster";
import { traceFunding } from "../cluster/funding";
import type { HistoryProvider } from "../data/history";
import { hex, Rpc } from "../data/rpc";
import { measureBlockTime } from "../scan/earlyBuyers";
import type { WalletProfile } from "../types";
import { disputeMessage, registrationMessage } from "./registration";
import type { Dispute, LaunchRecord, LaunchStore } from "./store";

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
  /** Signature check (viem publicClient.verifyMessage: EOAs and smart wallets). */
  verify: (address: Address, message: string, signature: Hex) => Promise<boolean>;
  /** Chain access for allowlist builds (nonces, funding history). */
  rpc: () => Rpc;
  history: (rpc: Rpc) => HistoryProvider;
  excluded: Set<string>;
  exclusionsSource: Record<string, unknown>;
  fundingWindowHours: number;
  now?: () => number;
}

export interface CreateLaunchInput {
  slug: string;
  chainId: number;
  name: string;
  symbol: string;
  registrationClosesAt: number;
  tiers: LaunchRecord["tiers"];
  window: LaunchRecord["window"];
}

export class LaunchService {
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
    if (this.d.store.get(input.slug)) throw new LaunchError("launch already exists", 409);
    for (const k of ["capWei", "freshPoolCapWei", "verifiedCapWei"] as const) BigInt(input.tiers[k]);
    const rec: LaunchRecord = {
      ...input,
      createdAt: this.now(),
      registrations: [],
      disputes: [],
      overrides: [],
      allowlist: null,
      onchain: null,
    };
    this.d.store.save(rec);
    return rec;
  }

  async register(slug: string, walletIn: string, signature: Hex) {
    const rec = this.get(slug);
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const wallet = getAddress(walletIn);
    if (this.now() >= rec.registrationClosesAt) throw new LaunchError("registration is closed");
    const existing = rec.registrations.find((r) => r.wallet === wallet);
    if (existing) return { wallet, registeredAt: existing.at, alreadyRegistered: true };
    const ok = await this.d.verify(wallet, registrationMessage(slug, wallet, rec.chainId), signature);
    if (!ok) throw new LaunchError("signature does not match wallet", 401);
    rec.registrations.push({ wallet, signature, at: this.now() });
    this.d.store.save(rec);
    return { wallet, registeredAt: this.now(), alreadyRegistered: false };
  }

  /** Registrations → nonces + funding trace → clusters (with dispute overrides) → tiers → root + evidence. */
  async build(slug: string) {
    const rec = this.get(slug);
    if (rec.onchain && this.now() >= rec.onchain.windowStart) throw new LaunchError("window has started; allowlist is frozen");
    if (rec.registrations.length === 0) throw new LaunchError("no registrations");
    const rpc = this.d.rpc();
    const history = this.d.history(rpc);
    const snapshot = BigInt(await rpc.call<Hex>("eth_blockNumber", []));
    const blockTime = await measureBlockTime(rpc, snapshot);
    const windowBlocks =
      blockTime > 0 ? BigInt(Math.ceil((this.d.fundingWindowHours * 3600) / blockTime)) : snapshot;
    const wallets = rec.registrations.map((r) => r.wallet);

    const profiles: WalletProfile[] = await Promise.all(
      wallets.map(async (wallet) => ({
        wallet,
        nonce: Number(BigInt(await rpc.call<Hex>("eth_getTransactionCount", [wallet, hex(snapshot)]))),
      })),
    );
    const traced = await traceFunding(
      history,
      wallets.map((wallet) => ({ wallet, beforeBlock: snapshot })),
      { windowBlocks, excluded: this.d.excluded, maxHops: 2 },
    );
    // Accepted "unlink" disputes: the wallet's own funding edges no longer count, in either direction.
    const unlinked = new Set(rec.overrides.filter((o) => o.action === "unlink").map((o) => o.wallet.toLowerCase()));
    const edges = traced.edges.filter((e) => !unlinked.has(e.to.toLowerCase()) && !unlinked.has(e.from.toLowerCase()));
    const clusters = clusterByFunding(wallets, edges, { maxHops: 2, excluded: this.d.excluded });

    const out = buildAllowlist({
      launch: { chainId: rec.chainId, launchId: slug, snapshotBlock: snapshot.toString() },
      tiers: {
        capWei: BigInt(rec.tiers.capWei),
        freshPoolCapWei: BigInt(rec.tiers.freshPoolCapWei),
        verifiedCapWei: BigInt(rec.tiers.verifiedCapWei),
        freshMaxNonce: rec.tiers.freshMaxNonce,
      },
      wallets: profiles,
      clusters,
      method: {
        heuristic: "shared native-ETH funder within 2 hops, in the window before the snapshot",
        fundingWindowHours: this.d.fundingWindowHours,
        measuredBlockTimeSec: blockTime,
        historyProvider: history.name,
        exclusions: this.d.exclusionsSource,
        overrides: rec.overrides,
        disputes: rec.disputes.map((x) => ({ id: x.id, wallet: x.wallet, status: x.status, resolution: x.resolution })),
      },
    });
    const version = (rec.allowlist?.version ?? 0) + 1;
    this.d.store.saveVersion(slug, version, out.entries, out.evidenceJson);
    rec.allowlist = {
      version,
      root: out.root,
      evidenceHash: out.evidenceHash,
      stats: out.stats,
      builtAt: this.now(),
      snapshotBlock: snapshot.toString(),
    };
    this.d.store.save(rec);
    return rec.allowlist;
  }

  /** The version whose root is (or will be) onchain. */
  private liveVersion(rec: LaunchRecord): number {
    if (rec.onchain) return rec.onchain.rootVersion;
    if (!rec.allowlist) throw new LaunchError("allowlist not built yet", 404);
    return rec.allowlist.version;
  }

  entries(slug: string): AllowlistEntry[] {
    const rec = this.get(slug);
    return this.d.store.entries(slug, this.liveVersion(rec));
  }

  evidence(slug: string, version?: number): string {
    const rec = this.get(slug);
    return this.d.store.evidence(slug, version ?? this.liveVersion(rec));
  }

  proof(slug: string, walletIn: string): AllowlistEntry {
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const w = getAddress(walletIn);
    const e = this.entries(slug).find((x) => x.wallet === w);
    if (!e) throw new LaunchError("wallet is not on the allowlist", 404);
    return e;
  }

  /** What one wallet needs to see: registered? on the allowlist (live version)? its entry. */
  walletStatus(slug: string, walletIn: string) {
    if (!isAddress(walletIn)) throw new LaunchError("invalid wallet");
    const w = getAddress(walletIn);
    const rec = this.get(slug);
    const reg = rec.registrations.find((r) => r.wallet === w) ?? null;
    let entry: AllowlistEntry | null = null;
    let entityMembers: number | null = null;
    if (rec.allowlist) {
      const all = this.entries(slug);
      entry = all.find((x) => x.wallet === w) ?? null;
      if (entry) entityMembers = all.filter((x) => x.entityId === entry!.entityId).length;
    }
    const disputes = rec.disputes.filter((d) => d.wallet === w).map(({ signature: _s, ...d }) => d);
    return { wallet: w, registered: !!reg, registeredAt: reg?.at ?? null, entry, entityMembers, disputes };
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
    const d: Dispute = {
      id: `D${rec.disputes.length + 1}`,
      wallet,
      reason: text,
      signature,
      at: this.now(),
      status: "open",
      resolution: null,
    };
    rec.disputes.push(d);
    this.d.store.save(rec);
    return d;
  }

  /** Admin decision. `unlink` makes the next build ignore the wallet's funding links. */
  resolveDispute(slug: string, id: string, accept: boolean, note: string, unlink: boolean) {
    const rec = this.get(slug);
    const d = rec.disputes.find((x) => x.id === id);
    if (!d) throw new LaunchError("dispute not found", 404);
    d.status = accept ? "accepted" : "rejected";
    d.resolution = note || null;
    if (accept && unlink && !rec.overrides.some((o) => o.wallet === d.wallet)) {
      rec.overrides.push({ wallet: d.wallet, action: "unlink", disputeId: d.id });
    }
    this.d.store.save(rec);
    return d;
  }

  attachOnchain(slug: string, onchain: NonNullable<LaunchRecord["onchain"]>) {
    const rec = this.get(slug);
    rec.onchain = onchain;
    this.d.store.save(rec);
    return rec;
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
      tiers: rec.tiers,
      window: rec.window,
      registrations: rec.registrations.length,
      disputes: rec.disputes.map(({ signature: _s, ...x }) => x),
      allowlist: rec.allowlist,
      onchain: rec.onchain,
    };
  }
}
