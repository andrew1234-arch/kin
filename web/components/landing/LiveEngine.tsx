"use client";

import Link from "next/link";
import { useNow } from "@/lib/useNow";
import { CountUp } from "@/components/CountUp";
import { Notice } from "@/components/bits";
import { API_URL, DEPLOYMENT, LAUNCH_CHAIN_ID } from "@/lib/config";
import { Source } from "@/components/Source";
import { chainLabel, featuredLaunch, useEngine } from "@/lib/engine";
import { duration, eth, pct, short } from "@/lib/format";
import { phaseOf, type LaunchView, type Phase, type SandboxRun } from "@/lib/types";

const PHASES: { key: Phase[]; label: string }[] = [
  { key: ["registration", "building"], label: "Register" },
  { key: ["dispute"], label: "Dispute" },
  { key: ["window"], label: "Window" },
  { key: ["locked"], label: "Lock" },
  { key: ["claimable"], label: "Open" },
];

function LaunchPanel({ launch }: { launch: LaunchView }) {
  const now = useNow();
  const phase = now ? phaseOf(launch, now) : null;
  const idx = phase ? PHASES.findIndex((p) => p.key.includes(phase)) : -1;
  const a = launch.allowlist;
  const o = launch.onchain;
  return (
    <article className="live-panel live-launch">
      <header className="live-head">
        <div>
          <p className="eyebrow">Launch</p>
          <h3>
            {launch.name} <span className="faint">${launch.symbol}</span>
          </h3>
        </div>
        <Source chainId={launch.chainId} />
      </header>
      <div className="phases live-phases" aria-label="Launch phase">
        {PHASES.map((p, i) => (
          <div key={p.label} className={`phase ${i === idx ? "phase-now" : i < idx ? "phase-done" : ""}`}>
            {p.label}
          </div>
        ))}
      </div>
      <dl className="live-nums">
        <div>
          <dt>Wallets registered</dt>
          <dd>
            <CountUp value={launch.registrations} />
          </dd>
        </div>
        <div>
          <dt>Entities</dt>
          <dd>{a ? <CountUp value={a.stats.entities} /> : <span className="faint">n/a</span>}</dd>
        </div>
        <div>
          <dt>Wallets in linked entities</dt>
          <dd>{a ? <CountUp value={a.stats.linkedWallets} /> : <span className="faint">n/a</span>}</dd>
        </div>
        <div>
          <dt>Fresh wallets, pooled</dt>
          <dd>{a ? <CountUp value={a.stats.freshWallets} /> : <span className="faint">n/a</span>}</dd>
        </div>
      </dl>
      <dl className="kv live-kv">
        <dt>Limit per entity</dt>
        <dd>{eth(launch.tiers.capWei)} ETH</dd>
        <dt>Fresh-wallet pool</dt>
        <dd>{eth(launch.tiers.freshPoolCapWei)} ETH, split evenly between fresh wallets</dd>
        <dt>Lock after window</dt>
        <dd>{duration(o?.lockDuration ?? launch.window.lockSec)}</dd>
        <dt>Merkle root</dt>
        <dd className="mono">{a ? short(a.root, 6) : <span className="faint">not built yet</span>}</dd>
        <dt>Evidence hash</dt>
        <dd className="mono">{a ? short(a.evidenceHash, 6) : <span className="faint">not built yet</span>}</dd>
        <dt>Pool</dt>
        <dd>{o ? <span className="mono">{short(o.poolId, 6)}</span> : <span className="faint">not deployed yet</span>}</dd>
      </dl>
      <div className="live-actions">
        <Link className="btn btn-sm" href={`/launch/${launch.slug}`}>
          Open launch
        </Link>
        {a && (
          <a className="btn btn-ghost btn-sm" href={`${API_URL}/launches/${launch.slug}/evidence.json`} target="_blank" rel="noreferrer">
            evidence.json
          </a>
        )}
        {o && now !== null && now >= o.windowEnd && (
          <Link className="btn btn-ghost btn-sm" href={`/receipt/${launch.slug}`}>
            Fairness Receipt
          </Link>
        )}
      </div>
    </article>
  );
}

function Slots({ landed, total, tone }: { landed: number; total: number; tone: "good" | "bad" }) {
  return (
    <div className="mini-slots" aria-label={`${landed} of ${total} landed`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < landed ? `mini-${tone}` : ""} />
      ))}
    </div>
  );
}

function SandboxPanel({ run }: { run: SandboxRun | null }) {
  const r = run?.result;
  return (
    <article className="live-panel live-sandbox">
      <header className="live-head">
        <div>
          <p className="eyebrow">Latest sandbox run</p>
          <h3>One funder, {r ? r.bundleSize : "N"} wallets</h3>
        </div>
        {r ? <Source chainId={r.chainId} kind="Sandbox simulation" /> : <Source kind="No run yet" />}
      </header>
      {r ? (
        <>
          <p className="muted small">
            A scripted bundle: {r.bundleSize} fresh wallets funded by one address, each buying {eth(r.perWalletWei)} ETH,
            sent to a Kin pool and to a plain pool at the same time.
          </p>
          <div className="live-vs">
            <div>
              <div className="live-vs-num live-good">
                {r.kin.landed}
                <span>/{r.bundleSize}</span>
              </div>
              <p>landed on the Kin pool</p>
              <Slots landed={r.kin.landed} total={r.bundleSize} tone="good" />
            </div>
            <div>
              <div className="live-vs-num live-bad">
                {r.plain.landed}
                <span>/{r.bundleSize}</span>
              </div>
              <p>landed on the plain pool</p>
              <Slots landed={r.plain.landed} total={r.bundleSize} tone="bad" />
            </div>
          </div>
          <p className="faint small">
            Ran {new Date(run!.startedAt).toLocaleString()} in {(r.elapsedMs / 1000).toFixed(1)} s.
            {r.kin.rejectReason && (
              <>
                {" "}Kin pool rejections reverted with{" "}
                <code className="mono" title={r.kin.rejectReason}>
                  {r.kin.rejectReason.split("(")[0]}
                </code>
                .
              </>
            )}
          </p>
        </>
      ) : (
        <p className="muted small">This engine has no finished sandbox run to show. Start one and watch it live.</p>
      )}
      <div className="live-actions">
        <Link className="btn btn-sm" href="/sandbox">
          {r ? "Run it yourself" : "Start a run"}
        </Link>
      </div>
    </article>
  );
}

function Capability({ label, on, note }: { label: string; on: boolean; note: string }) {
  return (
    <li className={on ? "cap-on" : "cap-off"}>
      <i aria-hidden="true" />
      <span>{label}</span>
      <small>{on ? note : "not configured on this server"}</small>
    </li>
  );
}

/** The live section: everything is fetched from the engine this site points at, with its source labelled. */
export function LiveEngine() {
  const snap = useEngine();

  if (snap.status === "unconfigured" || snap.status === "offline") {
    return (
      <div className="live-empty">
        <Notice tone="warn">
          {snap.status === "unconfigured"
            ? "This deployment is not connected to a Kin engine (NEXT_PUBLIC_KIN_API is not set), so there is no live data to show."
            : `The Kin engine did not answer (${snap.error}).`}{" "}
          Nothing on this page is simulated to fill the gap.
        </Notice>
        <p className="muted">
          The sandbox, scan and launch pages need the engine too. To run everything locally, start{" "}
          <code className="mono">engine/scripts/dev-local.sh</code> and point the site at it.
        </p>
      </div>
    );
  }
  if (snap.status === "loading") {
    return (
      <div className="live-grid" aria-busy="true">
        <div className="live-panel live-skeleton" />
        <div className="live-panel live-skeleton" />
      </div>
    );
  }

  const launch = featuredLaunch(snap.launches);
  const h = snap.health;
  return (
    <>
      <div className="live-status">
        <span className="source source-live">
          <i aria-hidden="true" />
          Engine connected
        </span>
        <span className="faint small">
          {snap.launches.length} launch{snap.launches.length === 1 ? "" : "es"} on this engine
        </span>
      </div>
      {snap.errors.length > 0 && <Notice tone="warn">Some engine data could not be loaded: {snap.errors.join("; ")}</Notice>}
      <div className="live-grid">
        {launch ? (
          <LaunchPanel launch={launch} />
        ) : (
          <article className="live-panel">
            <p className="eyebrow">Launch</p>
            <h3>No launches on this engine yet</h3>
            <p className="muted small">An operator creates one with the admin CLI. The steps are on the launch page.</p>
            <div className="live-actions">
              <Link className="btn btn-sm" href="/launch/new">
                Create a launch
              </Link>
            </div>
          </article>
        )}
        <SandboxPanel run={snap.sandbox} />
      </div>
      <ul className="caps" aria-label="What this engine can do">
        <Capability label="Launches" on={h.launches} note={`${chainLabel(LAUNCH_CHAIN_ID).name} RPC configured`} />
        <Capability label="Kin Scan" on={h.scan} note="reads Base mainnet, read-only" />
        <Capability label="Sandbox" on={h.sandbox} note="relayer funded, runs on demand" />
        <Capability label="Base Verify tier" on={h.baseVerify} note="verified-human cap available" />
        <Capability
          label="Contracts in this site"
          on={!!DEPLOYMENT}
          note={DEPLOYMENT ? `router ${short(DEPLOYMENT.kinRouter, 4)}` : ""}
        />
      </ul>
    </>
  );
}

/** Measured on real Base launches, shown only when the engine has a computed replay. Renders nothing otherwise. */
export function ReplayStrip() {
  const snap = useEngine();
  if (snap.status !== "ok" || !snap.replay) return null;
  const a = snap.replay.aggregates;
  if (!a.launchesScanned) return null;
  return (
    <div className="replay-strip">
      <Source chainId={snap.replay.sample.chainId} kind="Measured" />
      <p>
        Kin&apos;s clustering, replayed over <strong>{a.launchesScanned}</strong> real launches:{" "}
        <strong>{a.launchesWithMultiWalletEntityPct === null ? "n/a" : `${a.launchesWithMultiWalletEntityPct}%`}</strong> had at
        least one multi-wallet entity among early buyers, holding a median{" "}
        <strong>{pct(a.medianMultiWalletShareOfEarlyBps)}</strong> of early buys.{" "}
        <Link href="/replay">Method and sample</Link>
      </p>
    </div>
  );
}
