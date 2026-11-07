"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { Addr, Notice, Stat, Tx } from "@/components/bits";
import { ClusterMap } from "@/components/ClusterMap";
import { api, ApiError } from "@/lib/api";
import { SCAN_EXPLORER } from "@/lib/config";
import { duration, eth, pct, tokens } from "@/lib/format";
import type { ScanResult } from "@/lib/types";

export function ScanClient() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const token = params.get("token") ?? "";
  const cap = params.get("cap") ?? "";
  const [input, setInput] = useState(token);
  const [capInput, setCapInput] = useState(cap);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    if (!isAddress(token)) {
      setError("That is not a token address.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const q = cap ? `?cap=${encodeURIComponent(cap)}` : "";
    api<ScanResult>(`/scan/${token}${q}`)
      .then(setResult)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, cap]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ token: input.trim() });
    if (capInput.trim()) q.set("cap", capInput.trim());
    router.push(`${path}?${q.toString()}`);
  };

  return (
    <>
      <form onSubmit={submit} className="card" style={{ marginTop: 22 }}>
        <div className="row">
          <input
            aria-label="Token address"
            placeholder="0x… token address on Base"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mono"
            spellCheck={false}
          />
          <button className="btn" disabled={loading || !input.trim()}>
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>
        <details style={{ marginTop: 12, border: 0, padding: 0, background: "none" }}>
          <summary className="small muted">Cap used for the counterfactual</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              aria-label="Cap per entity in ETH"
              placeholder="ETH per entity (server default if empty)"
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              inputMode="decimal"
            />
          </div>
        </details>
      </form>

      {loading && (
        <Notice>
          Tracing the funding of every early buyer, two hops back. This takes longer the first time a token is scanned.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {result && <ScanView r={result} />}
    </>
  );
}

function ScanView({ r }: { r: ScanResult }) {
  const s = r.summary;
  const capEth = eth(r.method.caps.capWei);
  const freshEth = eth(r.method.caps.freshPoolCapWei);
  const blockedShare =
    BigInt(s.kin.attemptedWei) > 0n ? Number((BigInt(s.kin.blockedWei) * 10_000n) / BigInt(s.kin.attemptedWei)) : null;
  return (
    <section style={{ marginTop: 26 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>
          {r.name ?? "Unknown token"} {r.symbol && <span className="muted">${r.symbol}</span>}
        </h2>
        <span className="small faint">
          <Addr address={r.token} explorer={SCAN_EXPLORER} n={6} /> · scanned {new Date(r.scannedAt).toLocaleString()}
        </span>
      </div>

      <div className="stats">
        <Stat label="early buyers scanned" value={s.earlyBuyers} />
        <Stat
          label="multi-wallet entities"
          value={s.multiWalletEntities}
          sub={`${s.walletsInMultiWalletEntities} wallets in them`}
          tone={s.multiWalletEntities ? "bad" : "good"}
        />
        <Stat label="of early buys held by those entities" value={pct(s.multiWalletShareOfEarlyBps)} sub={s.multiWalletShareOfSupplyBps !== null ? `${pct(s.multiWalletShareOfSupplyBps, 2)} of total supply` : undefined} />
        <Stat
          label={`Kin would have rejected (cap ${capEth} ETH)`}
          value={`${eth(s.kin.blockedWei)} ETH`}
          sub={`${s.kin.blockedBuys} buys${blockedShare !== null ? ` · ${pct(blockedShare)} of ETH spent` : ""}`}
          tone="accent"
        />
      </div>

      {r.entities.length === 0 ? (
        <Notice>
          No multi-wallet entities among the first {s.earlyBuyers} buyers: no two of them share a funder within{" "}
          {r.method.maxHops} hops in the {r.method.fundingWindowHours} hours before they bought.
        </Notice>
      ) : (
        <>
          <h2>Entities</h2>
          {r.entities.map((e) => (
            <EntityCard key={e.id} e={e} decimals={r.decimals ?? 18} capEth={capEth} />
          ))}
        </>
      )}

      <h2>Early buyers</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Kin tier</th>
              <th>Entity</th>
              <th className="num">ETH spent</th>
              <th className="num">Tokens</th>
              <th>First buy</th>
            </tr>
          </thead>
          <tbody>
            {r.buyers.map((b) => (
              <tr key={b.wallet}>
                <td>
                  <Addr address={b.wallet} explorer={SCAN_EXPLORER} />
                </td>
                <td>
                  <span className={`pill pill-${b.tier}`}>{b.tier === "fresh" ? `fresh pool` : b.tier}</span>
                </td>
                <td className="mono small">{b.entity.startsWith("W:") ? "own" : b.entity}</td>
                <td className="num">{BigInt(b.ethSpentWei) > 0n ? eth(b.ethSpentWei) : "—"}</td>
                <td className="num">{tokens(b.tokens, r.decimals ?? 18)}</td>
                <td>
                  <Tx hash={b.firstBuyTx} explorer={SCAN_EXPLORER} label={`block ${b.firstBuyBlock}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Method</h2>
      <details>
        <summary>How this scan was computed</summary>
        <ul className="small muted">
          <li>Early buyers: the first {r.method.earlyBuyers} wallets that received the token in a transaction they sent themselves, excluding the token&apos;s creation transaction.</li>
          <li>Links: two wallets share a native-ETH funder within {r.method.maxHops} hops in the {r.method.fundingWindowHours} hours before their first buy. Labelled exchange, bridge and router addresses never link.</li>
          <li>Tiers as Kin would assign them: linked wallets share one {capEth} ETH cap; unlinked wallets with no prior transactions share one {freshEth} ETH fresh-pool cap; other wallets get their own {capEth} ETH cap.</li>
          <li>Counterfactual: the observed buys replayed in chain order; a buy is rejected if it would take its entity past the cap. Buys paid in a token rather than ETH are not counted ({s.kin.unknownBuys} here).</li>
          <li>
            Cost of this scan: {r.cost.totalCalls} requests, {(r.cost.elapsedMs / 1000).toFixed(1)} s.
          </li>
        </ul>
      </details>
    </section>
  );
}

function EntityCard({ e, decimals, capEth }: { e: ScanResult["entities"][number]; decimals: number; capEth: string }) {
  const landed = Number(BigInt(e.kin.landedWei));
  const blocked = Number(BigInt(e.kin.blockedWei));
  const total = landed + blocked || 1;
  return (
    <div className="card">
      <div className="entity">
        <ClusterMap entity={e} />
        <div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              {e.id} · {e.members.length} wallets
            </h3>
            <span className="pill pill-linked">one entity</span>
          </div>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Share of early buys</dt>
            <dd>
              {pct(e.shareOfEarlyBps)} ({tokens(e.tokens, decimals)} tokens)
            </dd>
            <dt>Shared funder{e.funders.length > 1 ? "s" : ""}</dt>
            <dd>
              {e.funders.map((f, i) => (
                <span key={f}>
                  {i > 0 && ", "}
                  <Addr address={f} explorer={SCAN_EXPLORER} />
                </span>
              ))}
            </dd>
            {e.medianFundToBuySeconds !== null && (
              <>
                <dt>Funded → first buy</dt>
                <dd>median {duration(e.medianFundToBuySeconds)}</dd>
              </>
            )}
            {e.sameBlockBuyers > 0 && (
              <>
                <dt>Same-block buyers</dt>
                <dd>{e.sameBlockBuyers}</dd>
              </>
            )}
            <dt>With Kin</dt>
            <dd>
              {e.kin.landedBuys} buys land ({eth(e.kin.landedWei)} ETH), {e.kin.blockedBuys} rejected ({eth(e.kin.blockedWei)} ETH) under one {capEth} ETH cap
              <div className="bar" style={{ marginTop: 6 }} aria-hidden>
                <span style={{ width: `${(landed / total) * 100}%`, background: "var(--good)" }} />
                <span style={{ width: `${(blocked / total) * 100}%`, background: "var(--bad)" }} />
              </div>
            </dd>
          </dl>
        </div>
      </div>
      <details style={{ marginTop: 14 }}>
        <summary>Evidence: {e.links.length} links</summary>
        <ul className="evidence">
          {e.links.map((l, i) => (
            <li key={i}>
              <Addr address={l.a} explorer={SCAN_EXPLORER} /> and <Addr address={l.b} explorer={SCAN_EXPLORER} />{" "}
              {l.reason === "same_block_early_buy" ? (
                <>bought in the same early block {l.block}</>
              ) : l.reason === "direct_funding" ? (
                <>: one funded the other</>
              ) : (
                <>
                  {l.reason === "same_direct_funder" ? "were funded by" : "share the funding source"}{" "}
                  {l.via && <Addr address={l.via} explorer={SCAN_EXPLORER} />}
                  <span className="faint"> ({l.hops[0]} / {l.hops[1]} hops)</span>
                </>
              )}
              <span className="faint"> weight {l.weight}</span>
              <span>
                {l.txHashes.map((h, j) => (
                  <span key={h}>
                    {j > 0 && " · "}
                    <Tx hash={h} explorer={SCAN_EXPLORER} />
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
