"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { eth } from "@/lib/format";
import type { SandboxRun } from "@/lib/types";

/** The most recent finished sandbox run, straight from the engine. Shows nothing if there is none. */
export function LatestSandbox() {
  const [run, setRun] = useState<SandboxRun | null>(null);
  useEffect(() => {
    api<SandboxRun | null>("/sandbox/latest").then(setRun).catch(() => setRun(null));
  }, []);
  const r = run?.result;
  if (!r) return null;
  return (
    <div className="card" style={{ marginTop: 22 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Latest sandbox run</h3>
        <span className="faint small">{new Date(run!.startedAt).toLocaleString()}</span>
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>
        One funder, {r.bundleSize} wallets, {eth(r.perWalletWei)} ETH each, against a Kin pool and a plain pool.
      </p>
      <div className="stats" style={{ margin: "12px 0 6px" }}>
        <div className="stat stat-good">
          <div className="stat-value">
            {r.kin.landed}/{r.bundleSize}
          </div>
          <div className="stat-label">landed on the Kin pool</div>
        </div>
        <div className="stat stat-bad">
          <div className="stat-value">
            {r.plain.landed}/{r.bundleSize}
          </div>
          <div className="stat-label">landed on the plain pool</div>
        </div>
      </div>
      <Link href="/sandbox">Run it yourself →</Link>
    </div>
  );
}
