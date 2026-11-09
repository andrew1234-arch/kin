"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, http, type Hex } from "viem";
import { Addr, Notice, Stat, Tx } from "@/components/bits";
import { kinHookAbi } from "@/lib/abi";
import { api, ApiError } from "@/lib/api";
import { API_URL, DEPLOYMENT, LAUNCH_EXPLORER, LAUNCH_RPC_URL, launchChain } from "@/lib/config";
import { eth, short } from "@/lib/format";
import type { LaunchView } from "@/lib/types";

interface Assignment {
  wallet: string;
  entityId: Hex;
  tier: "linked" | "fresh" | "aged";
  cap: string;
  at: number;
  links: { from: string; to: string; txHash: string; hop: 1 | 2 }[];
  via?: string;
}
interface Entity {
  id: Hex;
  n: number;
  tier: Assignment["tier"];
  members: Assignment[];
  cap: bigint;
  spent: bigint | null;
  funders: string[];
}

const client = createPublicClient({ chain: launchChain, transport: http(LAUNCH_RPC_URL || undefined) });

/**
 * Kin Scan for launches on Kin: every wallet that got a limit, grouped into the buyers Kin sees, with each buyer's
 * spend read from the hook. Everything here is public: the engine's assignments and the pool's own records.
 */
export function LaunchScan({ launch }: { launch: LaunchView }) {
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [spent, setSpent] = useState<Record<string, bigint>>({});

  useEffect(() => {
    setErr(null);
    setRows(null);
    setSpent({});
    api<Assignment[]>(`/launches/${launch.slug}/permits`)
      .then(async (r) => {
        setRows(r);
        if (!DEPLOYMENT || !launch.onchain) return;
        const ids = [...new Set(r.map((a) => a.entityId))];
        const out: Record<string, bigint> = {};
        await Promise.all(
          ids.map(async (id) => {
            out[id] = (await client
              .readContract({ address: DEPLOYMENT!.kinHook, abi: kinHookAbi, functionName: "entitySpent", args: [launch.onchain!.poolId, id] })
              .catch(() => 0n)) as bigint;
          }),
        );
        setSpent(out);
      })
      .catch((e: ApiError) => setErr(e.message));
  }, [launch]);

  const entities = useMemo<Entity[]>(() => {
    if (!rows) return [];
    const map = new Map<string, Entity>();
    for (const a of rows) {
      const e = map.get(a.entityId) ?? { id: a.entityId, n: 0, tier: a.tier, members: [], cap: BigInt(a.cap), spent: null, funders: [] };
      e.members.push(a);
      for (const l of a.links) if (l.hop === 1 && !e.funders.includes(l.from)) e.funders.push(l.from);
      map.set(a.entityId, e);
    }
    let n = 0;
    return [...map.values()].map((e) => ({ ...e, n: e.members.length > 1 ? ++n : 0, spent: spent[e.id] ?? null }));
  }, [rows, spent]);

  if (err) return <Notice tone="error">{err}</Notice>;

  const multi = entities.filter((e) => e.members.length > 1);
  const linkedWallets = multi.reduce((t, e) => t + e.members.length, 0);
  const totalSpent = entities.reduce((t, e) => t + (e.spent ?? 0n), 0n);
  const full = entities.filter((e) => e.spent !== null && e.spent >= e.cap && e.cap > 0n).length;
  const byEntity = new Map(entities.map((e) => [e.id, e]));

  return (
    <div className="lscan">
      <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
        <h2 style={{ margin: 0 }}>
          {launch.name} <span className="muted">${launch.symbol}</span>{" "}
          <span className="pill pill-accent" style={{ verticalAlign: "middle" }}>
            Kin launch
          </span>
        </h2>
        <span className="small">
          <Link href={`/launch/${launch.slug}`}>Open the launch</Link> ·{" "}
          <a href={`${API_URL}/launches/${launch.slug}/permits`} target="_blank" rel="noreferrer">
            Raw data
          </a>
        </span>
      </div>

      {!rows ? (
        <p className="muted">Reading the launch…</p>
      ) : rows.length === 0 ? (
        <Notice>No wallet has asked for a limit in this launch yet.</Notice>
      ) : (
        <>
          <div className="stats">
            <Stat label="wallets got a limit" value={rows.length} />
            <Stat label="buyers, as Kin sees them" value={entities.length} sub={`${rows.length - entities.length} wallets folded into others`} tone="accent" />
            <Stat label="wallets sharing a funder" value={linkedWallets} sub={`in ${multi.length} group${multi.length === 1 ? "" : "s"}`} tone={linkedWallets ? "bad" : "good"} />
            <Stat label="bought in the window" value={`${eth(totalSpent, 6)} ETH`} sub={`${full} buyer${full === 1 ? "" : "s"} hit their limit`} />
          </div>

          <figure className="card buyer-map">
            <figcaption>
              <strong>Every wallet, in the order it asked for a limit.</strong>{" "}
              <span className="muted">Numbered wallets were funded from the same place, so Kin counts each group as one buyer.</span>
            </figcaption>
            <div className="bm-dots">
              {rows.map((a, i) => {
                const e = byEntity.get(a.entityId)!;
                const kind = e.n ? "linked" : a.tier === "fresh" ? "fresh" : "own";
                const capped = e.spent !== null && e.spent >= e.cap && e.cap > 0n;
                return (
                  <span
                    key={a.wallet}
                    className={`bm-dot is-${kind}${capped && e.n ? " is-full" : ""}`}
                    style={{ animationDelay: `${Math.min(i, 80) * 18}ms` }}
                    title={`${a.wallet} · ${e.n ? `group ${e.n}, ` : ""}limit ${eth(a.cap, 6)} ETH${capped ? " · limit reached" : ""}`}
                  >
                    {e.n || ""}
                  </span>
                );
              })}
            </div>
            <ul className="bm-legend small muted">
              <li>
                <span className="bm-dot is-linked">1</span> funded from the same place as others
              </li>
              <li>
                <span className="bm-dot is-linked is-full">1</span> its group used the whole limit
              </li>
              <li>
                <span className="bm-dot is-fresh" /> brand-new wallet
              </li>
              <li>
                <span className="bm-dot is-own" /> its own buyer
              </li>
            </ul>
          </figure>

          {multi.length > 0 && (
            <>
              <h2>Wallets Kin counted as one buyer</h2>
              <div className="lscan-groups">
                {multi.map((e) => {
                  const used = e.spent ?? 0n;
                  const w = e.cap > 0n ? Math.min(100, Number((used * 10000n) / e.cap) / 100) : 0;
                  return (
                    <div key={e.id} className="card lscan-group">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <h3 style={{ margin: 0 }}>
                          Group {e.n} · {e.members.length} wallets
                        </h3>
                        {used >= e.cap && e.cap > 0n && <span className="pill pill-linked">limit reached</span>}
                      </div>
                      <GroupFig members={e.members.length} fill={w / 100} />
                      <p className="small muted" style={{ margin: "0 0 8px" }}>
                        {e.funders.length ? (
                          <>
                            Funded by{" "}
                            {e.funders.slice(0, 2).map((f, i) => (
                              <span key={f}>
                                {i > 0 && ", "}
                                <Addr address={f} explorer={LAUNCH_EXPLORER} />
                              </span>
                            ))}
                            {e.funders.length > 2 && ` and ${e.funders.length - 2} more`}
                          </>
                        ) : (
                          "Linked through an earlier buyer"
                        )}
                      </p>
                      <div className="lscan-bar" aria-label={`${eth(used, 6)} of ${eth(e.cap, 6)} ETH used`}>
                        <span style={{ width: `${w}%` }} className={used >= e.cap ? "is-full" : ""} />
                      </div>
                      <p className="small" style={{ margin: "6px 0 0" }}>
                        {e.spent === null ? "Reading the pool…" : `${eth(used, 6)} of ${eth(e.cap, 6)} ETH used, all wallets together`}
                      </p>
                      <details style={{ marginTop: 10 }}>
                        <summary className="small">The wallets and the transfers that link them</summary>
                        <ul className="evidence small">
                          {e.members.map((m) => (
                            <li key={m.wallet}>
                              <Addr address={m.wallet} explorer={LAUNCH_EXPLORER} />
                              {m.links
                                .filter((l) => l.hop === 1)
                                .slice(0, 2)
                                .map((l) => (
                                  <span key={l.txHash}>
                                    {" "}
                                    ← {short(l.from)} <Tx hash={l.txHash} explorer={LAUNCH_EXPLORER} />
                                  </span>
                                ))}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One group: a funder, its wallets, and the shared limit bar they all draw from. */
function GroupFig({ members, fill }: { members: number; fill: number }) {
  const n = Math.min(members, 8);
  const ys = Array.from({ length: n }, (_, i) => 40 + (i - (n - 1) / 2) * Math.min(14, 64 / Math.max(1, n - 1)));
  return (
    <svg className="group-fig" viewBox="0 0 240 80" aria-hidden="true">
      <circle cx={20} cy={40} r={8} className="tf-src" />
      {ys.map((y, i) => (
        <g key={i}>
          <path d={`M 28 40 C 60 40 60 ${y} 92 ${y}`} className="tf-edge" />
          <circle cx={98} cy={y} r={5} className="tf-w is-linked" />
          <path d={`M 104 ${y} C 140 ${y} 150 40 182 40`} className="tf-edge" />
        </g>
      ))}
      <rect x={186} y={10} width={16} height={60} rx={4} className="tf-track" />
      <rect x={186} y={70 - 60 * fill} width={16} height={60 * fill} rx={4} className="tf-fill" />
      <line x1={180} x2={208} y1={10} y2={10} className="gf-limit" />
    </svg>
  );
}
