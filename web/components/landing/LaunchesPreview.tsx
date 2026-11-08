"use client";

import Link from "next/link";
import { LaunchCard } from "@/components/LaunchCard";
import { useEngine } from "@/lib/engine";
import { phaseOf, type LaunchView } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const OPEN = new Set(["registration", "window", "dispute", "building"]);

/** Open launches first, then the most recent. */
function pick(list: LaunchView[], now: number): LaunchView[] {
  return [...list]
    .sort((a, b) => Number(OPEN.has(phaseOf(b, now))) - Number(OPEN.has(phaseOf(a, now))) || b.createdAt - a.createdAt)
    .slice(0, 3);
}

/** The landing page's launch shelf: real launches from the engine, or an honest empty state. */
export function LaunchesPreview() {
  const snap = useEngine();
  const now = useNow();

  if (snap.status === "loading" || now === null) {
    return (
      <div className="launch-grid" aria-busy="true">
        <div className="launch-card skeleton" />
        <div className="launch-card skeleton" />
        <div className="launch-card skeleton" />
      </div>
    );
  }

  if (snap.status !== "ok" || snap.launches.length === 0) {
    const why =
      snap.status === "unconfigured"
        ? "This site is not connected to a Kin engine, so there are no launches to show."
        : snap.status === "offline"
          ? "The Kin engine is not reachable right now, so launches cannot be listed."
          : "There are no launches on this engine yet.";
    return (
      <div className="empty empty-wide">
        <h3>No launches to show</h3>
        <p className="muted">{why}</p>
        <Link className="btn btn-primary" href="/launch/new">
          Launch with Kin
        </Link>
      </div>
    );
  }

  return (
    <div className="launch-grid">
      {pick(snap.launches, now).map((l) => (
        <LaunchCard key={l.slug} launch={l} />
      ))}
    </div>
  );
}
