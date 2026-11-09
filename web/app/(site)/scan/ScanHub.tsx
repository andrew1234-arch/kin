"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { Notice } from "@/components/bits";
import { api, ApiError } from "@/lib/api";
import { phaseLabel, phaseOf, type LaunchView } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { LaunchScan } from "./LaunchScan";
import { TokenScan } from "./ScanClient";

/** Well-known Base tokens that launched without Kin, as one-click examples. */
const EXAMPLES = [{ symbol: "BRETT", token: "0x532f27101965dd16442E59d40670FaF5eBB142E4" }];

type Target =
  | { kind: "launch"; launch: LaunchView }
  | { kind: "token"; token: string }
  | { kind: "wait" }
  | { kind: "none" }
  | { kind: "bad"; text: string };

/**
 * One search for every token. A Kin launch (by token address, name or symbol) shows the limits Kin gave and what the
 * pool recorded; any other token on Base shows its early buyers grouped by funder and what Kin would have refused.
 */
export function ScanHub() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const now = useNow();
  const query = (params.get("token") ?? params.get("q") ?? "").trim();
  const slug = params.get("launch");
  const cap = params.get("cap") ?? undefined;
  const [input, setInput] = useState(query);
  const [launches, setLaunches] = useState<LaunchView[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  useEffect(() => {
    api<LaunchView[]>("/launches")
      .then((l) => setLaunches(l.filter((x) => x.mode === "instant" && x.onchain).sort((a, b) => b.createdAt - a.createdAt)))
      .catch((e: ApiError) => setListErr(e.message));
  }, []);
  useEffect(() => setInput(query), [query]);

  const target = useMemo<Target>(() => {
    const loading = launches === null && !listErr;
    if (query) {
      const needle = query.toLowerCase().replace(/^\$/, "");
      const hit = launches?.find(
        (l) => l.onchain?.token.toLowerCase() === needle || l.slug === needle || l.name.toLowerCase() === needle || l.symbol.toLowerCase() === needle,
      );
      if (hit) return { kind: "launch", launch: hit };
      if (loading) return { kind: "wait" };
      if (isAddress(query)) return { kind: "token", token: query };
      return { kind: "bad", text: `No Kin launch is called "${query}". Paste a token address (0x…) to scan any token on Base.` };
    }
    if (loading) return { kind: "wait" };
    if (!launches?.length) return { kind: "none" };
    const busiest = [...launches].sort((a, b) => Number((b.instant?.wallets ?? 0) > 0) - Number((a.instant?.wallets ?? 0) > 0) || b.createdAt - a.createdAt)[0]!;
    return { kind: "launch", launch: launches.find((l) => l.slug === slug) ?? busiest };
  }, [query, slug, launches, listErr]);

  const go = (q: string) => router.push(`${path}?${new URLSearchParams(q.startsWith("launch=") ? { launch: q.slice(7) } : { token: q }).toString()}`, { scroll: false });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) go(input.trim());
  };
  const selected = target.kind === "launch" ? target.launch.slug : target.kind === "token" ? target.token.toLowerCase() : null;

  return (
    <>
      <form onSubmit={submit} className="card scan-search">
        <div className="row">
          <input
            aria-label="Token address or Kin launch name"
            placeholder="Paste a token address (0x…) or a Kin launch name"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mono"
            spellCheck={false}
          />
          <button className="btn btn-primary" disabled={!input.trim()}>
            Scan
          </button>
        </div>
        <div className="scan-picks">
          {launches && launches.length > 0 && (
            <div className="scan-pick-row">
              <span className="small faint">Kin launches</span>
              {launches.slice(0, 8).map((l) => (
                <button
                  type="button"
                  key={l.slug}
                  className="lscan-chip"
                  aria-pressed={selected === l.slug}
                  onClick={() => go(`launch=${l.slug}`)}
                >
                  <strong>{l.name}</strong>
                  <span className="faint small">
                    ${l.symbol} · {now ? phaseLabel(l, phaseOf(l, now)) : ""} · {l.instant?.wallets ?? 0} wallet{l.instant?.wallets === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="scan-pick-row">
            <span className="small faint">Tokens on Base</span>
            {EXAMPLES.map((x) => (
              <button
                type="button"
                key={x.token}
                className="lscan-chip"
                aria-pressed={selected === x.token.toLowerCase()}
                onClick={() => go(x.token)}
              >
                <strong>${x.symbol}</strong>
                <span className="faint small">launched without Kin</span>
              </button>
            ))}
          </div>
        </div>
      </form>

      <div className="scan-result">
        {listErr && target.kind !== "token" && <Notice tone="error">{listErr}</Notice>}
        {target.kind === "wait" && <p className="muted">Loading…</p>}
        {target.kind === "none" && (
          <Notice>
            No Kin launches yet. <Link href="/launch/new">Launch the first one</Link>, or paste any token address above.
          </Notice>
        )}
        {target.kind === "bad" && <Notice tone="warn">{target.text}</Notice>}
        {target.kind === "launch" && <LaunchScan launch={target.launch} />}
        {target.kind === "token" && <TokenScan token={target.token} cap={cap} />}
      </div>
    </>
  );
}
