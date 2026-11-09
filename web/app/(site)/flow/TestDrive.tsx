"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEther, toFunctionSelector, type Address, type Hex } from "viem";
import { useConnect } from "wagmi";
import { Notice, Tx } from "@/components/bits";
import { FlowDiagram, type FlowBuy } from "@/components/FlowDiagram";
import { PoolChart } from "@/components/PoolChart";
import { kinHookAbi, kinRouterAbi } from "@/lib/abi";
import { api, ApiError, post } from "@/lib/api";
import { addrUrl, DEPLOYMENT, LAUNCH_EXPLORER, SLIPPAGE_BPS } from "@/lib/config";
import { duration, eth, short } from "@/lib/format";
import {
  addressOf,
  createTestWallets,
  loadTestWallets,
  publicClient,
  ROLE_LABEL,
  ROLES,
  walletFor,
  type Role,
  type TestWallets,
} from "@/lib/testWallets";
import type { LaunchView, Permit } from "@/lib/types";
import { useNow } from "@/lib/useNow";

/** Gas headroom left in each wallet (Base Sepolia gas is ~0.006 gwei; a buy is well under 1M gas). */
const PAD = parseEther("0.00001");
const CAP_SELECTOR = toFunctionSelector("EntityCapExceeded(bytes32,uint256,uint256)").slice(2).toLowerCase();
const PROGRESS_KEY = "kin:try:v1";
const ZERO32 = `0x${"00".repeat(32)}` as Hex;

type Onchain = NonNullable<LaunchView["onchain"]>;
type StepKey = "wallets" | "fund" | "split" | "limits" | "buy";
interface Buy {
  hash?: string;
  ok: boolean;
  wei: string;
  note: string;
}
interface Progress {
  wallets: number;
  slug: string | null;
  /** Faucet transfer hash, or "pre-funded" when the wallet already held enough. */
  fundTx?: string;
  splitTxs?: Partial<Record<"a" | "b", string>>;
  permits?: Partial<Record<Role, Permit>>;
  buys?: Partial<Record<Role, Buy>>;
  /** The same buys simulated on the launch's plain twin (no hook), just before the real ones. */
  plain?: Partial<Record<Role, boolean>>;
}
interface Preview {
  tier: Permit["tier"];
  entityId: string;
  links: { from: string; to: string; hop: number }[];
  assigned: boolean;
}
interface FaucetInfo {
  enabled: boolean;
  dripWei: string;
  dripsLeftToday: number;
  dripsInBalance: number;
}

const STEPS: { key: StepKey; title: string }[] = [
  { key: "wallets", title: "Create 3 test wallets" },
  { key: "fund", title: "Get test ETH from the faucet" },
  { key: "split", title: "Send some of it to the other 2 wallets" },
  { key: "limits", title: "Kin checks where each wallet's ETH came from" },
  { key: "buy", title: "All 3 wallets try to buy the full limit" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e: unknown) => ((e as Error)?.message ?? String(e)).split("\n")[0]!;

/** True when a revert anywhere in the error chain is KinHook's EntityCapExceeded (it arrives wrapped by the PoolManager). */
function isCapExceeded(e: unknown): boolean {
  const seen: string[] = [];
  let cur: unknown = e;
  for (let i = 0; cur && i < 8; i++) {
    const x = cur as { message?: string; shortMessage?: string; data?: unknown; details?: string; cause?: unknown };
    seen.push(String(x.message ?? ""), String(x.shortMessage ?? ""), String(x.details ?? ""));
    try {
      seen.push(JSON.stringify(x.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "");
    } catch {}
    cur = x.cause;
  }
  const s = seen.join(" ").toLowerCase();
  return s.includes("entitycapexceeded") || s.includes(CAP_SELECTOR);
}

/** Test ETH the first wallet needs for a run in a launch with this limit: three buys of half the limit, plus gas. */
const driveCost = (capWei: string) => 3n * BigInt(capWei) + 3n * PAD;

/**
 * The open instant launch with the most time left whose run one faucet drip covers (demo launches first);
 * else the next one to open.
 */
function pickLaunch(ls: LaunchView[], now: number, dripWei: bigint | null) {
  const fits = (l: LaunchView) => dripWei === null || driveCost(l.tiers.capWei) <= dripWei;
  const instant = ls.filter((l) => l.mode === "instant" && l.onchain && fits(l));
  const open = instant
    .filter((l) => l.onchain!.windowStart <= now && now < l.onchain!.windowEnd - 120)
    .sort((a, b) => Number(!!b.demo) - Number(!!a.demo) || b.onchain!.windowEnd - a.onchain!.windowEnd)[0];
  const next = instant.filter((l) => l.onchain!.windowStart > now).sort((a, b) => a.onchain!.windowStart - b.onchain!.windowStart)[0];
  return { open: open ?? null, next: next ?? null };
}

function loadProgress(): Progress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Progress) : null;
  } catch {
    return null;
  }
}
function saveProgress(p: Progress | null) {
  try {
    if (p) localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROGRESS_KEY);
  } catch {}
}

/** Wait until the browser's RPC sees at least `min` in `a` (it can lag the engine's by a few seconds). */
async function waitForBalance(a: Address, min: bigint) {
  for (let i = 0; i < 30; i++) {
    if ((await publicClient.getBalance({ address: a }).catch(() => 0n)) >= min) return;
    await sleep(2000);
  }
  throw new Error("The test ETH hasn't arrived yet. Press Continue in a moment.");
}

export function TestDrive() {
  const now = useNow();
  const [tw, setTw] = useState<TestWallets | null>(null);
  const [progress, setProgressState] = useState<Progress | null>(null);
  const progressRef = useRef<Progress | null>(null);
  const [launches, setLaunches] = useState<LaunchView[] | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const [faucet, setFaucet] = useState<FaucetInfo | null>(null);
  const [active, setActive] = useState<StepKey | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<{ step: StepKey; text: string } | null>(null);
  const [spent, setSpent] = useState<bigint | null>(null);
  const { connectors, connect } = useConnect();

  const setProgress = useCallback((next: Progress | null) => {
    progressRef.current = next;
    saveProgress(next);
    setProgressState(next);
  }, []);
  const update = useCallback(
    (f: (p: Progress) => Progress) => setProgress(f(progressRef.current ?? { wallets: 0, slug: null })),
    [setProgress],
  );

  // Wallets and progress live in this browser, so a reload picks up where the run stopped.
  useEffect(() => {
    const t = loadTestWallets();
    const p = loadProgress();
    setTw(t);
    setProgress(t ? (p && p.wallets === t.createdAt ? p : { wallets: t.createdAt, slug: null }) : null);
  }, [setProgress]);

  const loadLaunches = useCallback(() => {
    api<LaunchView[]>("/launches")
      .then((l) => {
        setLaunches(l);
        setEngineErr(null);
      })
      .catch((e: Error) => setEngineErr(e.message));
    api<FaucetInfo>("/faucet").then(setFaucet).catch(() => setFaucet(null));
  }, []);
  useEffect(() => {
    loadLaunches();
    const t = setInterval(loadLaunches, 30_000);
    return () => clearInterval(t);
  }, [loadLaunches]);

  const dripWei = faucet ? BigInt(faucet.dripWei) : null;
  const picked = useMemo(() => (launches && now ? pickLaunch(launches, now, dripWei) : { open: null, next: null }), [launches, now, dripWei]);
  // Stay on the launch this run started in while its window is open; otherwise use the current one.
  const launch = useMemo(() => {
    const mine = progress?.slug ? launches?.find((l) => l.slug === progress.slug) : null;
    if (mine?.onchain && now && now < mine.onchain.windowEnd) return mine;
    return picked.open;
  }, [launches, progress?.slug, now, picked.open]);
  const o: Onchain | null = launch?.onchain ?? null;

  const addr = useMemo(() => (tw ? { main: addressOf(tw.keys.main), a: addressOf(tw.keys.a), b: addressOf(tw.keys.b) } : null), [tw]);
  const cap = launch ? BigInt(launch.tiers.capWei) : 0n;
  const unit = cap;
  const sameLaunch = !!launch && progress?.slug === launch.slug;
  const permits = (sameLaunch && progress?.permits) || {};
  const buys = (sameLaunch && progress?.buys) || {};
  // A run that got limits in a launch that has since closed: its wallets have spent their ETH, so start fresh.
  const stale = !!launch && !!progress?.slug && !sameLaunch && Object.keys(progress.permits ?? {}).length > 0;

  const done: Record<StepKey, boolean> = stale
    ? { wallets: false, fund: false, split: false, limits: false, buy: false }
    : {
        wallets: !!tw,
        fund: !!progress?.fundTx || !!progress?.splitTxs?.a,
        split: !!progress?.splitTxs?.a && !!progress?.splitTxs?.b,
        limits: sameLaunch && ROLES.every((r) => !!permits[r]),
        buy: sameLaunch && ROLES.every((r) => !!buys[r]),
      };
  const started = !stale && !!tw && !!progress?.fundTx;

  // The entity's onchain total once the buys are in.
  useEffect(() => {
    const id = permits.main?.entityId;
    if (!o || !DEPLOYMENT || !id || !done.buy) return;
    publicClient
      .readContract({ address: DEPLOYMENT.kinHook, abi: kinHookAbi, functionName: "entitySpent", args: [o.poolId, id] })
      .then((v) => setSpent(v as bigint))
      .catch(() => {});
  }, [o, permits.main?.entityId, done.buy]);

  // ---------------------------------------------------------------- the run

  /** Runs every step that isn't done yet, in order. `fresh` starts over with three new wallets. */
  const run = async (fresh: boolean) => {
    if (!launch || !o || !DEPLOYMENT) return;
    const L = launch;
    const O = o;
    // Every wallet tries to buy the whole limit, as a bundler would.
    const u = BigInt(L.tiers.capWei);
    const need = 3n * u + 3n * PAD;
    let step: StepKey = "wallets";
    setErr(null);
    setSpent(null);
    try {
      // 1. Wallets
      setActive("wallets");
      let t = fresh ? null : tw;
      if (!t) {
        t = createTestWallets();
        setTw(t);
        setProgress({ wallets: t.createdAt, slug: L.slug });
      }
      const keys = t.keys;
      const a = { main: addressOf(keys.main), a: addressOf(keys.a), b: addressOf(keys.b) };
      // Limits and buys belong to one launch; wallets and their funding carry over to the next.
      if (progressRef.current?.slug !== L.slug) update((p) => ({ ...p, slug: L.slug, permits: {}, buys: {}, plain: undefined }));
      const P = () => progressRef.current!;

      // 2. Test ETH from the faucet
      step = "fund";
      setActive("fund");
      if (!P().fundTx && !P().splitTxs?.a) {
        const have = await publicClient.getBalance({ address: a.main });
        if (have >= need) {
          update((p) => ({ ...p, fundTx: "pre-funded" }));
        } else {
          setStatus("The faucet is sending test ETH…");
          try {
            const r = await post<{ hash: string }>("/faucet", { wallet: a.main });
            update((p) => ({ ...p, fundTx: r.hash }));
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 409)) throw e;
            update((p) => ({ ...p, fundTx: "pre-funded" }));
          }
          await waitForBalance(a.main, need);
        }
      }

      // 3. Split it like a bundler: wallet 1 funds wallets 2 and 3
      step = "split";
      setActive("split");
      const w = walletFor(keys.main);
      for (const r of ["a", "b"] as const) {
        if (P().splitTxs?.[r]) continue;
        const have = await publicClient.getBalance({ address: a[r] });
        if (have >= u + PAD) {
          update((p) => ({ ...p, splitTxs: { ...p.splitTxs, [r]: "pre-funded" } }));
          continue;
        }
        setStatus(`Sending ${eth(u + PAD - have, 6)} ETH to ${ROLE_LABEL[r]}…`);
        const hash = await w.sendTransaction({ to: a[r], value: u + PAD - have });
        await publicClient.waitForTransactionReceipt({ hash });
        update((p) => ({ ...p, splitTxs: { ...p.splitTxs, [r]: hash } }));
      }

      // 4. Limits: wait until Kin's indexer has seen both transfers, then ask for each wallet's limit
      step = "limits";
      setActive("limits");
      for (const r of ["a", "b"] as const) {
        if (P().permits?.[r]) continue;
        for (let i = 0; ; i++) {
          setStatus(i ? `Waiting for the chain indexer to see the transfers (${i * 4} s)…` : "Tracing the funding…");
          const pv = await api<Preview>(`/launches/${L.slug}/preview/${a[r]}`);
          if (pv.assigned || pv.links.some((l) => l.from.toLowerCase() === a.main.toLowerCase())) break;
          if (i >= 30) throw new Error("The chain indexer hasn't seen the transfers yet. Press Continue in a minute.");
          await sleep(4000);
        }
      }
      for (const r of ROLES) {
        if (P().permits?.[r]) continue;
        setStatus(`Getting ${ROLE_LABEL[r]}'s limit…`);
        const pm = await post<Permit>(`/launches/${L.slug}/permit`, { wallet: a[r] });
        // The launch page reads the same cache, so the test wallet can also buy there.
        try {
          localStorage.setItem(`kin:permit:${L.slug}:${a[r].toLowerCase()}`, JSON.stringify(pm));
        } catch {}
        update((p) => ({ ...p, permits: { ...p.permits, [r]: pm } }));
      }

      // 5. Buys. First what a plain pool would do with the same three buys (simulated, nothing sent).
      step = "buy";
      setActive("buy");
      if (L.plainTwin && !P().plain) {
        setStatus("Checking the same buys on a pool without Kin…");
        const plain: Partial<Record<Role, boolean>> = {};
        for (const r of ROLES) {
          plain[r] = await publicClient
            .simulateContract({
              address: DEPLOYMENT.kinRouter,
              abi: kinRouterAbi,
              functionName: "swapExactIn",
              args: [L.plainTwin.key, true, u, 0n, { entityId: ZERO32, entityCap: 0n, proof: [] }, BigInt(O.windowEnd)],
              value: u,
              account: a[r],
            })
            .then(() => true)
            .catch(() => false);
        }
        update((p) => ({ ...p, plain }));
      }
      for (const r of ROLES) {
        if (P().buys?.[r]) continue;
        const pm = P().permits?.[r];
        if (!pm) throw new Error("A limit is missing. Press Continue.");
        setStatus(`${ROLE_LABEL[r]} is buying ${eth(u, 6)} ETH of $${L.symbol}…`);
        const b = await buyOne(keys[r], pm, u, O);
        update((p) => ({ ...p, buys: { ...p.buys, [r]: b } }));
      }
    } catch (e) {
      setErr({ step, text: e instanceof ApiError ? e.message : firstLine(e) });
    } finally {
      setActive(null);
      setStatus(null);
    }
  };

  const openProfile = () => {
    const c = connectors.find((x) => x.type === "kinTestWallet");
    if (c) connect({ connector: c });
  };

  // ---------------------------------------------------------------- render

  if (engineErr) {
    return <Notice tone="error">The test is offline right now ({engineErr}). Please try again in a few minutes.</Notice>;
  }
  if (!launches || now === null) return <p className="muted">Loading…</p>;

  const busy = active !== null;
  const allDone = done.buy;
  const faucetEmpty = !!faucet && (faucet.dripsInBalance < 1 || faucet.dripsLeftToday < 1);
  const landed = ROLES.filter((r) => buys[r]?.ok).length;
  const blocked = ROLES.filter((r) => buys[r] && !buys[r]!.ok).length;
  const plainLanded = progress?.plain ? ROLES.filter((r) => progress.plain![r]).length : null;
  const sameEntity = done.limits && new Set(ROLES.map((r) => permits[r]!.entityId)).size === 1;

  const state = (k: StepKey) => (done[k] ? "done" : active === k ? "now" : err?.step === k ? "error" : "todo");
  const txLink = (h?: string) => (h && h.startsWith("0x") ? <Tx hash={h} explorer={LAUNCH_EXPLORER} /> : <span className="faint">already funded</span>);

  const detail = (k: StepKey) => {
    if (k === "wallets" && addr)
      return (
        <ul className="td-list">
          {ROLES.map((r) => (
            <li key={r}>
              {ROLE_LABEL[r]}{" "}
              <a className="mono" href={addrUrl(LAUNCH_EXPLORER, addr[r]) ?? "#"} target="_blank" rel="noreferrer">
                {short(addr[r], 4)}
              </a>
            </li>
          ))}
        </ul>
      );
    if (k === "fund" && progress?.fundTx) return <p>{faucet ? `${eth(faucet.dripWei, 4)} ETH to You ` : "Sent "}{txLink(progress.fundTx)}</p>;
    if (k === "split" && progress?.splitTxs)
      return (
        <ul className="td-list">
          {(["a", "b"] as const).map((r) => progress.splitTxs?.[r] && <li key={r}>You → {ROLE_LABEL[r]} {txLink(progress.splitTxs[r])}</li>)}
        </ul>
      );
    if (k === "limits" && done.limits)
      return (
        <p>
          {sameEntity ? (
            <>
              Same source, so Kin treats them as <strong>one buyer</strong> with one {eth(cap, 6)} ETH limit.
            </>
          ) : (
            <>Kin didn&apos;t link them, so each wallet has its own limit.</>
          )}
        </p>
      );
    if (k === "buy" && ROLES.some((r) => buys[r]))
      return (
        <ul className="td-list">
          {ROLES.map(
            (r) =>
              buys[r] && (
                <li key={r}>
                  <span className={`pill ${buys[r]!.ok ? "pill-aged" : "pill-linked"}`}>{buys[r]!.ok ? "bought" : "blocked"}</span> {ROLE_LABEL[r]}{" "}
                  {buys[r]!.hash && <Tx hash={buys[r]!.hash!} explorer={LAUNCH_EXPLORER} />}
                </li>
              ),
          )}
        </ul>
      );
    return null;
  };

  return (
    <div className="td">
      <div className="td-run card">
        {launch && o ? (
          <p className="td-launch">
            <span className="pill pill-accent">Live</span> <Link href={`/launch/${launch.slug}`}>{launch.name}</Link>
            <span className="faint"> · limit {eth(cap, 6)} ETH per buyer · closes in {duration(o.windowEnd - now)}</span>
          </p>
        ) : (
          <p className="td-launch muted">
            {picked.next?.onchain ? `The next test launch opens in ${duration(picked.next.onchain.windowStart - now)}.` : "No test launch is open right now. Check back shortly."}
          </p>
        )}

        <ol className="td-steps">
          {STEPS.map((s, i) => {
            const st = state(s.key);
            return (
              <li key={s.key} className={`td-step is-${st}`}>
                <span className="td-mark" aria-hidden="true">
                  {st === "done" ? "✓" : st === "error" ? "!" : i + 1}
                </span>
                <div>
                  <p className="td-title">{s.title}</p>
                  {st === "now" && status && <p className="td-status">{status}</p>}
                  {st === "error" && <p className="td-error">{err!.text}</p>}
                  {(st === "done" || (st !== "todo" && s.key === "buy")) && <div className="td-detail">{detail(s.key)}</div>}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="td-actions">
          {!allDone ? (
            <button className="btn btn-primary btn-lg" onClick={() => run(stale)} disabled={busy || !launch || (faucetEmpty && !started)}>
              {busy ? "Running…" : started || err ? "Continue" : "Start the test"}
            </button>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={() => run(true)} disabled={busy || !launch || faucetEmpty}>
              Run it again
            </button>
          )}
          {!busy && !allDone && (started || err) && (
            <button className="btn btn-ghost" onClick={() => run(true)} disabled={!launch || faucetEmpty}>
              Start over
            </button>
          )}
          <span className="faint small">{faucetEmpty && !started ? "Test ETH has run out for today. Back soon." : "About 2 minutes · Base Sepolia test ETH · nothing to install"}</span>
        </div>
      </div>

      <div className="td-result">
        <div className="card td-flow">
          <FlowDiagram
            source="You"
            sourceSub="one person"
            wallets={ROLES.map((r, i) => ({
              label: ["Wallet 1", "Wallet 2", "Wallet 3"][i]!,
              funded: r === "main" ? !!progress?.fundTx && !stale : !!progress?.splitTxs?.[r] && !stale,
              linked: !!permits[r] && permits[r]!.entityId === permits.main?.entityId && sameEntity,
              buy: buys[r] ? (buys[r]!.ok ? "landed" : "blocked") : active === "buy" && ROLES.find((x) => !buys[x]) === r ? "pending" : ("idle" as FlowBuy),
            }))}
            fill={cap > 0n ? Number(((spent ?? ROLES.reduce((t, r) => t + (buys[r]?.ok ? BigInt(buys[r]!.wei) : 0n), 0n)) * 1000n) / cap) / 1000 : 0}
            capLabel={cap > 0n ? `limit ${eth(cap, 6)} ETH` : "shared limit"}
          />
        </div>
        <div className="td-versus">
        <PoolChart
          title="With Kin"
          subtitle={launch ? `one limit for wallets with the same funder` : ""}
          slots={ROLES.map((r) => (buys[r] ? { tx: buys[r]!.hash, status: buys[r]!.ok ? "landed" : "rejected" } : null))}
          labels={ROLES.map((r) => ROLE_LABEL[r])}
          explorer={LAUNCH_EXPLORER}
          tone="good"
        />
        <PoolChart
          title="Without Kin"
          subtitle="the same buys on a normal pool (simulated)"
          slots={ROLES.map((r) => (progress?.plain && sameLaunch ? { status: progress.plain[r] ? "would-land" : "would-fail" } : null))}
          labels={ROLES.map((r) => ROLE_LABEL[r])}
          explorer=""
          tone="bad"
        />
        </div>
        {allDone ? (
          <div className="td-verdict">
            <h2>{blocked > 0 ? "Three wallets, one person's allowance." : "All 3 buys went through."}</h2>
            {blocked > 0 ? (
              <>
                <p className="td-verdict-line">
                  Kin let them buy <strong>{eth(spent ?? cap, 6)} ETH</strong> together, not {eth(3n * unit, 6)}. It refused {blocked} of 3 buys
                  {plainLanded !== null && <>; without Kin, {plainLanded} of 3 go through</>}.
                </p>
                <p className="muted small">
                  The wallets share a funder, so the pool counts them as one buyer with one {eth(cap, 6)} ETH limit.
                  {spent !== null && ` Recorded onchain for the group: ${eth(spent, 6)} ETH.`}
                </p>
              </>
            ) : (
              <p className="muted">Kin didn&apos;t link these wallets, so each had its own limit.</p>
            )}
            {o && (
              <p className="small faint">
                Bought tokens unlock in {duration(Math.max(0, o.windowEnd + o.lockDuration - now))}.{" "}
                <Link href="/me" onClick={openProfile}>
                  Claim them from your profile
                </Link>
                .
              </p>
            )}
          </div>
        ) : (
          <p className="small faint td-hint">{landed + blocked > 0 ? "Buying…" : "Results show here when the buys land."}</p>
        )}
      </div>
    </div>
  );
}

/** One window buy from a test wallet. A buy the hook rejects is still sent, so the rejection is onchain to inspect. */
async function buyOne(key: Hex, permit: Permit, wei: bigint, o: Onchain): Promise<Buy> {
  const w = walletFor(key);
  const allowance = { entityId: permit.entityId, entityCap: BigInt(permit.cap), proof: permit.proof };
  const base = { address: DEPLOYMENT!.kinRouter, abi: kinRouterAbi, functionName: "swapExactIn" as const, value: wei };
  try {
    const { result: quoted } = await publicClient.simulateContract({
      ...base,
      args: [o.key, true, wei, 0n, allowance, BigInt(o.windowEnd)],
      account: w.account,
    });
    const minOut = ((quoted as bigint) * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
    const hash = await w.writeContract({ ...base, args: [o.key, true, wei, minOut, allowance, BigInt(o.windowEnd)] });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    return r.status === "success"
      ? { hash, ok: true, wei: wei.toString(), note: "bought; tokens are in the vault" }
      : { hash, ok: false, wei: wei.toString(), note: "the transaction reverted" };
  } catch (e) {
    if (!isCapExceeded(e)) throw e;
    // Send it anyway with a fixed gas limit: the revert (EntityCapExceeded from KinHook) is then on the explorer.
    try {
      const hash = await w.writeContract({ ...base, args: [o.key, true, wei, 0n, allowance, BigInt(o.windowEnd)], gas: 600_000n });
      await publicClient.waitForTransactionReceipt({ hash });
      return { hash, ok: false, wei: wei.toString(), note: "blocked by Kin: the shared limit was used" };
    } catch {
      return { ok: false, wei: wei.toString(), note: "blocked by Kin: the shared limit was used" };
    }
  }
}
