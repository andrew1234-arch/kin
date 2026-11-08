import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import type { AllowlistEntry, AllowlistStats } from "../allowlist/build";
import type { PermitAssignment } from "./instant";

/**
 * One launch's offchain state, under DATA_DIR/launches/<slug>/: launch.json (everything but registrations) and
 * registrations.jsonl (one line per registration, append-only). Every change goes through `update`, which holds a
 * lock file across read-modify-write, so concurrent requests and the admin CLI (another process) can't overwrite
 * each other's changes.
 */
export interface LaunchRecord {
  slug: string;
  /**
   * "allowlist" (default): registration, then a Merkle allowlist committed before the window.
   * "instant": no registration; each buyer's funding is traced when they buy and the engine signs a permit.
   */
  mode?: "allowlist" | "instant";
  /** Instant launches: every entity assignment, in issue order (append-only, public). */
  permits?: PermitAssignment[];
  /** Instant launches: the published policy file; its keccak256 is the evidenceHash committed onchain. */
  instant?: { policyJson: string; evidenceHash: Hex };
  chainId: number;
  name: string;
  symbol: string;
  createdAt: number;
  /** Registrations are accepted until this unix time. Building the allowlist closes registration. */
  registrationClosesAt: number;
  /** Minimum launch-chain balance a wallet must hold to register (wei); makes mass key registration cost something. */
  minBalanceWei?: string;
  tiers: { capWei: string; freshPoolCapWei: string; verifiedCapWei: string; freshMaxNonce: number; freshMaxAgeHours?: number };
  window: { delayAfterBuildSec: number; lengthSec: number; lockSec: number };
  registrations: { wallet: Address; signature: Hex; at: number }[];
  /** Base Verify results: the wallet and a hash of its (account, launch) token. Absent in older records. */
  verifications?: { wallet: Address; tokenHash: Hex; at: number }[];
  disputes: Dispute[];
  /** Admin decisions from accepted disputes, applied on every rebuild. */
  overrides: { wallet: Address; action: "unlink"; disputeId: string }[];
  /** Root of every version ever built, so proofs can be served for whichever root is actually onchain. */
  versions?: { version: number; root: Hex }[];
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
    /** The v4 PoolKey, needed by KinRouter.swapExactIn. */
    key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
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
    if (!existsSync(p)) return null;
    const rec = JSON.parse(readFileSync(p, "utf8")) as LaunchRecord;
    const regs = this.path(slug, "registrations.jsonl");
    // Records written before registrations.jsonl existed keep their registrations inline until the next save.
    rec.registrations = existsSync(regs) ? readLines(regs) : (rec.registrations ?? []);
    return rec;
  }

  /** Create a launch; fails if it already exists. */
  create(rec: LaunchRecord) {
    mkdirSync(join(this.path(rec.slug), ".."), { recursive: true });
    return this.withLock(rec.slug, () => {
      if (existsSync(this.path(rec.slug))) return false;
      this.write(rec);
      return true;
    });
  }

  /**
   * Locked read-modify-write. `fn` runs synchronously on the current record; whatever it changes is saved (new
   * registrations are appended, never rewritten). Throwing from `fn` saves nothing.
   */
  update<T>(slug: string, fn: (rec: LaunchRecord) => T): T {
    return this.withLock(slug, () => {
      const rec = this.get(slug);
      if (!rec) throw new Error("launch not found");
      const out = fn(rec);
      this.write(rec);
      return out;
    });
  }

  private write(rec: LaunchRecord) {
    const regsPath = this.path(rec.slug, "registrations.jsonl");
    const stored = existsSync(regsPath) ? readLines(regsPath).length : 0;
    if (rec.registrations.length < stored) throw new Error("registrations are append-only");
    const added = rec.registrations.slice(stored);
    if (added.length > 0 || !existsSync(regsPath)) {
      appendFileSync(regsPath, added.map((r) => JSON.stringify(r) + "\n").join(""));
    }
    const { registrations: _r, ...rest } = rec;
    writeAtomic(this.path(rec.slug), JSON.stringify(rest, null, 2));
  }

  private withLock<T>(slug: string, fn: () => T): T {
    const lock = this.path(slug, "launch.lock");
    const deadline = Date.now() + 10_000;
    let fd: number | null = null;
    while (fd === null) {
      try {
        fd = openSync(lock, "wx");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        // A lock older than 30 s belongs to a crashed process: every holder finishes in milliseconds.
        try {
          if (Date.now() - statSync(lock).mtimeMs > 30_000) unlinkSync(lock);
        } catch {}
        if (Date.now() > deadline) throw new Error(`launch ${slug} is locked; try again`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
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

function readLines<T>(p: string): T[] {
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function writeAtomic(p: string, data: string) {
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, p);
}
