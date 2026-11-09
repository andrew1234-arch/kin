"use client";

import { useEffect, useRef, useState } from "react";
import { Notice, Tx } from "@/components/bits";
import { FlowDiagram, type FlowBuy } from "@/components/FlowDiagram";
import { PoolChart, type Slot } from "@/components/PoolChart";
import { api, ApiError, post } from "@/lib/api";
import { API_URL, LAUNCH_EXPLORER } from "@/lib/config";
import { eth, short } from "@/lib/format";
import type { SandboxEvent, SandboxResult, SandboxRun } from "@/lib/types";

interface View {
  steps: { step: string; detail: string; txs?: string[] }[];
  kin: Slot[];
  plain: Slot[];
  result: SandboxResult | null;
  error: string | null;
}

const empty = (n = 20): View => ({ steps: [], kin: Array(n).fill(null), plain: Array(n).fill(null), result: null, error: null });

function reduce(v: View, e: SandboxEvent): View {
  switch (e.type) {
    case "step":
      return { ...v, steps: [...v.steps, e] };
    case "attempt": {
      const list = [...v[e.pool]];
      list[e.index] = { tx: e.tx, status: e.status };
      return { ...v, [e.pool]: list };
    }
    case "result":
      return { ...v, result: e.result };
    case "error":
      return { ...v, error: e.message };
  }
}

export function SandboxClient() {
  const [view, setView] = useState<View>(empty());
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [latestAt, setLatestAt] = useState<number | null>(null);
  const es = useRef<EventSource | null>(null);

  useEffect(() => {
    api<SandboxRun | null>("/sandbox/latest")
      .then((run) => {
        if (!run) return;
        setView(run.events.reduce(reduce, empty(run.result?.bundleSize)));
        setLatestAt(run.startedAt);
      })
      .catch(() => {});
    return () => es.current?.close();
  }, []);

  const watch = (id: string) => {
    es.current?.close();
    setView(empty());
    setLatestAt(null);
    setRunning(true);
    const src = new EventSource(`${API_URL}/sandbox/runs/${id}/stream`);
    es.current = src;
    src.onmessage = (m) => {
      const e = JSON.parse(m.data) as SandboxEvent;
      setView((v) => reduce(v, e));
      if (e.type === "result" || e.type === "error") {
        setRunning(false);
        src.close();
      }
    };
    src.onerror = () => {
      setRunning(false);
      src.close();
    };
  };

  const start = async () => {
    setNotice(null);
    try {
      const { id } = await post<{ id: string }>("/sandbox/runs", {});
      watch(id);
    } catch (e) {
      const err = e as ApiError;
      const runningId = typeof err.body?.runningId === "string" ? err.body.runningId : null;
      if (runningId) {
        setNotice("Someone else's run is in progress. Watching it live.");
        watch(runningId);
      } else {
        setNotice(err.message);
      }
    }
  };

  const r = view.result;
  const explorer = LAUNCH_EXPLORER;
  const has = (step: string) => view.steps.some((s) => s.step === step);
  const funded = has("funded");
  const linked = has("limits");
  const kinLanded = view.kin.filter((x) => x?.status === "landed").length;
  const capBuys = r?.expectedKinMax ?? 10;
  const flowBuy = (x: Slot): FlowBuy =>
    !x ? "idle" : x.status === "landed" ? "landed" : x.status === "rejected" ? "blocked" : x.status === "pending" ? "pending" : "idle";
  const caption = running
    ? (view.steps[view.steps.length - 1]?.detail ?? "Starting the run…")
    : r
      ? `Kin let ${r.kin.landed} of ${r.bundleSize} buys through. The normal pool let ${r.plain.landed} through.`
      : "Press the button to send one funder's 20 wallets at both pools.";

  return (
    <>
      <div className="row" style={{ margin: "22px 0 18px" }}>
        <button className="btn btn-lg" onClick={start} disabled={running}>
          {running ? "Attack running…" : "Run the attack"}
        </button>
        {latestAt && !running && <span className="small faint">Showing the latest run, {new Date(latestAt).toLocaleString()}</span>}
      </div>
      {notice && <Notice tone="warn">{notice}</Notice>}
      {view.error && <Notice tone="error">The run failed: {view.error}</Notice>}

      <div className="card sbx-flow">
        <FlowDiagram
          source="Funder"
          sourceSub="1 wallet"
          wallets={view.kin.map((x) => ({ label: "", funded, linked, buy: flowBuy(x) }))}
          fill={Math.min(1, kinLanded / capBuys)}
          capLabel={r ? `limit ${eth(r.entityCapWei, 6)} ETH` : "shared limit"}
        />
        <p className={`sbx-caption${running ? " is-live" : ""}`} aria-live="polite">
          {caption}
        </p>
      </div>

      <div className="versus" style={{ marginTop: 16 }}>
        <PoolChart
          title="With Kin"
          subtitle={r ? `one entity, one ${eth(r.entityCapWei, 6)} ETH limit` : "one limit per entity, enforced by the hook"}
          slots={view.kin}
          explorer={explorer}
          tone="good"
        />
        <PoolChart title="Without Kin" subtitle="a normal pool, same token settings" slots={view.plain} explorer={explorer} tone="bad" />
      </div>

      {r && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Result</h3>
          <p>
            The bundle landed <strong>{r.kin.landed} of {r.bundleSize}</strong> buys on the Kin pool (its one limit allows{" "}
            {r.expectedKinMax} × {eth(r.perWalletWei, 6)} ETH) and <strong>{r.plain.landed} of {r.bundleSize}</strong> on the
            plain pool.
          </p>
          {r.kin.rejectReason && /EntityCap/i.test(r.kin.rejectReason) && (
            <p className="small muted break">
              The next Kin buy reverts with <span className="mono">{r.kin.rejectReason.replace(/\(0x[0-9a-f]{64}/i, "(entity")}</span>.
            </p>
          )}
          <dl className="kv small" style={{ marginTop: 10 }}>
            <dt>Funder</dt>
            <dd className="mono">{short(r.funder, 6)}</dd>
            <dt>Kin launch</dt>
            <dd>
              <Tx hash={r.kin.launchTx} explorer={explorer} />
            </dd>
            <dt>Plain launch</dt>
            <dd>
              <Tx hash={r.plain.launchTx} explorer={explorer} />
            </dd>
            {r.mode === "instant" ? (
              <>
                <dt>Entities</dt>
                <dd>
                  {r.entities} for {r.bundleSize} wallets ({r.linkedWallets} linked by funding)
                </dd>
                <dt>Rules hash</dt>
                <dd className="mono break">{r.evidenceHash}</dd>
              </>
            ) : (
              <>
                <dt>Allowlist root</dt>
                <dd className="mono break">{r.root}</dd>
                <dt>Evidence hash</dt>
                <dd className="mono break">{r.evidenceHash}</dd>
              </>
            )}
            <dt>Tokens vaulted</dt>
            <dd>locked until the window ends plus the lock period</dd>
            <dt>Run time</dt>
            <dd>{(r.elapsedMs / 1000).toFixed(1)} s</dd>
          </dl>
        </div>
      )}

      {view.steps.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Steps</h3>
          <ol className="timeline">
            {view.steps.map((s, i) => (
              <li key={i} className={running && i === view.steps.length - 1 ? "now" : ""}>
                {s.detail}
                {s.txs && s.txs.length > 0 && (
                  <span className="small faint">
                    {" "}
                    · {s.txs.length === 1 ? <Tx hash={s.txs[0]!} explorer={explorer} /> : `${s.txs.length} transactions`}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {!view.steps.length && !running && !notice && (
        <Notice>No run yet. The first run takes about half a minute on Base Sepolia.</Notice>
      )}
    </>
  );
}
