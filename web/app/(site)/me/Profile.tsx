"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { Copy, Notice, Tx } from "@/components/bits";
import { WalletButton } from "@/components/WalletButton";
import { kinHookAbi, kinTokenAbi, kinVaultAbi } from "@/lib/abi";
import { api, ApiError, post } from "@/lib/api";
import { addrUrl, DEPLOYMENT, LAUNCH_EXPLORER } from "@/lib/config";
import { duration, eth, short, tokens } from "@/lib/format";
import { addressOf, loadTestWallets, onTestWalletsChange, publicClient, ROLE_LABEL, ROLES, walletFor, type TestWallets } from "@/lib/testWallets";
import { phaseLabel, phaseOf, type LaunchView, type Permit } from "@/lib/types";
import { useNow } from "@/lib/useNow";

interface WalletLaunch {
  slug: string;
  name: string;
  symbol: string;
  mode: "allowlist" | "instant";
  demo: boolean;
  registered: boolean;
  permit: (Omit<Permit, "proof" | "deadline"> & { at: number; entityMembers: number }) | null;
}
interface Position {
  spent: bigint;
  owed: bigint;
  held: bigint;
}

/** Wallets this visitor can act for: the connected one and the test wallets in this browser. */
function useOwnWallets() {
  const { address, connector } = useAccount();
  const [tw, setTw] = useState<TestWallets | null>(null);
  useEffect(() => {
    setTw(loadTestWallets());
    return onTestWalletsChange(() => setTw(loadTestWallets()));
  }, []);
  return useMemo(() => {
    const list: { address: Address; label: string; key?: Hex }[] = [];
    if (address && connector?.type !== "kinTestWallet") list.push({ address, label: "Connected wallet" });
    if (tw) for (const r of ROLES) list.push({ address: addressOf(tw.keys[r]), label: `Test wallet: ${ROLE_LABEL[r]}`, key: tw.keys[r] });
    return list;
  }, [address, connector?.type, tw]);
}

export function Profile() {
  const now = useNow();
  const own = useOwnWallets();
  const [viewing, setViewing] = useState<Address | null>(null);
  const [fromUrl, setFromUrl] = useState<Address | null>(null);
  const [rows, setRows] = useState<WalletLaunch[] | null>(null);
  const [launches, setLaunches] = useState<Record<string, LaunchView>>({});
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [balance, setBalance] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; hash?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("address");
    if (q && isAddress(q)) setFromUrl(q as Address);
  }, []);
  const address = viewing ?? fromUrl ?? own[0]?.address ?? null;
  const mine = own.find((w) => w.address.toLowerCase() === address?.toLowerCase()) ?? null;

  const load = useCallback(async () => {
    if (!address) return;
    setErr(null);
    publicClient.getBalance({ address }).then(setBalance).catch(() => setBalance(null));
    try {
      const [w, ls] = await Promise.all([api<{ launches: WalletLaunch[] }>(`/wallets/${address}`), api<LaunchView[]>("/launches")]);
      setRows(w.launches);
      const byslug = Object.fromEntries(ls.map((l) => [l.slug, l]));
      setLaunches(byslug);
      const pos: Record<string, Position> = {};
      await Promise.all(
        w.launches.map(async (r) => {
          const o = byslug[r.slug]?.onchain;
          if (!o || !DEPLOYMENT) return;
          const [spent, owed, held] = await Promise.all([
            r.permit
              ? (publicClient.readContract({ address: DEPLOYMENT.kinHook, abi: kinHookAbi, functionName: "entitySpent", args: [o.poolId, r.permit.entityId] }) as Promise<bigint>)
              : Promise.resolve(0n),
            publicClient.readContract({ address: DEPLOYMENT.kinVault, abi: kinVaultAbi, functionName: "owed", args: [o.poolId, address] }) as Promise<bigint>,
            publicClient.readContract({ address: o.token as Address, abi: kinTokenAbi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
          ]).catch(() => [0n, 0n, 0n] as bigint[]);
          pos[r.slug] = { spent: spent!, owed: owed!, held: held! };
        }),
      );
      setPositions(pos);
    } catch (e) {
      setErr((e as Error).message);
      setRows(null);
    }
  }, [address]);
  useEffect(() => {
    setRows(null);
    setPositions({});
    load();
  }, [load]);

  const faucet = async () => {
    if (!address) return;
    setBusy("faucet");
    setNote(null);
    try {
      const r = await post<{ hash: string }>("/faucet", { wallet: address });
      setNote({ text: "Test ETH sent.", hash: r.hash });
      load();
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const claim = async (l: LaunchView) => {
    if (!mine || !l.onchain || !DEPLOYMENT) return;
    setBusy(`claim:${l.slug}`);
    setNote(null);
    try {
      const call = { address: DEPLOYMENT.kinVault, abi: kinVaultAbi, functionName: "claim" as const, args: [l.onchain.poolId] as const };
      const hash = mine.key ? await walletFor(mine.key).writeContract(call) : await writeContractAsync(call);
      await publicClient.waitForTransactionReceipt({ hash });
      setNote({ text: `Claimed your $${l.symbol}.`, hash });
      load();
    } catch (e) {
      setNote({ text: (e as Error).message.split("\n")[0]! });
    } finally {
      setBusy(null);
    }
  };

  if (!address) {
    return (
      <>
        <header className="page-head">
          <div>
            <p className="eyebrow">Profile</p>
            <h1>Your Kin profile</h1>
            <p className="lede">Connect a wallet to see the entity and limit Kin gave it in each launch, what&apos;s in the vault, and your claims.</p>
          </div>
        </header>
        <div className="row" style={{ marginTop: 24 }}>
          <WalletButton />
          <Link className="btn btn-ghost" href="/flow">
            No wallet? Take the test drive
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Profile{mine ? "" : " · read only"}</p>
          <h1 className="mono profile-addr">{short(address, 6)}</h1>
          <p className="lede">
            {mine?.label ?? "Any wallet's record is public."} <Copy text={address} />{" "}
            {addrUrl(LAUNCH_EXPLORER, address) && (
              <a href={addrUrl(LAUNCH_EXPLORER, address)!} target="_blank" rel="noreferrer">
                Explorer
              </a>
            )}
          </p>
        </div>
      </header>

      {own.length > 1 && (
        <div className="filters" role="tablist" aria-label="Wallet">
          {own.map((w) => (
            <button
              key={w.address}
              role="tab"
              aria-selected={w.address === address}
              className="filter"
              onClick={() => setViewing(w.address)}
            >
              {w.label.replace("Test wallet: ", "")}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-3 profile-stats">
        <div className="stat">
          <div className="stat-value tnum">{balance === null ? "…" : eth(balance, 5)}</div>
          <div className="stat-label">Base Sepolia ETH</div>
          {mine && (
            <div className="stat-sub">
              <button className="linkish" onClick={faucet} disabled={busy === "faucet"}>
                {busy === "faucet" ? "Sending…" : "Get test ETH"}
              </button>
            </div>
          )}
        </div>
        <div className="stat">
          <div className="stat-value tnum">{rows ? rows.length : "…"}</div>
          <div className="stat-label">Launches with a limit</div>
        </div>
        <div className="stat">
          <div className="stat-value tnum">{rows ? new Set(rows.map((r) => r.permit?.tier).filter(Boolean)).size === 0 ? "–" : rows.filter((r) => r.permit?.tier === "linked").length : "…"}</div>
          <div className="stat-label">Times linked to other wallets</div>
        </div>
      </div>

      {note && (
        <Notice>
          {note.text} {note.hash && <Tx hash={note.hash} explorer={LAUNCH_EXPLORER} />}
        </Notice>
      )}
      {err && <Notice tone="error">{err}</Notice>}

      <h2>Launches</h2>
      {rows && rows.length === 0 && (
        <div className="card">
          <p className="muted">This wallet has no limit in any launch yet. Kin assigns one when a wallet asks to buy in a window.</p>
          <div className="row">
            <Link className="btn btn-primary" href="/flow">
              Take the test drive
            </Link>
            <Link className="btn btn-ghost" href="/launch">
              Browse launches
            </Link>
          </div>
        </div>
      )}
      {rows && rows.length > 0 && now !== null && (
        <div className="profile-list">
          {rows.map((r) => {
            const l = launches[r.slug];
            const p = positions[r.slug];
            const phase = l ? phaseOf(l, now) : null;
            const unlockAt = l?.onchain ? l.onchain.windowEnd + l.onchain.lockDuration : null;
            return (
              <article key={r.slug} className="card profile-row">
                <div className="profile-row-head">
                  <div>
                    <h3>
                      <Link href={`/launch/${r.slug}`}>{r.name}</Link> <span className="faint small">${r.symbol}</span>
                    </h3>
                    {l && phase && <span className="pill">{phaseLabel(l, phase)}</span>}
                  </div>
                  {r.permit && <span className={`pill pill-${r.permit.tier}`}>{r.permit.tier === "fresh" ? "fresh pool" : r.permit.tier}</span>}
                </div>
                <dl className="kv">
                  {r.permit ? (
                    <>
                      <dt>Entity</dt>
                      <dd>
                        <span className="mono">{short(r.permit.entityId, 4)}</span>{" "}
                        <span className="faint small">
                          {r.permit.entityMembers} wallet{r.permit.entityMembers === 1 ? "" : "s"}
                          {r.permit.via ? `, linked via ${short(r.permit.via)}` : ""}
                        </span>
                      </dd>
                      <dt>Entity limit</dt>
                      <dd>{eth(r.permit.cap, 6)} ETH</dd>
                      <dt>Entity spent</dt>
                      <dd>{p ? `${eth(p.spent, 6)} ETH` : "…"}</dd>
                    </>
                  ) : (
                    <>
                      <dt>Registered</dt>
                      <dd>{r.registered ? "yes" : "no"}</dd>
                    </>
                  )}
                  <dt>In the vault</dt>
                  <dd>{p ? `${tokens(p.owed)} $${r.symbol}` : "…"}</dd>
                  <dt>In the wallet</dt>
                  <dd>{p ? `${tokens(p.held)} $${r.symbol}` : "…"}</dd>
                </dl>
                {p && p.owed > 0n && unlockAt !== null && (
                  <div className="row" style={{ marginTop: 14 }}>
                    {phase === "claimable" ? (
                      mine ? (
                        <button className="btn btn-primary btn-sm" onClick={() => l && claim(l)} disabled={busy === `claim:${r.slug}`}>
                          {busy === `claim:${r.slug}` ? "Claiming…" : "Claim from the vault"}
                        </button>
                      ) : (
                        <span className="small muted">Claimable by the wallet owner.</span>
                      )
                    ) : (
                      <span className="small muted">Unlocks in {duration(unlockAt - now)}.</span>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {!rows && !err && <p className="muted">Loading…</p>}
    </>
  );
}
