import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import type { AllowlistEntry, AllowlistStats } from "../allowlist/build";

/** One launch's offchain state. Stored as JSON files under DATA_DIR/launches/<slug>/. */
export interface LaunchRecord {
  slug: string;
  chainId: number;
  name: string;
  symbol: string;
  createdAt: number;
  /** Registrations are accepted until this unix time. */
  registrationClosesAt: number;
  tiers: { capWei: string; freshPoolCapWei: string; verifiedCapWei: string; freshMaxNonce: number };
  window: { delayAfterBuildSec: number; lengthSec: number; lockSec: number };
  registrations: { wallet: Address; signature: Hex; at: number }[];
  disputes: Dispute[];
  /** Admin decisions from accepted disputes, applied on every rebuild. */
  overrides: { wallet: Address; action: "unlink"; disputeId: string }[];
  allowlist: null | {
    version: number;
    root: Hex;
    evidenceHash: Hex;
    stats: AllowlistStats;
    builtAt: number;
    snapshotBlock: string;
  };
  onchain: null | {
    poolId: Hex;
    token: Address;
    launchTx: Hex;
    windowStart: number;
    windowEnd: number;
    lockDuration: number;
    rootVersion: number;
  };
}

export interface Dispute {
  id: string;
  wallet: Address;
  reason: string;
  signature: Hex;
  at: number;
  status: "open" | "accepted" | "rejected";
  resolution: string | null;
}

export class LaunchStore {
  constructor(private readonly dir: string) {
    mkdirSync(join(dir, "launches"), { recursive: true });
  }

  private path(slug: string, file = "launch.json") {
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) throw new Error("invalid launch slug");
    return join(this.dir, "launches", slug, file);
  }

  list(): LaunchRecord[] {
    const base = join(this.dir, "launches");
    return readdirSync(base)
      .filter((d) => existsSync(join(base, d, "launch.json")))
      .map((d) => this.get(d)!)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(slug: string): LaunchRecord | null {
    const p = this.path(slug);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as LaunchRecord) : null;
  }

  save(rec: LaunchRecord) {
    const p = this.path(rec.slug);
    mkdirSync(join(p, ".."), { recursive: true });
    writeAtomic(p, JSON.stringify(rec, null, 2));
  }

  /** Allowlist entries and the evidence file (exact bytes) for one version. */
  saveVersion(slug: string, version: number, entries: AllowlistEntry[], evidenceJson: string) {
    writeAtomic(this.path(slug, `allowlist-v${version}.json`), JSON.stringify(entries));
    writeAtomic(this.path(slug, `evidence-v${version}.json`), evidenceJson);
  }

  entries(slug: string, version: number): AllowlistEntry[] {
    return JSON.parse(readFileSync(this.path(slug, `allowlist-v${version}.json`), "utf8"));
  }

  evidence(slug: string, version: number): string {
    return readFileSync(this.path(slug, `evidence-v${version}.json`), "utf8");
  }
}

function writeAtomic(p: string, data: string) {
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, p);
}
