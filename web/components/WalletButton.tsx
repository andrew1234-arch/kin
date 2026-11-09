"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { short } from "@/lib/format";

const LABEL: Record<string, string> = { Injected: "Browser wallet" };

export function WalletButton() {
  const { address, isConnected, connector } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (!mounted) return <button className="btn btn-ghost btn-sm" disabled>Wallet</button>;
  if (isConnected && address) {
    return (
      <div className="menu" ref={ref}>
        <button className="btn btn-ghost btn-sm mono" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
          {connector?.type === "kinTestWallet" && <span className="wallet-tag">test</span>}
          {short(address)}
        </button>
        {open && (
          <div className="menu-list" role="menu">
            <Link role="menuitem" href="/me" onClick={() => setOpen(false)}>
              Profile
            </Link>
            <Link role="menuitem" href="/flow" onClick={() => setOpen(false)}>
              Try it
            </Link>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect"}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {connectors.map((c) => (
            <button
              key={c.uid}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                connect({ connector: c });
              }}
            >
              {LABEL[c.name] ?? c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
