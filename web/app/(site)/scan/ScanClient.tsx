"use client";

import { useEffect, useState } from "react";
import { Addr, Notice, Stat, Tx } from "@/components/bits";
import { ClusterMap } from "@/components/ClusterMap";
import { api, ApiError } from "@/lib/api";
import { SCAN_EXPLORER } from "@/lib/config";
import { duration, eth, pct, tokens } from "@/lib/format";
import type { ScanResult } from "@/lib/types";

/**
 * Kin Scan for any token on Base mainnet: its early buyers grouped by shared funding, and what Kin's limit would have
 * refused. A busy token's first scan can take minutes, so the engine answers "running" and this polls until it's done.
 */
export function TokenScan({ token, cap }: { token: string; cap?: string }) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    setStartedAt(Date.now());
    const q = cap ? `?cap=${encodeURIComponent(cap)}` : "";
    (async () => {
      for (;;) {
        try {
          const r = await api<ScanResult | { status: "running" }>(`/scan/${token}${q}`);
          if (!live) return;
          if ("status" in r) {
            await new Promise((res) => setTimeout(res, 2500));
            if (!live) return;
            continue;
          }
          setResult(r);
        } catch (e) {
          if (live) setError((e as ApiError).message);
        }
        return;
      }
    })().finally(() => live && setStartedAt(null));
    return () => {
      live = false;
    };
  }, [token, cap]);

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!result) {
    const secs = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    return (
      <div className="card scan-wait" aria-live="polite">
        <span className="scan-wait-dot" aria-hidden="true" />
        <div>
          <strong>Reading this token&apos;s first buyers and tracing who funded each one{secs > 2 ? ` · ${secs} s` : ""}</strong>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {secs < 25
              ? "Base mainnet, two funding hops back."
              : "A busy token's first scan can take a few minutes. Keep this page open: it shows up here when it's done, and later visits are instant."}
          </p>
        </div>
      </div>
    );
  }
  return <ScanView r={result} />;
}

function ScanView({ r }: { r: ScanResult }) {
  const s = r.summary;
  const capEth = eth(r.method.caps.capWei);
  const freshEth = eth(r.method.caps.freshPoolCapWei);
  const blockedShare =
    BigInt(s.kin.attemptedWei) > 0n ? Number((BigInt(s.kin.blockedWei) * 10_000n) / BigInt(s.kin.attemptedWei)) : null;
  return (
    <section>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>
          {r.name ?? "Unknown token"} {r.symbol && <span className="muted">${r.symbol}</span>}{" "}
          <span className="pill" style={{ verticalAlign: "middle" }}>
            Base mainnet · launched without Kin
          </span>
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

      <BuyerMap r={r} />

      {r.entities.length === 0 ? (
        <Notice>
          None of the first {s.earlyBuyers} buyers share a funder within {r.method.maxHops} hops{" "}
          {r.method.fundingWindowHours > 0 ? `in the ${r.method.fundingWindowHours} hours before they bought` : "before they bought"}. Exchanges and
          other public services don&apos;t count as a shared funder.
          {s.freshWallets > 0 && BigInt(s.kin.blockedWei) > 0n && (
            <>
              {" "}
              {s.freshWallets} of them were brand-new wallets, which on Kin share one {eth(r.method.caps.freshPoolCapWei)} ETH limit for new
              wallets: that is where the {eth(s.kin.blockedWei)} ETH Kin would have refused comes from.
            </>
          )}
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
                <td className="num">{BigInt(b.ethSpentWei) > 0n ? eth(b.ethSpentWei) : "n/a"}</td>
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
          <li>Links: two wallets share a native-ETH funder within {r.method.maxHops} hops {r.method.fundingWindowHours > 0 ? `in the ${r.method.fundingWindowHours} hours before` : "before"} their first buy. Labelled exchange, bridge and router addresses never link, and neither do contracts or wallets with 10,000 or more transactions (exchange hot wallets).</li>
          <li>Tiers as Kin would assign them: linked wallets share one {capEth} ETH cap; new unlinked wallets (no prior transactions, or first funded shortly before buying) split one {freshEth} ETH fresh pool evenly; other wallets get their own {capEth} ETH cap.</li>
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

/**
 * Every early buyer in buy order: wallets that share a funder (one entity) are filled, new wallets are dashed,
 * independent ones are grey, and buys Kin's limit would have refused are crossed out.
 */
function BuyerMap({ r }: { r: ScanResult }) {
  const blocked = new Set(r.entities.flatMap((e) => e.kin.blockedTxs.map((t) => t.toLowerCase())));
  const multi = new Map(r.entities.map((e, i) => [e.id, i + 1]));
  const linkedCount = r.buyers.filter((b) => multi.has(b.entity)).length;
  return (
    <figure className="card buyer-map">
      <figcaption>
        <strong>The first {r.buyers.length} buyers, in order.</strong>{" "}
        <span className="muted">
          {linkedCount > 0
            ? `${linkedCount} of them were funded by a source they share with another buyer.`
            : "None of them share a funder."}
        </span>
      </figcaption>
      <div className="bm-dots">
        {r.buyers.map((b, i) => {
          const ent = multi.get(b.entity);
          const cut = blocked.has(b.firstBuyTx.toLowerCase());
          const kind = ent ? "linked" : b.tier === "fresh" ? "fresh" : "own";
          return (
            <span
              key={b.wallet}
              className={`bm-dot is-${kind}${cut ? " is-cut" : ""}`}
              style={{ animationDelay: `${Math.min(i, 80) * 18}ms` }}
              title={`#${i + 1} ${b.wallet}${ent ? ` · entity ${b.entity}` : ""}${cut ? " · Kin would refuse this buy" : ""}`}
            >
              {ent ? ent : ""}
            </span>
          );
        })}
      </div>
      <ul className="bm-legend small muted">
        <li>
          <span className="bm-dot is-linked">1</span> shares a funder with other buyers (number = entity)
        </li>
        <li>
          <span className="bm-dot is-fresh" /> brand-new wallet
        </li>
        <li>
          <span className="bm-dot is-own" /> independent
        </li>
        <li>
          <span className="bm-dot is-linked is-cut" /> Kin would refuse its first buy
        </li>
      </ul>
    </figure>
  );
}
