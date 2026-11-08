"use client";

import Link from "next/link";
import { Source } from "@/components/Source";
import { duration, eth } from "@/lib/format";
import { isInstant, phaseLabel, phaseOf, type LaunchView, type Phase } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const ACTION: Record<Phase, string> = {
  registration: "Register",
  building: "View launch",
  dispute: "Check your cap",
  window: "Buy now",
  locked: "View launch",
  claimable: "Claim tokens",
};
const INSTANT_ACTION: Record<Phase, string> = { ...ACTION, registration: "View launch", dispute: "View launch", window: "Buy now" };

function nextStep(l: LaunchView, phase: Phase, now: number): string {
  const o = l.onchain;
  switch (phase) {
    case "registration":
      return `Registration closes in ${duration(l.registrationClosesAt - now)}`;
    case "building":
      return l.allowlist ? "Allowlist built, deploying soon" : "Building the allowlist";
    case "dispute":
      return `${isInstant(l) ? "No registration. " : ""}Window opens in ${duration(o!.windowStart - now)}`;
    case "window":
      return `Window closes in ${duration(o!.windowEnd - now)}`;
    case "locked":
      return `Window buys unlock in ${duration(o!.windowEnd + o!.lockDuration - now)}`;
    case "claimable":
      return "Open trading, window buys claimable";
  }
}

/** One launch as a card: identity, phase, the numbers a buyer cares about, and the next action. */
export function LaunchCard({ launch }: { launch: LaunchView }) {
  const now = useNow();
  const phase = now ? phaseOf(launch, now) : null;
  const instant = isInstant(launch);
  const live = (phase === "registration" && !instant) || phase === "window";
  return (
    <Link href={`/launch/${launch.slug}`} className="launch-card">
      <div className="launch-card-top">
        <span className="token-badge" aria-hidden="true">
          {launch.symbol.slice(0, 2)}
        </span>
        {phase && <span className={`phase-pill${live ? " phase-pill-live" : ""}`}>{phaseLabel(launch, phase)}</span>}
      </div>
      <div className="launch-card-id">
        <h3>{launch.name}</h3>
        <span className="mono faint">${launch.symbol}</span>
      </div>
      <dl className="launch-card-nums">
        <div>
          <dt>{instant ? "Buyers" : "Registered"}</dt>
          <dd>{instant ? (launch.instant?.wallets ?? 0) : launch.registrations}</dd>
        </div>
        <div>
          <dt>Entity limit</dt>
          <dd>{eth(launch.tiers.capWei)} ETH</dd>
        </div>
        <div>
          <dt>Lock</dt>
          <dd>{duration(launch.onchain?.lockDuration ?? launch.window.lockSec)}</dd>
        </div>
      </dl>
      <div className="launch-card-foot">
        <span className="small muted">{phase && now ? nextStep(launch, phase, now) : " "}</span>
        <span className="launch-card-cta">
          {phase ? (instant ? INSTANT_ACTION : ACTION)[phase] : "View launch"}
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" className="arrow">
            <path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <div className="launch-card-src">
        <Source chainId={launch.chainId} />
      </div>
    </Link>
  );
}
