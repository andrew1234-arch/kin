"use client";

import { useEffect, useState } from "react";
import { Addr, Notice, Stat } from "@/components/bits";
import { api, ApiError } from "@/lib/api";
import { API_URL, SCAN_EXPLORER } from "@/lib/config";
import { pct } from "@/lib/format";
import type { ScanResult } from "@/lib/types";

interface ReplayReport {
  schema: "kin-replay/1";
  ranAt: string;
  sample: { chainId: number; selection: string; tokens: { address: string; source: string }[] };
  method: ScanResult["method"] | null;
  aggregates: {
    launchesScanned: number;
    launchesWithMultiWalletEntity: number;
    launchesWithMultiWalletEntityPct: number | null;
    earlyBuyersTotal: number;
    walletsInMultiWalletEntitiesTotal: number;
    medianMultiWalletShareOfEarlyBps: number | null;
    kinCounterfactual: { attemptedEth: string; blockedEth: string; blockedPct: number | null; unknownBuys: number };
    examples: { token: string; symbol: string | null; multiWalletShareOfEarlyBps: number | null; largestEntityWallets: number }[];
  };
  failures: { token: string; error: string }[];
  scans: ScanResult[];
}

export default function ReplayPage() {
  const [report, setReport] = useState<ReplayReport | null>(null);
  const [state, setState] = useState<"loading" | "none" | "error" | "ok">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    api<ReplayReport>("/replay")
      .then((r) => {
        setReport(r);
        setState("ok");
      })
      .catch((e: ApiError) => {
        if (e.status === 404) setState("none");
        else {
          setError(e.message);
          setState("error");
        }
      });
  }, []);

  return (
    <>
      <h1>Replay report</h1>
      <p className="lede">
        Kin Scan run over a fixed sample of recent Base launches: how often early supply sat with multi-wallet entities,
        and what Kin&apos;s caps would have done.
      </p>
      {state === "loading" && <p className="muted">Loading…</p>}
      {state === "none" && (
        <Notice>
          Not yet computed. The replay job has not run, so there are no numbers here. When it runs, this page shows the
          method, the sample, the results and the raw output file.
        </Notice>
      )}
      {state === "error" && <Notice tone="error">{error}</Notice>}
      {report && <ReportView r={report} />}
    </>
  );
}

function ReportView({ r }: { r: ReplayReport }) {
  const a = r.aggregates;
  return (
    <>
      <p className="small faint">
        Computed {new Date(r.ranAt).toLocaleString()} ·{" "}
        <a href={`${API_URL}/replay`} target="_blank" rel="noreferrer">
          raw output (JSON)
        </a>
      </p>
      <div className="stats">
        <Stat label="launches scanned" value={a.launchesScanned} />
        <Stat
          label="had a multi-wallet entity among early buyers"
          value={a.launchesWithMultiWalletEntityPct === null ? "—" : `${a.launchesWithMultiWalletEntityPct}%`}
          sub={`${a.launchesWithMultiWalletEntity} of ${a.launchesScanned}`}
          tone="bad"
        />
        <Stat label="median share of early buys held by them" value={pct(a.medianMultiWalletShareOfEarlyBps)} />
        <Stat
          label="of early ETH Kin would have rejected"
          value={a.kinCounterfactual.blockedPct === null ? "—" : `${a.kinCounterfactual.blockedPct}%`}
          sub={`${a.kinCounterfactual.blockedEth} of ${a.kinCounterfactual.attemptedEth} ETH`}
          tone="accent"
        />
      </div>

      <h2>Method</h2>
      <div className="card">
        <p>
          <strong>Sample.</strong> {r.sample.selection}
        </p>
        {r.method && (
          <p className="muted small">
            First {r.method.earlyBuyers} buyers per token, grouped by weighted evidence (ported from the Nuno engine): same
            direct funder 1.0, shared funding source within {r.method.maxHops} hops 0.8, same-block early buy 0.5, merged at
            1.0, funding traced in the {r.method.fundingWindowHours} hours before the first buy; labelled exchanges, bridges
            and routers never link.
            Counterfactual caps: {Number(r.method.caps.capWei) / 1e18} ETH per entity, {Number(r.method.caps.freshPoolCapWei) / 1e18} ETH
            shared by fresh wallets. {a.kinCounterfactual.unknownBuys} buys paid in a token were left out of the ETH figures.
          </p>
        )}
      </div>

      {a.examples.length > 0 && (
        <>
          <h2>Examples</h2>
          <div className="grid grid-3">
            {a.examples.map((x) => (
              <a key={x.token} className="card" href={`/scan?token=${x.token}`} style={{ color: "inherit", textDecoration: "none" }}>
                <h3>{x.symbol ?? x.token.slice(0, 10)}</h3>
                <p className="small muted">
                  {pct(x.multiWalletShareOfEarlyBps)} of early buys in multi-wallet entities; largest entity {x.largestEntityWallets} wallets.
                </p>
                <span className="small">Open the scan →</span>
              </a>
            ))}
          </div>
        </>
      )}

      <h2>Sample and results</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Source</th>
              <th className="num">Early buyers</th>
              <th className="num">Entities</th>
              <th className="num">Share of early buys</th>
            </tr>
          </thead>
          <tbody>
            {r.sample.tokens.map((t) => {
              const s = r.scans.find((x) => x.token.toLowerCase() === t.address.toLowerCase());
              const f = r.failures.find((x) => x.token.toLowerCase() === t.address.toLowerCase());
              return (
                <tr key={t.address}>
                  <td>
                    <Addr address={t.address} explorer={SCAN_EXPLORER} /> {s?.symbol && <span className="muted">${s.symbol}</span>}
                  </td>
                  <td className="small muted">{t.source}</td>
                  <td className="num">{s ? s.summary.earlyBuyers : "—"}</td>
                  <td className="num">{s ? s.summary.multiWalletEntities : f ? "failed" : "—"}</td>
                  <td className="num">{s ? pct(s.summary.multiWalletShareOfEarlyBps) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
