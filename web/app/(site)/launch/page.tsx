"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@/components/bits";
import { LaunchCard } from "@/components/LaunchCard";
import { api } from "@/lib/api";
import { phaseOf, type LaunchView, type Phase } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const FILTERS: { key: string; label: string; phases: Phase[] }[] = [
  { key: "all", label: "All", phases: [] },
  { key: "open", label: "Open now", phases: ["registration", "window"] },
  { key: "soon", label: "Upcoming", phases: ["building", "dispute"] },
  { key: "done", label: "Ended", phases: ["locked", "claimable"] },
];

export default function Launches() {
  const [list, setList] = useState<LaunchView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const now = useNow();
  useEffect(() => {
    api<LaunchView[]>("/launches")
      .then((l) => setList([...l].sort((a, b) => b.createdAt - a.createdAt)))
      .catch((e) => setError(e.message));
  }, []);
  // Open launches first when there are any: ended demo launches pile up over a week.
  useEffect(() => {
    if (filter || !list || !now) return;
    setFilter(list.some((l) => ["registration", "window"].includes(phaseOf(l, now))) ? "open" : "all");
  }, [filter, list, now]);
  const f = FILTERS.find((x) => x.key === (filter ?? "all"))!;
  const shown = list && now ? list.filter((l) => !f.phases.length || f.phases.includes(phaseOf(l, now))) : list;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Launches</p>
          <h1>Fair launches on Kin</h1>
          <p className="lede">
            Connect, see your limit, buy in the window. Wallets funded by the same source share one limit, enforced in the
            pool. New here? <Link href="/flow">Take the two-minute test drive</Link>: test wallets and test ETH included.
          </p>
        </div>
        <Link className="btn btn-primary" href="/launch/new">
          Launch with Kin
        </Link>
      </header>

      <div className="filters" role="tablist" aria-label="Filter launches">
        {FILTERS.map((x) => (
          <button key={x.key} role="tab" aria-selected={filter === x.key} className="filter" onClick={() => setFilter(x.key)}>
            {x.label}
            {list && now && (
              <span className="filter-n">{list.filter((l) => !x.phases.length || x.phases.includes(phaseOf(l, now))).length}</span>
            )}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!list && !error && (
        <div className="launch-grid" aria-busy="true">
          <div className="launch-card skeleton" />
          <div className="launch-card skeleton" />
        </div>
      )}
      {list && list.length === 0 && (
        <div className="empty">
          <h2>No launches yet</h2>
          <p className="muted">The first launch on this engine starts here.</p>
          <Link className="btn btn-primary" href="/launch/new">
            Launch with Kin
          </Link>
        </div>
      )}
      {shown && shown.length > 0 && (
        <div className="launch-grid">
          {shown.map((l) => (
            <LaunchCard key={l.slug} launch={l} />
          ))}
        </div>
      )}
      {list && list.length > 0 && shown?.length === 0 && <p className="muted">No launches in this group right now.</p>}
    </>
  );
}
