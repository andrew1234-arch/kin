"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { keccak256, parseEther, toBytes, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useReadContract, useSignMessage, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { Notice, Stat, Tx } from "@/components/bits";
import { Source } from "@/components/Source";
import { kinHookAbi, kinRouterAbi, kinVaultAbi } from "@/lib/abi";
import { api, ApiError, launchMirror, post, walletFromMirror } from "@/lib/api";
import { API_URL, DEPLOYMENT, LAUNCH_CHAIN_ID, LAUNCH_EXPLORER, SLIPPAGE_BPS } from "@/lib/config";
import { duration, eth, tokens } from "@/lib/format";
import { isInstant, phaseLabel, phaseOf, type LaunchView, type Permit, type Phase, type WalletStatus } from "@/lib/types";

const PHASES: { key: Phase[]; label: string }[] = [
  { key: ["registration", "building"], label: "Register" },
  { key: ["dispute"], label: "Dispute" },
  { key: ["window"], label: "Window" },
  { key: ["locked"], label: "Lock" },
  { key: ["claimable"], label: "Open" },
];
const INSTANT_PHASES: { key: Phase[]; label: string }[] = [
  { key: ["registration", "building", "dispute"], label: "Starts" },
  { key: ["window"], label: "Window" },
  { key: ["locked"], label: "Lock" },
  { key: ["claimable"], label: "Open" },
];
/** The engine hands out instant-launch limits from this long before the window opens. */
const PERMIT_PREVIEW_SEC = 600;

export default function LaunchPage() {
  const { slug } = useParams<{ slug: string }>();
  const [launch, setLaunch] = useState<LaunchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(() => {
    api<LaunchView>(`/launches/${slug}`)
      .then((l) => {
        setLaunch(l);
        setFromMirror(false);
      })
      .catch(async (e: ApiError) => {
        // Engine unreachable: fall back to the published static copy, so buyers still get their proofs.
        const m = e.status >= 500 ? await launchMirror(slug) : null;
        if (m) {
          setLaunch(m.launch);
          setFromMirror(true);
        } else setError(e.message);
      });
  }, [slug]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  if (error)
    return (
      <div className="empty">
        <h2>Launch not available</h2>
        <Notice tone="error">{error}</Notice>
        <Link className="btn btn-ghost" href="/launch">
          All launches
        </Link>
      </div>
    );
  if (!launch)
    return (
      <div aria-busy="true">
        <div className="launch-head skeleton" style={{ height: 120 }} />
      </div>
    );
  const phase = phaseOf(launch, now);
  const instant = isInstant(launch);
  const steps = instant ? INSTANT_PHASES : PHASES;
  const phaseIdx = steps.findIndex((p) => p.key.includes(phase));
  const o = launch.onchain;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/launch">Launches</Link>
        <span aria-hidden="true">/</span>
        <span>{launch.name}</span>
      </nav>
      <header className="launch-head">
        <span className="token-badge token-badge-lg" aria-hidden="true">
          {launch.symbol.slice(0, 2)}
        </span>
        <div className="launch-head-id">
          <h1>
            {launch.name} <span className="faint">${launch.symbol}</span>
          </h1>
          <div className="launch-head-meta">
            <span className={`phase-pill${(phase === "registration" && !instant) || phase === "window" ? " phase-pill-live" : ""}`}>{phaseLabel(launch, phase)}</span>
            <Source chainId={launch.chainId} />
          </div>
        </div>
        {o && now >= o.windowEnd && (
          <Link className="btn btn-ghost btn-sm" href={`/receipt/${launch.slug}`}>
            Fairness Receipt
          </Link>
        )}
      </header>

      <ol className={`stepper${steps.length === 4 ? " stepper-4" : ""}`} aria-label="Launch phase">
        {steps.map((p, i) => (
          <li key={p.label} className={i === phaseIdx ? "is-now" : i < phaseIdx ? "is-done" : undefined} aria-current={i === phaseIdx ? "step" : undefined}>
            <span className="stepper-dot" aria-hidden="true" />
            {p.label}
          </li>
        ))}
      </ol>
      <PhaseLine launch={launch} phase={phase} now={now} />
      {fromMirror && (
        <Notice tone="warn">The Kin engine is unreachable; showing the launch&apos;s published copy. Buying and claiming still work.</Notice>
      )}

      <div className="stats">
        {instant ? (
          <Stat label="wallets checked" value={launch.instant?.wallets ?? 0} sub="no registration: checked at buy time" />
        ) : (
          <Stat label="wallets registered" value={launch.registrations} />
        )}
        <Stat label="limit per entity" value={`${eth(launch.tiers.capWei)} ETH`} sub="linked wallets share one" />
        <Stat
          label="fresh-wallet pool"
          value={`${eth(launch.tiers.freshPoolCapWei)} ETH`}
          sub={instant ? "one limit shared by all fresh wallets" : "split evenly between fresh wallets"}
        />
        {launch.baseVerify && BigInt(launch.tiers.verifiedCapWei) > BigInt(launch.tiers.capWei) && (
          <Stat
            label="verified-human cap"
            value={`${eth(launch.tiers.verifiedCapWei)} ETH`}
            sub={`via Base Verify · ${launch.verifiedWallets ?? 0} verified`}
            tone="accent"
          />
        )}
        {instant && launch.instant && launch.instant.wallets > 0 && (
          <Stat
            label="entities so far"
            value={launch.instant.entities}
            sub={`${launch.instant.linkedWallets} linked · ${launch.instant.freshWallets} fresh`}
          />
        )}
        {launch.allowlist && (
          <Stat
            label="entities on the allowlist"
            value={launch.allowlist.stats.entities}
            sub={`${launch.allowlist.stats.linkedWallets} linked · ${launch.allowlist.stats.freshWallets} fresh`}
          />
        )}
      </div>

      <div className="launch-body">
        {instant ? <InstantWallet launch={launch} phase={phase} now={now} onChange={load} /> : <YourWallet launch={launch} phase={phase} now={now} onChange={load} />}
        {instant ? <InstantEvidence launch={launch} /> : <Evidence launch={launch} />}
      </div>

      {instant ? <Assignments launch={launch} /> : <Disputes launch={launch} phase={phase} onChange={load} />}
    </>
  );
}

function PhaseLine({ launch, phase, now }: { launch: LaunchView; phase: Phase; now: number }) {
  const o = launch.onchain;
  if (isInstant(launch)) {
    const t = {
      registration: "Deploying the launch.",
      building: "Deploying the launch.",
      dispute: o
        ? `No registration. The window opens in ${duration(o.windowStart - now)}; limits are handed out from 10 minutes before.`
        : "",
      window: o ? `Window open for ${duration(o.windowEnd - now)}. Connect and buy: Kin checks your wallet's funding when you buy and sets your limit.` : "",
      locked: o ? `Window closed; trading is open to everyone. Window buys unlock in ${duration(o.windowEnd + o.lockDuration - now)}.` : "",
      claimable: "Trading is open to everyone and window buys can be claimed.",
    }[phase];
    return <p className="phase-line">{t}</p>;
  }
  const text = {
    registration: `Registration closes in ${duration(launch.registrationClosesAt - now)}.`,
    building: launch.allowlist ? "Allowlist built; waiting for the launch to be deployed." : "Registration closed; the allowlist is being built.",
    dispute: o ? `Allowlist published. Disputes close and the window opens in ${duration(o.windowStart - now)}.` : "",
    window: o ? `Window open for ${duration(o.windowEnd - now)}: only allowlisted buys through the Kin router, within each entity's cap.` : "",
    locked: o ? `Window closed; trading is open to everyone. Window buys unlock in ${duration(o.windowEnd + o.lockDuration - now)}.` : "",
    claimable: "Trading is open to everyone and window buys can be claimed.",
  }[phase];
  return <p className="phase-line">{text}</p>;
}

// ------------------------------------------------------------------ your wallet

function YourWallet({ launch, phase, now, onChange }: { launch: LaunchView; phase: Phase; now: number; onChange: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "warn" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!address) return setStatus(null);
    api<WalletStatus>(`/launches/${launch.slug}/wallets/${address}`)
      .then(setStatus)
      .catch(async () => setStatus(await walletFromMirror(launch.slug, address)));
  }, [address, launch.slug]);
  useEffect(refresh, [refresh, launch.allowlist?.version]);

  if (!isConnected || !address) {
    return (
      <div className="card">
        <h3>Your wallet</h3>
        <p className="muted small">Connect a wallet to register, see your tier and cap, buy in the window and claim.</p>
      </div>
    );
  }

  const register = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { message } = await api<{ message: string }>(`/launches/${launch.slug}/messages/register?wallet=${address}`);
      const signature = await signMessageAsync({ message });
      await post(`/launches/${launch.slug}/register`, { wallet: address, signature });
      setMsg({ tone: "info", text: "Registered. Your tier and cap appear once the allowlist is built." });
      refresh();
      onChange();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message.split("\n")[0]! });
    } finally {
      setBusy(false);
    }
  };

  const e = status?.entry;
  return (
    <div className="card">
      <h3>Your wallet</h3>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {chainId !== LAUNCH_CHAIN_ID && (
        <p>
          <button className="btn btn-ghost btn-sm" onClick={() => switchChain({ chainId: LAUNCH_CHAIN_ID })}>
            Switch network
          </button>
        </p>
      )}
      {!status ? (
        <p className="muted small">Checking…</p>
      ) : e ? (
        <>
          <p>
            <span className={`pill pill-${e.tier}`}>{e.tier === "fresh" ? "fresh pool" : e.tier}</span>{" "}
            {e.tier === "linked" && <span className="small muted">You share one cap with {status.entityMembers! - 1} other wallet(s) funded from the same source.</span>}
            {e.tier === "fresh" && (
              <span className="small muted">
                New wallets split the {eth(launch.tiers.freshPoolCapWei)} ETH fresh pool evenly; this is your share.
              </span>
            )}
            {e.tier === "aged" && <span className="small muted">Your own entity and your own cap.</span>}
          </p>
          {launch.onchain ? <Onchain launch={launch} phase={phase} now={now} entityId={e.entityId as Hex} cap={BigInt(e.cap)} proof={e.proof as Hex[]} /> : <p className="small muted">Cap {eth(e.cap)} ETH. The launch isn&apos;t onchain yet.</p>}
        </>
      ) : status.registered ? (
        <>
          <p className="small muted">
            Registered{status.verified && <> · <span className="pill pill-verified">verified human</span></>}
            {launch.allowlist ? ", but not on the live allowlist. You can dispute below." : ". Your tier and cap appear once the allowlist is built."}
          </p>
          {status.verified && !launch.allowlist && (
            <p className="small">
              Verified with Base Verify: this wallet gets the {eth(launch.tiers.verifiedCapWei)} ETH verified-human cap when the
              allowlist is built.
            </p>
          )}
          {phase === "registration" && launch.baseVerify && !status.verified && BigInt(launch.tiers.verifiedCapWei) > BigInt(launch.tiers.capWei) && (
            <VerifyHuman slug={launch.slug} capWei={launch.tiers.verifiedCapWei} onVerified={refresh} />
          )}
        </>
      ) : phase === "registration" ? (
        <>
          <button className="btn btn-primary" onClick={register} disabled={busy}>
            {busy ? "Waiting for signature…" : "Register (free signature)"}
          </button>
          {launch.minBalanceWei && BigInt(launch.minBalanceWei) > 0n && (
            <p className="small faint" style={{ marginTop: 10 }}>
              The wallet needs at least {eth(launch.minBalanceWei)} ETH to register. Nothing is spent.
            </p>
          )}
        </>
      ) : (
        <p className="small muted">This wallet did not register. After the window, anyone can trade.</p>
      )}
    </div>
  );
}

/** Base Verify: a registered wallet proves a verified account (e.g. Coinbase) for the larger cap. */
function VerifyHuman({ slug, capWei, onVerified }: { slug: string; capWei: string; onVerified: () => void }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "warn" | "error"; text: string } | null>(null);
  const [redirect, setRedirect] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { message, nonce } = await api<{ message: string; nonce: string }>(`/launches/${slug}/verify/message?wallet=${address}`);
      const signature = await signMessageAsync({ message });
      const r = await post<{ kind: "verified" | "not_verified" | "traits_not_satisfied"; redirectUrl?: string }>(
        `/launches/${slug}/verify`,
        { wallet: address, nonce, signature },
      );
      if (r.kind === "verified") {
        setRedirect(null);
        setMsg({ tone: "info", text: "Verified. This wallet gets the verified-human cap when the allowlist is built." });
        onVerified();
      } else if (r.kind === "not_verified") {
        setRedirect(r.redirectUrl ?? null);
        setMsg({ tone: "warn", text: "No Base Verify verification for this wallet yet. Verify once with Base, then come back and try again." });
      } else {
        setMsg({ tone: "warn", text: "Your verified account doesn't meet this launch's requirements." });
      }
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message.split("\n")[0]! });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 12 }}>
      <p className="small muted">
        Verified humans get a larger cap ({eth(capWei)} ETH). One verified account can verify one wallet per launch.
      </p>
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={run} disabled={busy}>
          {busy ? "Checking…" : redirect ? "I've verified, check again" : "Verify with Base Verify"}
        </button>
        {redirect && (
          <a className="btn btn-sm" href={redirect} target="_blank" rel="noreferrer">
            Open Base Verify
          </a>
        )}
      </div>
      {msg && <div style={{ marginTop: 8 }}><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </div>
  );
}

function Onchain({ launch, phase, now, entityId, cap, proof }: { launch: LaunchView; phase: Phase; now: number; entityId: Hex; cap: bigint; proof: Hex[] }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const o = launch.onchain!;
  const spent = useReadContract({
    address: DEPLOYMENT?.kinHook,
    abi: kinHookAbi,
    functionName: "entitySpent",
    args: [o.poolId, entityId],
    query: { enabled: !!DEPLOYMENT, refetchInterval: 5000 },
  });
  const owed = useReadContract({
    address: DEPLOYMENT?.kinVault,
    abi: kinVaultAbi,
    functionName: "owed",
    args: [o.poolId, address!],
    query: { enabled: !!DEPLOYMENT && !!address, refetchInterval: 5000 },
  });
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (receipt.isSuccess) {
      spent.refetch();
      owed.refetch();
    }
  }, [receipt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = (spent.data as bigint | undefined) ?? 0n;
  const remaining = cap > s ? cap - s : 0n;
  const unlockAt = o.windowEnd + o.lockDuration;

  const buy = async () => {
    setErr(null);
    try {
      const wei = parseEther(amount);
      if (wei <= 0n || wei > remaining) throw new Error(`Enter up to ${eth(remaining)} ETH`);
      if (!client || !address) throw new Error("Wallet not ready");
      const allowance = { entityId, entityCap: cap, proof };
      // Quote the output now and require at least (1 - slippage) of it, so buys landing ahead in the same block
      // can't silently shrink this one.
      const { result: quoted } = await client.simulateContract({
        address: DEPLOYMENT!.kinRouter,
        abi: kinRouterAbi,
        functionName: "swapExactIn",
        args: [o.key, true, wei, 0n, allowance, BigInt(o.windowEnd)],
        value: wei,
        account: address,
      });
      const minOut = (quoted * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
      await writeContractAsync({
        address: DEPLOYMENT!.kinRouter,
        abi: kinRouterAbi,
        functionName: "swapExactIn",
        args: [o.key, true, wei, minOut, allowance, BigInt(o.windowEnd)],
        value: wei,
      });
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]!);
    }
  };
  const claim = async () => {
    setErr(null);
    try {
      await writeContractAsync({ address: DEPLOYMENT!.kinVault, abi: kinVaultAbi, functionName: "claim", args: [o.poolId] });
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]!);
    }
  };

  if (!DEPLOYMENT) return <Notice tone="warn">Contract addresses are not configured for this site.</Notice>;
  return (
    <>
      <dl className="kv">
        <dt>Entity cap</dt>
        <dd>{eth(cap)} ETH</dd>
        <dt>Entity spent</dt>
        <dd>{eth(s)} ETH</dd>
        <dt>Left for your entity</dt>
        <dd>{eth(remaining)} ETH</dd>
        <dt>In the vault</dt>
        <dd>{tokens((owed.data as bigint | undefined) ?? 0n)} ${launch.symbol}</dd>
      </dl>
      {phase === "window" && (
        <div className="row" style={{ marginTop: 14 }}>
          <input inputMode="decimal" placeholder={`ETH, up to ${eth(remaining)}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn" onClick={buy} disabled={isPending || receipt.isLoading || remaining === 0n}>
            {isPending || receipt.isLoading ? "Buying…" : "Buy"}
          </button>
        </div>
      )}
      {phase === "window" && (
        <p className="small faint" style={{ marginTop: 8 }}>
          Tokens go to the vault and unlock {duration(unlockAt - now)} from now. The buy reverts if it would get more than{" "}
          {SLIPPAGE_BPS / 100}% fewer tokens than quoted.
        </p>
      )}
      {phase === "claimable" && ((owed.data as bigint | undefined) ?? 0n) > 0n && (
        <button className="btn" style={{ marginTop: 14 }} onClick={claim} disabled={isPending || receipt.isLoading}>
          Claim from the vault
        </button>
      )}
      {hash && (
        <p className="small" style={{ marginTop: 10 }}>
          {receipt.isLoading ? "Confirming " : receipt.isSuccess ? "Confirmed " : receipt.isError ? "Failed " : ""}
          <Tx hash={hash} explorer={LAUNCH_EXPLORER} />
        </p>
      )}
      {err && <Notice tone="error">{err}</Notice>}
    </>
  );
}

// ------------------------------------------------------------------ instant launches

const TIER_NOTE: Record<Permit["tier"], (p: Permit, l: LaunchView) => string> = {
  linked: (p) =>
    `Kin traced this wallet's funding to ${p.via ? `${p.via.slice(0, 8)}…, ` : ""}the same source as ${p.entityMembers - 1} other wallet(s). You share one limit.`,
  fresh: (_p, l) => `A new wallet: it shares the ${eth(l.tiers.freshPoolCapWei)} ETH fresh-wallet pool with every other new wallet.`,
  aged: () => "No funding link to any other buyer: your own entity and your own limit.",
};

/** Instant launch: no registration. The wallet asks for its limit; the engine traces it and signs a permit. */
function InstantWallet({ launch, phase, now, onChange }: { launch: LaunchView; phase: Phase; now: number; onChange: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [permit, setPermit] = useState<Permit | null>(null);
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const o = launch.onchain;

  useEffect(() => {
    setPermit(null);
    setErr(null);
    if (!address) return setStatus(null);
    api<WalletStatus>(`/launches/${launch.slug}/wallets/${address}`).then(setStatus).catch(() => setStatus(null));
  }, [address, launch.slug]);

  const check = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setErr(null);
    try {
      setPermit(await post<Permit>(`/launches/${launch.slug}/permit`, { wallet: address }));
      onChange();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]!);
    } finally {
      setBusy(false);
    }
  }, [address, launch.slug, onChange]);

  // A permit lasts 10 minutes; fetch a new one (same entity, same limit) before it runs out.
  const expiring = !!permit && phase === "window" && now >= permit.deadline - 60;
  useEffect(() => {
    if (expiring && !busy) check();
  }, [expiring, busy, check]);

  if (!isConnected || !address) {
    return (
      <div className="card">
        <h3>Your wallet</h3>
        <p className="muted small">
          Connect a wallet to buy. There is no registration: Kin checks the wallet&apos;s funding when you buy and sets your limit.
        </p>
      </div>
    );
  }
  const handingOut = !!o && now >= o.windowStart - PERMIT_PREVIEW_SEC && now < o.windowEnd;
  const known = permit ?? (status?.entry ? { ...status.entry, entityMembers: status.entityMembers ?? 1 } : null);
  return (
    <div className="card">
      <h3>Your wallet</h3>
      {chainId !== LAUNCH_CHAIN_ID && (
        <p>
          <button className="btn btn-ghost btn-sm" onClick={() => switchChain({ chainId: LAUNCH_CHAIN_ID })}>
            Switch network
          </button>
        </p>
      )}
      {known && (
        <p>
          <span className={`pill pill-${known.tier}`}>{known.tier === "fresh" ? "fresh pool" : known.tier}</span>{" "}
          <span className="small muted">{TIER_NOTE[known.tier as Permit["tier"]]({ via: undefined, ...known } as Permit, launch)}</span>
        </p>
      )}
      {permit && o ? (
        <Onchain launch={launch} phase={phase} now={now} entityId={permit.entityId} cap={BigInt(permit.cap)} proof={permit.proof} />
      ) : known && o && !handingOut ? (
        <Onchain launch={launch} phase={phase} now={now} entityId={known.entityId as Hex} cap={BigInt(known.cap)} proof={[]} />
      ) : handingOut ? (
        <>
          <button className="btn btn-primary" onClick={check} disabled={busy}>
            {busy ? "Tracing funding…" : known ? "Get my permit" : "Check my limit"}
          </button>
          <p className="small faint" style={{ marginTop: 10 }}>
            Kin reads this wallet&apos;s funding (two hops, exchanges excluded) and signs a 10-minute permit for your limit. Nothing to
            sign; nothing is spent.
          </p>
        </>
      ) : o && now < o.windowStart - PERMIT_PREVIEW_SEC ? (
        <p className="small muted">Limits are handed out from 10 minutes before the window opens ({duration(o.windowStart - PERMIT_PREVIEW_SEC - now)}).</p>
      ) : o ? (
        <p className="small muted">This wallet did not buy in the window. Trading is open to everyone now.</p>
      ) : (
        <p className="small muted">The launch isn&apos;t onchain yet.</p>
      )}
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

/** The rules an instant launch runs by: the policy file, committed onchain by its hash at deploy. */
function InstantEvidence({ launch }: { launch: LaunchView }) {
  const o = launch.onchain;
  const onchainLaunch = useReadContract({
    address: DEPLOYMENT?.kinHook,
    abi: kinHookAbi,
    functionName: "getLaunch",
    args: o ? [o.poolId] : undefined,
    query: { enabled: !!DEPLOYMENT && !!o },
  });
  const signer = useReadContract({ address: DEPLOYMENT?.kinHook, abi: kinHookAbi, functionName: "permitSigner", query: { enabled: !!DEPLOYMENT } });
  const [fileHash, setFileHash] = useState<Hex | null>(null);
  useEffect(() => {
    if (!o || !API_URL) return;
    fetch(`${API_URL}/launches/${launch.slug}/evidence.json`)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => setFileHash(keccak256(toBytes(t))))
      .catch(() => setFileHash(null));
  }, [launch.slug, o]);
  const chain = onchainLaunch.data as { root: Hex; evidenceHash: Hex } | undefined;
  const ok = chain && fileHash ? chain.evidenceHash.toLowerCase() === fileHash.toLowerCase() : null;
  return (
    <div className="card">
      <h3>Rules and evidence</h3>
      <p className="muted small">
        No allowlist. The rules below are fixed at deploy: their hash is onchain, and KinHook only accepts permits signed by the launch&apos;s
        permit signer.
      </p>
      <dl className="kv small">
        <dt>Policy hash</dt>
        <dd className="mono">{chain?.evidenceHash ?? launch.instant?.evidenceHash ?? "not deployed"}</dd>
        <dt>Permit signer</dt>
        <dd className="mono">{(signer.data as string | undefined) ?? "…"}</dd>
        <dt>Check</dt>
        <dd>
          {ok === null ? (
            <span className="faint">{o ? "checking…" : "committed onchain at deploy"}</span>
          ) : ok ? (
            <span className="check-ok">✓ the published rules hash to the onchain commitment</span>
          ) : (
            <span className="check-bad">✕ the published rules do not match the onchain hash</span>
          )}
        </dd>
        {o && (
          <>
            <dt>Launch tx</dt>
            <dd>
              <Tx hash={o.launchTx} explorer={LAUNCH_EXPLORER} />
            </dd>
          </>
        )}
      </dl>
      {o && (
        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn btn-ghost btn-sm" href={`${API_URL}/launches/${launch.slug}/evidence.json`} target="_blank" rel="noreferrer">
            Policy file
          </a>
          <a className="btn btn-ghost btn-sm" href={`${API_URL}/launches/${launch.slug}/permits`} target="_blank" rel="noreferrer">
            Every limit handed out
          </a>
        </div>
      )}
    </div>
  );
}

interface Assignment {
  wallet: string;
  entityId: string;
  tier: Permit["tier"];
  cap: string;
  at: number;
  via?: string;
}

/** Every limit the engine handed out, in order, with the funding link behind each join. */
function Assignments({ launch }: { launch: LaunchView }) {
  const [list, setList] = useState<Assignment[] | null>(null);
  const count = launch.instant?.wallets ?? 0;
  useEffect(() => {
    if (!launch.onchain) return;
    api<Assignment[]>(`/launches/${launch.slug}/permits`).then(setList).catch(() => setList(null));
  }, [launch.slug, launch.onchain, count]);
  const sizes = new Map<string, number>();
  for (const a of list ?? []) sizes.set(a.entityId, (sizes.get(a.entityId) ?? 0) + 1);
  const shown = (list ?? []).slice(-50).reverse();
  return (
    <>
      <h2>Who got which limit</h2>
      <p className="muted small">
        Instant launches have no dispute period: limits are set when a wallet buys. In exchange, every assignment is public, with the
        funding link that put a wallet in an entity, and each window buy&apos;s entity is in KinHook&apos;s WindowBuy event.
      </p>
      {!list || list.length === 0 ? (
        <Notice>No wallet has asked for a limit yet.</Notice>
      ) : (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Tier</th>
                <th>Entity</th>
                <th>Limit</th>
                <th>Linked through</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const tier = a.tier === "aged" && (sizes.get(a.entityId) ?? 1) > 1 ? "linked" : a.tier;
                return (
                  <tr key={a.wallet}>
                    <td className="mono">{a.wallet.slice(0, 10)}…</td>
                    <td>
                      <span className={`pill pill-${tier}`}>{tier === "fresh" ? "fresh pool" : tier}</span>
                    </td>
                    <td className="mono">
                      {a.entityId.slice(0, 10)}… <span className="faint">({sizes.get(a.entityId)} wallet{sizes.get(a.entityId) === 1 ? "" : "s"})</span>
                    </td>
                    <td>{eth(a.cap)} ETH</td>
                    <td className="mono">{a.via ? `${a.via.slice(0, 10)}…` : <span className="faint">none</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ evidence

function Evidence({ launch }: { launch: LaunchView }) {
  const o = launch.onchain;
  const onchainLaunch = useReadContract({
    address: DEPLOYMENT?.kinHook,
    abi: kinHookAbi,
    functionName: "getLaunch",
    args: o ? [o.poolId] : undefined,
    query: { enabled: !!DEPLOYMENT && !!o },
  });
  const [fileHash, setFileHash] = useState<Hex | null>(null);
  useEffect(() => {
    if (!launch.allowlist || !API_URL) return;
    fetch(`${API_URL}/launches/${launch.slug}/evidence.json`)
      .then((r) => r.text())
      .then((t) => setFileHash(keccak256(toBytes(t))))
      .catch(() => setFileHash(null));
  }, [launch.slug, launch.allowlist, o?.rootVersion]);

  if (!launch.allowlist) {
    return (
      <div className="card">
        <h3>Allowlist and evidence</h3>
        <p className="muted small">Published when registration closes, before the window opens.</p>
      </div>
    );
  }
  const chain = onchainLaunch.data as { root: Hex; evidenceHash: Hex } | undefined;
  const evidenceOk = chain && fileHash ? chain.evidenceHash.toLowerCase() === fileHash.toLowerCase() : null;
  return (
    <div className="card">
      <h3>Allowlist and evidence</h3>
      <dl className="kv small">
        <dt>Version</dt>
        <dd>
          v{o?.rootVersion ?? launch.allowlist.version}
          {o && launch.allowlist.version > o.rootVersion && <span className="faint"> (v{launch.allowlist.version} built, not yet onchain)</span>}
        </dd>
        <dt>Merkle root</dt>
        <dd className="mono">{chain?.root ?? launch.allowlist.root}</dd>
        <dt>Evidence hash</dt>
        <dd className="mono">{chain?.evidenceHash ?? launch.allowlist.evidenceHash}</dd>
        <dt>Check</dt>
        <dd>
          {evidenceOk === null ? (
            <span className="faint">{o ? "checking…" : "committed onchain at deploy"}</span>
          ) : evidenceOk ? (
            <span className="check-ok">✓ the published file hashes to the onchain commitment</span>
          ) : (
            <span className="check-bad">✕ the published file does not match the onchain hash</span>
          )}
        </dd>
        {o && (
          <>
            <dt>Launch tx</dt>
            <dd>
              <Tx hash={o.launchTx} explorer={LAUNCH_EXPLORER} />
            </dd>
          </>
        )}
      </dl>
      <div className="row" style={{ marginTop: 12 }}>
        <a className="btn btn-ghost btn-sm" href={`${API_URL}/launches/${launch.slug}/evidence.json`} target="_blank" rel="noreferrer">
          Evidence file
        </a>
        <a className="btn btn-ghost btn-sm" href={`${API_URL}/launches/${launch.slug}/allowlist`} target="_blank" rel="noreferrer">
          Allowlist + proofs
        </a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ disputes

function Disputes({ launch, phase, onChange }: { launch: LaunchView; phase: Phase; onChange: () => void }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const open = phase === "registration" || phase === "building" || phase === "dispute";
  const submit = async () => {
    setMsg(null);
    try {
      const { message } = await api<{ message: string }>(
        `/launches/${launch.slug}/messages/dispute?wallet=${address}&reason=${encodeURIComponent(reason.trim())}`,
      );
      const signature = await signMessageAsync({ message });
      await post(`/launches/${launch.slug}/disputes`, { wallet: address, reason: reason.trim(), signature });
      setReason("");
      setMsg({ tone: "info", text: "Dispute filed. The launcher reviews it before the window opens." });
      onChange();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message.split("\n")[0]! });
    }
  };
  return (
    <>
      <h2>Disputes</h2>
      <p className="muted small">
        Think you were linked by mistake, or left out? Any wallet can dispute until the window opens. Accepted disputes
        change the allowlist, which is rebuilt and re-committed onchain before the window.
      </p>
      {open && address && (
        <div className="card">
          <label htmlFor="reason">Reason</label>
          <textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I funded this wallet from my own exchange account" style={{ marginTop: 6 }} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={submit} disabled={reason.trim().length < 3}>
              Sign and file dispute
            </button>
          </div>
          {msg && <div style={{ marginTop: 10 }}><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        </div>
      )}
      {open && !address && <Notice>Connect a wallet to file a dispute.</Notice>}
      {!open && <Notice>Disputes closed when the window opened.</Notice>}
      {launch.disputes.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Wallet</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {launch.disputes.map((d) => (
                <tr key={d.id}>
                  <td>{d.id}</td>
                  <td className="mono">{d.wallet.slice(0, 8)}…</td>
                  <td style={{ whiteSpace: "normal", minWidth: 220 }}>{d.reason}</td>
                  <td>
                    <span className="pill">{d.status}</span> {d.resolution && <span className="small muted">{d.resolution}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
