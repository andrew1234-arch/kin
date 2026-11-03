"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@/components/bits";
import { api } from "@/lib/api";
import { eth } from "@/lib/format";
import { phaseOf, type LaunchView } from "@/lib/types";

const PHASE_LABEL = {
  registration: "Registration open",
  building: "Building allowlist",
  dispute: "Dispute period",
  window: "Window open",
  locked: "Vault locked",
  claimable: "Open trading",
} as const;

export default function Launches() {
  const [list, setList] = useState<LaunchView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<LaunchView[]>("/launches").then(setList).catch((e) => setError(e.message));
  }, []);
  const now = Math.floor(Date.now() / 1000);
  return (
    <>
      <h1>Launches</h1>
      <p className="lede">Kin launches on Base Sepolia. Register, check your tier and cap, read the evidence, dispute, buy, claim.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {list && list.length === 0 && <Notice>No launches yet.</Notice>}
      <div className="grid grid-2" style={{ marginTop: 20 }}>
        {list?.map((l) => (
          <Link key={l.slug} href={`/launch/${l.slug}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>
                {l.name} <span className="muted">${l.symbol}</span>
              </h3>
              <span className="pill pill-accent">{PHASE_LABEL[phaseOf(l, now)]}</span>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              {l.registrations} registered · cap {eth(l.tiers.capWei)} ETH per entity · fresh pool {eth(l.tiers.freshPoolCapWei)} ETH
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
