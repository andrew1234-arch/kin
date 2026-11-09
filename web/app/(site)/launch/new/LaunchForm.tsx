"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Notice } from "@/components/bits";
import { ApiError, post } from "@/lib/api";
import { REPO_URL } from "@/lib/site";
import type { LaunchView } from "@/lib/types";

const WINDOWS = [
  { v: 15, l: "15 minutes" },
  { v: 30, l: "30 minutes" },
  { v: 60, l: "1 hour" },
  { v: 180, l: "3 hours" },
  { v: 1440, l: "24 hours" },
];
const LOCKS = [
  { v: 0, l: "No lock" },
  { v: 10, l: "10 minutes" },
  { v: 60, l: "1 hour" },
  { v: 1440, l: "1 day" },
];

/**
 * Launch a token on Kin from the site: the engine creates the launch and deploys its pool on Base Sepolia, then
 * this page opens the new launch. No wallet or ETH needed from the creator on the test network.
 */
export function LaunchForm() {
  const router = useRouter();
  const { address } = useAccount();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [cap, setCap] = useState("0.001");
  const [windowMin, setWindowMin] = useState(60);
  const [lockMin, setLockMin] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sym = symbol.trim().replace(/^\$/, "").toUpperCase();
  const okName = /^[\p{L}\p{N} .'&!-]{2,32}$/u.test(name.trim());
  const okSym = /^[A-Z0-9]{2,8}$/.test(sym);
  const okCap = /^\d*\.?\d+$/.test(cap.trim()) && Number(cap) >= 0.0001 && Number(cap) <= 0.05;
  const ready = okName && okSym && okCap && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      const l = await post<LaunchView>("/launches", { name: name.trim(), symbol: sym, capEth: cap.trim(), windowMin, lockMin, creator: address });
      router.push(`/launch/${l.slug}?created=1`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="newlaunch-grid">
      <form className="card newlaunch-form" onSubmit={submit} noValidate>
        <fieldset>
          <legend>Your token</legend>
          <div className="field-pair">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Night Shift" maxLength={32} autoComplete="off" />
              <p className={name && !okName ? "field-error" : "field-hint"}>{name && !okName ? "2 to 32 letters, numbers or spaces" : " "}</p>
            </div>
            <div className="field">
              <label htmlFor="symbol">Symbol</label>
              <input id="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="SHIFT" maxLength={9} autoComplete="off" />
              <p className={symbol && !okSym ? "field-error" : "field-hint"}>{symbol && !okSym ? "2 to 8 letters or numbers" : " "}</p>
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Fair-launch rules</legend>
          <div className="field">
            <label htmlFor="cap">Limit per buyer</label>
            <div className="field-input">
              <input id="cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={!okCap || undefined} />
              <span className="field-suffix">ETH</span>
            </div>
            <p className={okCap ? "field-hint" : "field-error"}>
              {okCap ? "Wallets funded by the same source share this one limit." : "Between 0.0001 and 0.05 ETH"}
            </p>
          </div>
          <div className="field-pair">
            <div className="field">
              <label htmlFor="window">Buying window</label>
              <select id="window" value={windowMin} onChange={(e) => setWindowMin(Number(e.target.value))}>
                {WINDOWS.map((w) => (
                  <option key={w.v} value={w.v}>
                    {w.l}
                  </option>
                ))}
              </select>
              <p className="field-hint">Limits apply during the window.</p>
            </div>
            <div className="field">
              <label htmlFor="lock">Lock after the window</label>
              <select id="lock" value={lockMin} onChange={(e) => setLockMin(Number(e.target.value))}>
                {LOCKS.map((w) => (
                  <option key={w.v} value={w.v}>
                    {w.l}
                  </option>
                ))}
              </select>
              <p className="field-hint">Window buys can be claimed after this.</p>
            </div>
          </div>
        </fieldset>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="row" style={{ marginTop: 8, alignItems: "center", gap: 14 }}>
          <button className="btn btn-primary btn-lg" type="submit" disabled={!ready}>
            {busy ? "Deploying on Base Sepolia…" : "Launch token"}
          </button>
          <span className="faint small">{busy ? "About 10 seconds." : "Free on the test network. No wallet needed."}</span>
        </div>
      </form>

      <aside className="config-card newlaunch-preview" aria-label="Preview">
        <div className="config-card-head">
          <span className="token-badge" aria-hidden="true">
            {(sym || "YT").slice(0, 2)}
          </span>
          <div>
            <p className="config-card-name">{name.trim() || "Your token"}</p>
            <p className="mono faint small">${sym || "YOURS"}</p>
          </div>
        </div>
        <dl className="config-list">
          <div>
            <dt>Chain</dt>
            <dd>Base Sepolia</dd>
          </div>
          <div>
            <dt>Buying opens</dt>
            <dd>~32 min after launch</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>{WINDOWS.find((w) => w.v === windowMin)?.l}</dd>
          </div>
          <div>
            <dt>Limit per buyer</dt>
            <dd>{okCap ? `${cap.trim()} ETH` : "–"}</dd>
          </div>
          <div>
            <dt>Lock</dt>
            <dd>{LOCKS.find((w) => w.v === lockMin)?.l}</dd>
          </div>
          <div>
            <dt>Supply</dt>
            <dd>1,000,000,000</dd>
          </div>
        </dl>
        <figcaption>
          The 32-minute wait is enforced by the contract, so buyers can check the rules before buying opens.{" "}
          <a href={`${REPO_URL}#go-live-base-sepolia--base-mainnet-read-only`} target="_blank" rel="noreferrer">
            Run your own Kin
          </a>
          .
        </figcaption>
      </aside>
    </div>
  );
}
