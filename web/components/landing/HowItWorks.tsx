"use client";

import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    title: "Register",
    body: "Wallets sign a registration message for the launch before it opens. Signing is free: no gas, no deposit.",
    tag: "7 wallets registered",
  },
  {
    title: "Analyze funding",
    body: "The engine traces where each wallet's funds came from, in ETH or a listed funding token, up to two hops back. Exchanges are excluded, and every link keeps the transaction hashes that prove it.",
    tag: "Funding traced, tx hashes kept",
  },
  {
    title: "Group related wallets",
    body: "Each type of evidence carries a weight. Pairs whose evidence reaches 1.0 merge into one entity. Fresh wallets, with no history or younger than the launch allows, split one pooled cap evenly instead of getting one each.",
    tag: "3 entities from 7 wallets",
  },
  {
    title: "Enforce entity limits",
    body: "A Merkle root binds every wallet to its entity and cap. During the window, the KinHook keeps one running total per entity. A buy that would pass it reverts.",
    tag: "One running total per entity",
  },
  {
    title: "Lock and publish",
    body: "The root and a hash of the evidence file go onchain before the window, and anyone can dispute until it opens. Window buys sit in the KinVault until the lock ends, so they can't be flipped on the spot.",
    tag: "Root + evidence hash onchain",
  },
];

// Fixed layout for the stage illustration (viewBox 560 x 420).
const A = [
  { x: 86, y: 214 },
  { x: 146, y: 176 },
  { x: 206, y: 214 },
  { x: 146, y: 252 },
];
const B = { x: 324, y: 214 };
const FRESH = [
  { x: 440, y: 198 },
  { x: 498, y: 236 },
];
const F1 = { x: 146, y: 86 };
const F2 = { x: 324, y: 86 };

function on(stage: number, from: number) {
  return stage >= from ? " on" : "";
}

function StageVisual({ stage }: { stage: number }) {
  const wallets = [...A, B, ...FRESH];
  return (
    <svg className="sv" viewBox="0 0 560 420" role="img" aria-label={`Stage ${stage}: ${STEPS[stage - 1].title}`}>
      {/* 5: chain commitment band */}
      <g className={`sv-el${on(stage, 5)}`}>
        <rect x="20" y="16" width="520" height="34" rx="17" className="sv-chain" />
        <text x="40" y="38" className="sv-mono sv-chain-text">
          ONCHAIN  merkleRoot · keccak256(evidence.json)
        </text>
      </g>

      {/* 2: funders and funding edges */}
      <g className={`sv-el${on(stage, 2)}`}>
        {A.map((w, i) => (
          <line key={i} className="sv-edge" x1={F1.x} y1={F1.y + 14} x2={w.x} y2={w.y - 12} pathLength={1} />
        ))}
        <line className="sv-edge sv-edge-quiet" x1={F2.x} y1={F2.y + 14} x2={B.x} y2={B.y - 12} pathLength={1} />
        <circle cx={F1.x} cy={F1.y} r="14" className="sv-funder" />
        <circle cx={F2.x} cy={F2.y} r="11" className="sv-funder sv-funder-quiet" />
        <text x={F1.x + 24} y={F1.y + 4} className="sv-mono">FUNDER</text>
        <text x={F2.x + 20} y={F2.y + 4} className="sv-mono sv-quiet">OLD FUNDER, 1 WALLET</text>
        <text x="469" y="150" textAnchor="middle" className="sv-mono sv-quiet">NO HISTORY</text>
      </g>

      {/* 3: entity rings */}
      <g className={`sv-el${on(stage, 3)}`}>
        <ellipse cx="146" cy="214" rx="96" ry="72" className="sv-ring" pathLength={1} />
        <circle cx={B.x} cy={B.y} r="34" className="sv-ring sv-ring-quiet" pathLength={1} />
        <ellipse cx="469" cy="217" rx="66" ry="52" className="sv-ring sv-ring-fresh" pathLength={1} />
        <text x="146" y="306" textAnchor="middle" className="sv-mono sv-accent">ENTITY A · 4 WALLETS</text>
        <text x={B.x} y="270" textAnchor="middle" className="sv-mono sv-quiet">ENTITY B</text>
        <text x="469" y="291" textAnchor="middle" className="sv-mono sv-fresh">FRESH POOL</text>
      </g>

      {/* 4: one cap per entity */}
      <g className={`sv-el${on(stage, 4)}`}>
        <rect x="66" y="330" width="160" height="10" rx="5" className="sv-track" />
        <rect x="66" y="330" width="160" height="10" rx="5" className="sv-fill sv-grow" />
        <rect x="294" y="330" width="60" height="10" rx="5" className="sv-track" />
        <rect x="294" y="330" width="42" height="10" rx="5" className="sv-fill sv-fill-quiet sv-grow" />
        <rect x="414" y="330" width="110" height="10" rx="5" className="sv-track" />
        <rect x="414" y="330" width="88" height="10" rx="5" className="sv-fill sv-fill-fresh sv-grow" />
        <text x="66" y="362" className="sv-mono">1 CAP, SHARED BY 4</text>
        <text x="294" y="362" className="sv-mono sv-quiet">1 CAP</text>
        <text x="414" y="362" className="sv-mono sv-fresh">1 POOLED CAP</text>
      </g>

      {/* 5: lock */}
      <g className={`sv-el${on(stage, 5)}`}>
        <rect x="20" y="380" width="520" height="30" rx="15" className="sv-vault" />
        <g transform="translate(38 386)" className="sv-lock">
          <rect x="0" y="7" width="13" height="10" rx="2" />
          <path d="M3 7 V5 a3.5 3.5 0 0 1 7 0 V7" fill="none" />
        </g>
        <text x="60" y="400" className="sv-mono">KINVAULT · WINDOW BUYS LOCKED UNTIL THE LOCK ENDS</text>
      </g>

      {/* 1: wallets, always present */}
      {wallets.map((w, i) => {
        const fresh = i >= 5;
        return (
          <g key={i} className="sv-wallet-g">
            <circle cx={w.x} cy={w.y} r="14" className={`sv-wallet${fresh && stage >= 2 ? " sv-wallet-fresh" : ""}`} />
            <g className={`sv-el sv-check${stage === 1 ? " on" : ""}`}>
              <circle cx={w.x + 12} cy={w.y - 12} r="6.5" />
              <path d={`M${w.x + 9.2} ${w.y - 12} l2 2 l3.6 -3.8`} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** Five steps with a sticky illustration that builds up stage by stage as the steps scroll past. */
export function HowItWorks() {
  const [stage, setStage] = useState(1);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setStage(Number((e.target as HTMLElement).dataset.stage));
        }
      },
      // A step becomes current when it crosses the middle band of the viewport.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="how">
      <div className="how-visual">
        <div className="how-canvas s-light">
          <StageVisual stage={stage} />
          <div className="how-canvas-foot">
            <span className="mono">
              {String(stage).padStart(2, "0")} / 05
            </span>
            <span>{STEPS[stage - 1].tag}</span>
          </div>
        </div>
        <p className="how-note">Illustration of the pipeline. Live launch data is further down the page.</p>
      </div>
      <ol className="how-steps">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-stage={i + 1}
            className={stage === i + 1 ? "is-current" : undefined}
          >
            <span className="how-idx mono">{String(i + 1).padStart(2, "0")}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
