"use client";

import { useEffect, useState } from "react";

/**
 * Kin's mechanism as one picture: a source funds wallets, Kin links the wallets it funded into one buyer, and their
 * buys hit one shared limit in the pool, which refuses what goes over it. Driven by props, so the same diagram shows
 * a live run (Try it, the sandbox) or a looping illustration (FlowDemo).
 */
export type FlowBuy = "idle" | "pending" | "landed" | "blocked";
export interface FlowWallet {
  label: string;
  funded: boolean;
  linked: boolean;
  buy: FlowBuy;
}

const W = 640;
const SX = 78;
const WX = 318;
const PX = 520;
const PW = 92;

function bez(p0: number[], p1: number[], p2: number[], p3: number[], t: number) {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * p0[i]! + 3 * u * u * t * p1[i]! + 3 * u * t * t * p2[i]! + t * t * t * p3[i]!);
}

export function FlowDiagram({
  source,
  sourceSub,
  wallets,
  fill,
  capLabel,
  className,
}: {
  source: string;
  sourceSub?: string;
  wallets: FlowWallet[];
  /** Share of the entity's limit used, 0 to 1. */
  fill: number;
  capLabel?: string;
  className?: string;
}) {
  const n = wallets.length;
  const few = n <= 6;
  const gap = few ? 64 : Math.max(14, Math.min(24, 360 / n));
  const H = Math.max(250, few ? n * gap + 70 : n * gap + 70);
  const cy = H / 2;
  const r = few ? 14 : 6;
  const ys = wallets.map((_, i) => cy + (i - (n - 1) / 2) * gap);
  const top = Math.min(...ys);
  const bot = Math.max(...ys);
  const allLinked = n > 0 && wallets.every((w) => w.linked);
  const poolTop = Math.max(26, cy - 100);
  const poolBot = Math.min(H - 26, cy + 100);
  const trackTop = poolTop + 34;
  const trackBot = poolBot - 14;
  const fillH = Math.max(0, Math.min(1, fill)) * (trackBot - trackTop);
  const anyFunded = wallets.some((w) => w.funded);

  return (
    <svg className={`fd ${className ?? ""}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Funding source, wallets, Kin's shared limit and the pool">
      {/* source */}
      <g className={`fd-source${anyFunded ? " is-on" : ""}`}>
        <circle cx={SX} cy={cy} r={24} />
        <text x={SX} y={cy + 44} className="fd-label" textAnchor="middle">
          {source}
        </text>
        {sourceSub && (
          <text x={SX} y={cy + 60} className="fd-sub" textAnchor="middle">
            {sourceSub}
          </text>
        )}
      </g>

      {/* funding edges */}
      {wallets.map((w, i) => {
        const d = `M ${SX + 24} ${cy} C ${SX + 130} ${cy} ${WX - 130} ${ys[i]} ${WX - r - 2} ${ys[i]}`;
        return (
          <g key={`f${i}`}>
            <path d={d} className="fd-edge-bg" />
            <path d={d} pathLength={1} className={`fd-edge${w.funded ? " is-on" : ""}`} style={{ transitionDelay: `${few ? i * 0.18 : i * 0.03}s` }} />
          </g>
        );
      })}

      {/* entity ring */}
      <g className={`fd-entity${allLinked ? " is-on" : ""}`}>
        <rect x={WX - (few ? 60 : 30)} y={top - (few ? 30 : 18)} width={few ? 120 : 60} height={bot - top + (few ? 70 : 36)} rx={few ? 22 : 14} />
        <text x={WX} y={top - (few ? 38 : 26)} textAnchor="middle" className="fd-entity-label">
          Kin: one buyer
        </text>
      </g>

      {/* buy edges */}
      {wallets.map((w, i) => {
        const py = Math.max(trackTop + 6, Math.min(trackBot - 6, ys[i]!));
        const p0 = [WX + r + 2, ys[i]!];
        const p1 = [WX + 90, ys[i]!];
        const p2 = [PX - 90, py];
        const p3 = [PX, py];
        const d = `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${p3[0]} ${p3[1]}`;
        const x = bez(p0, p1, p2, p3, 0.72);
        return (
          <g key={`b${i}`} className={`fd-buy is-${w.buy}`}>
            <path d={d} pathLength={1} />
            {w.buy === "landed" && few && (
              <g transform={`translate(${PX - 12} ${py})`} className="fd-ok">
                <circle r={9} />
                <path d="M -4 0 L -1 3 L 4 -3" />
              </g>
            )}
            {w.buy === "blocked" && (
              <g transform={`translate(${x[0]} ${x[1]})`} className="fd-no">
                <circle r={few ? 11 : 6} />
                {few && <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" />}
              </g>
            )}
          </g>
        );
      })}

      {/* wallets */}
      {wallets.map((w, i) => (
        <g key={`w${i}`} className={`fd-wallet${w.funded ? " is-funded" : ""}${w.linked ? " is-linked" : ""}`}>
          <circle cx={WX} cy={ys[i]} r={r} />
          {few && (
            <text x={WX} y={ys[i]! + r + 15} textAnchor="middle" className="fd-sub">
              {w.label}
            </text>
          )}
        </g>
      ))}

      {/* pool with the shared limit */}
      <g className="fd-pool">
        <rect x={PX} y={poolTop} width={PW} height={poolBot - poolTop} rx={16} className="fd-pool-box" />
        <text x={PX + PW / 2} y={poolTop + 22} textAnchor="middle" className="fd-label">
          Pool
        </text>
        <rect x={PX + PW / 2 - 14} y={trackTop} width={28} height={trackBot - trackTop} rx={6} className="fd-track" />
        <rect x={PX + PW / 2 - 14} y={trackBot - fillH} width={28} height={fillH} rx={6} className={`fd-fill${fill >= 0.999 ? " is-full" : ""}`} />
        <line x1={PX + PW / 2 - 22} x2={PX + PW / 2 + 22} y1={trackTop} y2={trackTop} className="fd-limit" />
        {capLabel && (
          <text x={PX + PW / 2} y={poolBot + 18} textAnchor="middle" className="fd-sub">
            {capLabel}
          </text>
        )}
      </g>
    </svg>
  );
}

/** A looping illustration of the mechanism (not live data): fund, link, two buys fill the limit, the third is refused. */
const DEMO_STEPS: { at: number; caption: string; funded: boolean; linked: boolean; buys: FlowBuy[]; fill: number }[] = [
  { at: 0, caption: "One person, three wallets.", funded: false, linked: false, buys: ["idle", "idle", "idle"], fill: 0 },
  { at: 1200, caption: "They fund all three from one wallet.", funded: true, linked: false, buys: ["idle", "idle", "idle"], fill: 0 },
  { at: 3000, caption: "Kin traces the funding: same source, so one buyer.", funded: true, linked: true, buys: ["idle", "idle", "idle"], fill: 0 },
  { at: 4800, caption: "Each wallet buys. They share one limit.", funded: true, linked: true, buys: ["pending", "idle", "idle"], fill: 0 },
  { at: 5800, caption: "Each wallet buys. They share one limit.", funded: true, linked: true, buys: ["landed", "pending", "idle"], fill: 0.5 },
  { at: 6800, caption: "Each wallet buys. They share one limit.", funded: true, linked: true, buys: ["landed", "landed", "pending"], fill: 1 },
  { at: 7800, caption: "The third buy goes over the limit. The pool refuses it.", funded: true, linked: true, buys: ["landed", "landed", "blocked"], fill: 1 },
];
const DEMO_LOOP = 11_500;

export function FlowDemo({ className }: { className?: string }) {
  const [t, setT] = useState(DEMO_STEPS[DEMO_STEPS.length - 1]!.at);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = Date.now();
    setT(0);
    const id = setInterval(() => setT((Date.now() - start) % DEMO_LOOP), 200);
    return () => clearInterval(id);
  }, []);
  const s = [...DEMO_STEPS].reverse().find((x) => t >= x.at)!;
  return (
    <figure className={`fd-demo ${className ?? ""}`}>
      <FlowDiagram
        source="Funder"
        sourceSub="one wallet"
        wallets={["Wallet A", "Wallet B", "Wallet C"].map((label, i) => ({ label, funded: s.funded, linked: s.linked, buy: s.buys[i]! }))}
        fill={s.fill}
        capLabel="shared limit"
      />
      <figcaption aria-live="polite">{s.caption}</figcaption>
    </figure>
  );
}
