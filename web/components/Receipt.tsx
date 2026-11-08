"use client";

import { useEffect, useState } from "react";
import { keccak256, toBytes, type Hex } from "viem";
import { useReadContract } from "wagmi";
import { Notice, Tx } from "@/components/bits";
import { kinHookAbi } from "@/lib/abi";
import { api, ApiError } from "@/lib/api";
import { API_URL, DEPLOYMENT, LAUNCH_EXPLORER } from "@/lib/config";
import { eth, pct } from "@/lib/format";
import type { LaunchView } from "@/lib/types";

interface OnchainReceipt {
  finalized: boolean;
  finalizedAt: bigint;
  root: Hex;
  evidenceHash: Hex;
  window: {
    totalVolume: bigint;
    largestEntitySpend: bigint;
    largestEntity: Hex;
    buyerWallets: number;
    buyingEntities: number;
    buys: number;
  };
  largestEntityShareBps: bigint;
  allowlist: { allowlistedWallets: number; entities: number; linkedWallets: number; freshWallets: number };
  totalSupply: bigint;
  creatorAllocation: bigint;
}

/**
 * The Fairness Receipt, read straight from KinHook.getReceipt(poolId). Numbers recorded onchain from
 * window buys; allowlist numbers committed with the evidence hash, which is checked against the file.
 */
export function Receipt({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const [launch, setLaunch] = useState<LaunchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<Hex | null>(null);
  useEffect(() => {
    api<LaunchView>(`/launches/${slug}`).then(setLaunch).catch((e: ApiError) => setError(e.message));
    if (API_URL)
      fetch(`${API_URL}/launches/${slug}/evidence.json`)
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((t) => setFileHash(keccak256(toBytes(t))))
        .catch(() => {});
  }, [slug]);
  const o = launch?.onchain;
  const read = useReadContract({
    address: DEPLOYMENT?.kinHook,
    abi: kinHookAbi,
    functionName: "getReceipt",
    args: o ? [o.poolId] : undefined,
    query: { enabled: !!DEPLOYMENT && !!o },
  });

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!launch) return <p className="muted">Loading…</p>;
  if (!o) return <Notice>This launch is not onchain yet, so there is no receipt.</Notice>;
  if (!DEPLOYMENT) return <Notice tone="warn">Contract addresses are not configured for this site.</Notice>;
  if (read.isError) return <Notice tone="error">Could not read the receipt from the chain.</Notice>;
  const r = read.data as OnchainReceipt | undefined;
  if (!r) return <p className="muted">Reading the chain…</p>;

  const evidenceOk = fileHash ? fileHash.toLowerCase() === r.evidenceHash.toLowerCase() : null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>
          Fairness Receipt · {launch.name} <span className="muted">${launch.symbol}</span>
        </h3>
        <span className={`pill ${r.finalized ? "pill-aged" : "pill-fresh"}`}>{r.finalized ? "final" : "window still open"}</span>
      </div>
      <div className="stats" style={{ margin: "14px 0" }}>
        <div className="stat">
          <div className="stat-value">{eth(r.window.totalVolume)} ETH</div>
          <div className="stat-label">bought in the window</div>
        </div>
        <div className="stat">
          <div className="stat-value">{r.window.buyingEntities}</div>
          <div className="stat-label">entities bought</div>
          <div className="stat-sub">{r.window.buyerWallets} wallets</div>
        </div>
        <div className="stat">
          <div className="stat-value">{pct(Number(r.largestEntityShareBps))}</div>
          <div className="stat-label">largest entity&apos;s share</div>
        </div>
        {!compact && (
          <div className="stat">
            <div className="stat-value">{r.allowlist.linkedWallets}</div>
            <div className="stat-label">wallets linked into multi-wallet entities</div>
            <div className="stat-sub">{r.allowlist.freshWallets} in the fresh pool</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-value">{r.totalSupply > 0n ? pct(Number((r.creatorAllocation * 10_000n) / r.totalSupply)) : "n/a"}</div>
          <div className="stat-label">of supply kept by the creator</div>
          <div className="stat-sub">outside every cap</div>
        </div>
      </div>
      <dl className="kv small">
        {compact && (
          <>
            <dt>Linked / fresh wallets</dt>
            <dd>
              {r.allowlist.linkedWallets} / {r.allowlist.freshWallets}
            </dd>
          </>
        )}
        <dt>Merkle root</dt>
        <dd className="mono">{r.root}</dd>
        <dt>Evidence hash</dt>
        <dd className="mono">{r.evidenceHash}</dd>
        <dt>Evidence check</dt>
        <dd>
          {evidenceOk === null ? (
            <span className="faint">evidence file not reachable</span>
          ) : evidenceOk ? (
            <span className="check-ok">✓ published file matches</span>
          ) : (
            <span className="check-bad">✕ published file does not match</span>
          )}
        </dd>
        {!compact && (
          <>
            <dt>Window</dt>
            <dd>
              {new Date(o.windowStart * 1000).toLocaleString()} → {new Date(o.windowEnd * 1000).toLocaleString()}
            </dd>
            <dt>Launch tx</dt>
            <dd>
              <Tx hash={o.launchTx} explorer={LAUNCH_EXPLORER} />
            </dd>
            <dt>Source</dt>
            <dd>
              KinHook.getReceipt on chain {launch.chainId}; window values are recorded by the hook, allowlist values are
              committed with the evidence hash.
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
