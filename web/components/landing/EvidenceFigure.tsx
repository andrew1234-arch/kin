"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { keccak256, toBytes } from "viem";
import { ClusterMap, type ClusterEntity } from "@/components/ClusterMap";
import { API_URL } from "@/lib/config";
import { useEngine } from "@/lib/engine";
import { short } from "@/lib/format";
import type { LaunchView, Link as EvidenceLink } from "@/lib/types";
import { Source } from "@/components/Source";

interface EvidenceFile {
  schema: string;
  merkleRoot: string;
  method?: unknown;
  entities: { entityId: string; tier: string; capWei: string; members: string[]; links: EvidenceLink[] }[];
}

type State =
  | { kind: "loading" }
  | { kind: "none"; why: string }
  | { kind: "ok"; launch: LaunchView; entity: EvidenceFile["entities"][number]; hashOk: boolean; entityCount: number };

/** Labelled sample shown only when no engine has published evidence. Clearly marked as an illustration. */
const ILLUSTRATIVE: ClusterEntity = (() => {
  const addr = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(20)}`;
  const funder = addr(0xf0);
  const members = [1, 2, 3, 4, 5].map((n) => addr(n * 0x11));
  return {
    members,
    funders: [funder],
    links: members.slice(1).map((m) => ({
      a: members[0],
      b: m,
      reason: "same_direct_funder" as const,
      weight: 1,
      via: funder,
      hops: [1, 1] as [number, number],
      txHashes: [],
    })),
  };
})();

function linkRecord(l: EvidenceLink) {
  const s = (x: string) => short(x, 4);
  return JSON.stringify(
    {
      a: s(l.a),
      b: s(l.b),
      reason: l.reason,
      weight: l.weight,
      ...(l.via ? { via: s(l.via) } : {}),
      hops: l.hops,
      ...(l.block ? { block: l.block } : {}),
      txHashes: l.txHashes.slice(0, 2).map(s).concat(l.txHashes.length > 2 ? [`+${l.txHashes.length - 2} more`] : []),
    },
    null,
    2,
  ).replace(/\[\s+(\d+),\s+(\d+)\s+\]/g, "[$1, $2]");
}

export function EvidenceFigure() {
  const snap = useEngine();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (snap.status === "loading") return;
    if (snap.status !== "ok") {
      setState({ kind: "none", why: "No Kin engine is connected to this site." });
      return;
    }
    const launch = snap.launches.find((l) => l.allowlist);
    if (!launch?.allowlist) {
      setState({ kind: "none", why: "No launch on this engine has published an allowlist yet." });
      return;
    }
    const expected = launch.allowlist.evidenceHash;
    let live = true;
    fetch(`${API_URL}/launches/${launch.slug}/evidence.json`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`evidence.json returned ${r.status}`);
        return r.text();
      })
      .then((text) => {
        const file = JSON.parse(text) as EvidenceFile;
        const linked = file.entities.filter((e) => e.links.length > 0).sort((a, b) => b.members.length - a.members.length);
        if (!live) return;
        if (!linked[0]) {
          setState({ kind: "none", why: `${launch.name}'s evidence file has no linked entities to draw.` });
          return;
        }
        setState({
          kind: "ok",
          launch,
          entity: linked[0],
          entityCount: file.entities.length,
          hashOk: keccak256(toBytes(text)).toLowerCase() === expected.toLowerCase(),
        });
      })
      .catch((e: Error) => live && setState({ kind: "none", why: `Could not read the evidence file: ${e.message}` }));
    return () => {
      live = false;
    };
  }, [snap]);

  if (state.kind === "loading") return <div className="ev-figure live-skeleton" aria-busy="true" />;

  if (state.kind === "none") {
    return (
      <figure className="ev-figure">
        <div className="ev-figure-head">
          <span className="source source-info">
            <i aria-hidden="true" />
            Illustration
          </span>
          <span className="faint small">{state.why}</span>
        </div>
        <div className="ev-map">
          <ClusterMap entity={ILLUSTRATIVE} />
        </div>
        <figcaption>Five wallets with one direct funder. Real entities are drawn from each launch&apos;s evidence file.</figcaption>
      </figure>
    );
  }

  const { launch, entity, hashOk, entityCount } = state;
  return (
    <figure className="ev-figure">
      <div className="ev-figure-head">
        <Source chainId={launch.chainId} kind="Published evidence" />
        <span className="faint small">
          {launch.name} · evidence v{launch.allowlist!.version} · {entityCount} entities
        </span>
      </div>
      <div className="ev-map">
        <ClusterMap entity={entity} />
      </div>
      <figcaption>
        Entity <span className="mono">{short(entity.entityId, 4)}</span>: {entity.members.length} wallets,{" "}
        {entity.links.length} evidence link{entity.links.length === 1 ? "" : "s"}, one cap.
      </figcaption>
      <pre className="ev-record" aria-label="One link record from the evidence file">
        <code>{linkRecord(entity.links[0])}</code>
      </pre>
      <p className={`ev-hash ${hashOk ? "check-ok" : "check-bad"}`}>
        {hashOk
          ? "✓ Your browser hashed this file and it matches the evidence hash the engine published."
          : "✕ This file does not hash to the evidence hash the engine published."}
      </p>
      <p className="faint small">
        The launch page goes one step further and checks the same hash against the value stored onchain.{" "}
        <Link href={`/launch/${launch.slug}`}>Check it there</Link>.
      </p>
    </figure>
  );
}
