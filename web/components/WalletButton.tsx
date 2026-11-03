"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { short } from "@/lib/format";

export function WalletButton() {
  const { address, isConnected } = useAccount();
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
      <button className="btn btn-ghost btn-sm mono" onClick={() => disconnect()} title="Disconnect">
        {short(address)}
      </button>
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
              {c.name === "Injected" ? "Browser wallet" : c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
