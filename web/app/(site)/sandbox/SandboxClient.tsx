"use client";

import { useEffect, useRef, useState } from "react";
import { Notice, Tx } from "@/components/bits";
import { api, ApiError, post } from "@/lib/api";
import { API_URL, LAUNCH_EXPLORER } from "@/lib/config";
import { eth, short } from "@/lib/format";
import type { SandboxEvent, SandboxResult, SandboxRun } from "@/lib/types";

type Slot = { tx: string; status: "pending" | "landed" | "rejected" } | null;

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
  const count = (slots: Slot[], s: "landed" | "rejected") => slots.filter((x) => x?.status === s).length;

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

      <div className="versus" style={{ marginTop: 16 }}>
        <Pool
          title="Kin pool"
          subtitle={r ? `one entity, one ${eth(r.entityCapWei)} ETH cap` : "entity cap enforced by the hook"}
          slots={view.kin}
          landed={count(view.kin, "landed")}
          explorer={explorer}
          tone="good"
        />
        <Pool
          title="Plain pool"
          subtitle="same token settings, no hook"
          slots={view.plain}
          landed={count(view.plain, "landed")}
          explorer={explorer}
          tone="bad"
        />
      </div>

      {r && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Result</h3>
          <p>
            The bundle landed <strong>{r.kin.landed} of {r.bundleSize}</strong> buys on the Kin pool (its cap allows{" "}
            {r.expectedKinMax} × {eth(r.perWalletWei)} ETH) and <strong>{r.plain.landed} of {r.bundleSize}</strong> on the
            plain pool.
          </p>
          {r.kin.rejectReason && (
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
            <dt>Allowlist root</dt>
            <dd className="mono break">{r.root}</dd>
            <dt>Evidence hash</dt>
            <dd className="mono break">{r.evidenceHash}</dd>
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

function Pool(p: { title: string; subtitle: string; slots: Slot[]; landed: number; explorer: string; tone: "good" | "bad" }) {
  return (
    <div className="card">
      <div className="pool-head">
        <div>
          <h3 style={{ margin: 0 }}>{p.title}</h3>
          <div className="small muted">{p.subtitle}</div>
        </div>
        <div className="pool-score" style={{ color: `var(--${p.tone})` }}>
          {p.landed}/{p.slots.length}
        </div>
      </div>
      <div className="slots">
        {p.slots.map((s, i) => {
          const cls = `slot ${s ? `slot-${s.status}` : ""}`;
          const label = s?.status === "landed" ? "✓" : s?.status === "rejected" ? "✕" : i + 1;
          return s && p.explorer ? (
            <a key={i} className={cls} href={`${p.explorer}/tx/${s.tx}`} target="_blank" rel="noreferrer" title={`wallet ${i + 1}: ${s.status}`}>
              {label}
            </a>
          ) : (
            <span key={i} className={cls} title={s ? `wallet ${i + 1}: ${s.status}` : `wallet ${i + 1}`}>
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
