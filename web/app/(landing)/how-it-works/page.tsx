import type { Metadata } from "next";
import Link from "next/link";
import { FlowDemo } from "@/components/FlowDiagram";
import { KinFacts } from "@/components/KinFacts";
import { AllocationStrip, FanOut, LimitComparison } from "@/components/landing/Diagrams";
import { RevealObserver } from "@/components/landing/Reveal";
import { REPO_URL } from "@/lib/site";

function SectionHead({ idx, eyebrow, title, lede }: { idx: string; eyebrow: string; title: React.ReactNode; lede?: React.ReactNode }) {
  return (
    <header className="sec-head reveal">
      <p className="eyebrow">
        <span className="idx">[ {idx} ]</span> {eyebrow}
      </p>
      <h2 className="display-2">{title}</h2>
      {lede && <p className="sec-lede">{lede}</p>}
    </header>
  );
}

const STEPS = [
  {
    icon: "M12 3v12M7 8l5-5 5 5M5 21h14",
    title: "The creator launches",
    body: "Kin deploys the token and a Uniswap v4 pool guarded by KinHook, with a buy window and a lock period. The hash of the launch's rules is stored onchain.",
  },
  {
    icon: "M8 8a3 3 0 1 1 0 .01M16 16a3 3 0 1 1 0 .01M10.4 10.4l3.2 3.2",
    title: "Kin traces the buyer",
    body: "When a wallet asks to buy, Kin's engine looks at where its ETH came from, up to two transfers back, and puts it in an entity. No sign-up, nothing to sign.",
  },
  {
    icon: "M4 17 9.5 11.5l3.5 3.5L20 8M15 8h5v5",
    title: "The pool checks the limit",
    body: "The engine signs a permit with the wallet's entity and limit. In every window buy, KinHook checks the signature and adds the buy to the entity's total. A buy over the limit reverts.",
  },
  {
    icon: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
    title: "Lock, then open trading",
    body: "Window buys go to a vault and can be claimed when the lock ends. After the window, the pool works like any other pool, for everyone.",
  },
];

const TIERS = [
  {
    fig: "linked",
    title: "Linked wallets share one limit",
    body: "A wallet funded by an earlier buyer, or by the same wallet as an earlier buyer (up to two transfers back), joins that buyer's entity.",
  },
  {
    fig: "fresh",
    title: "New wallets share one pool",
    body: "A wallet with no history yet, or one funded more recently than the launch allows, joins a single pool shared by every new wallet. A farm of fresh wallets can't multiply its limit.",
  },
  {
    fig: "own",
    title: "Everyone else gets their own",
    body: "A wallet with no funding link to another buyer is its own entity, with the full limit.",
  },
];

const TECH = [
  {
    k: "KinHook",
    meta: "Uniswap v4 hook · Solidity",
    v: "Blocks swaps before the window. During the window it only accepts buys through KinRouter with a valid permit, and keeps one running total per entity. After the window it steps aside.",
  },
  {
    k: "KinRouter and KinVault",
    meta: "Solidity",
    v: "The router carries the permit into the swap. The vault holds window buys until the lock ends.",
  },
  {
    k: "Kin engine",
    meta: "Bun + TypeScript",
    v: "Traces funding through a transfer-history API, assigns entities, and signs permits (EIP-712) for the hook. It also runs the test-ETH faucet and keeps a demo launch open.",
  },
  {
    k: "Kin Scan",
    meta: "Base mainnet · read-only",
    v: "Runs a funding analysis on the early buyers of any token already on Base mainnet, to show which of them were funded by the same source.",
  },
  {
    k: "Allowlist mode",
    meta: "Optional",
    v: "Creators who want a review step can have wallets register first. The entities go into a Merkle root that is committed before the window, and a wrongly linked wallet can dispute the link.",
  },
];

const CHECKS = [
  { t: "The rules", d: "The hash of each launch's rules file is stored by the hook when the launch is deployed. Hash the published file and compare." },
  { t: "Every limit", d: "Every entity and limit Kin hands out is public, with the funding transfers that led to it." },
  { t: "Every buy", d: "Each window buy emits a WindowBuy event with the entity it was charged to, and the hook exposes each entity's total." },
  { t: "The result", d: "Each launch has a Fairness Receipt: what was bought, by how many entities, and what was refused." },
];

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Kin gives wallets funded from the same source one shared purchase limit, enforced in the pool by a Uniswap v4 hook.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return (
    <>
      <RevealObserver />
      <header className="hiw-head wrap">
        <p className="eyebrow">
          <span className="dot" /> How it works
        </p>
        <h1 className="display-2">Kin limits people, not wallets.</h1>
        <p className="sec-lede">
          One person can split their money across many wallets and buy most of a launch. Kin groups wallets that were funded
          from the same place and gives each group one limit, enforced by the pool itself.
        </p>
        <div className="card hiw-flow">
          <FlowDemo />
        </div>
        <nav className="hiw-toc" aria-label="On this page">
          <a href="#problem">The problem</a>
          <a href="#idea">The idea</a>
          <a href="#steps">Step by step</a>
          <a href="#tiers">Who shares a limit</a>
          <a href="#tech">The tech</a>
          <a href="#check">Check it yourself</a>
          <a href="#limits">Limits</a>
        </nav>
      </header>

      <section id="problem" className="s-light sec" aria-labelledby="problem-title">
        <div className="wrap split-5-7">
          <SectionHead
            idx="01"
            eyebrow="The problem"
            title={
              <span id="problem-title">
                One person. Ten wallets. <span className="muted-ink">Ten times the allowance.</span>
              </span>
            }
            lede="A per-wallet limit caps addresses, not buyers. Split one balance across ten new wallets and the allowance is ten times larger. To the pool it looks like ten strangers."
          />
          <figure className="problem-fig reveal">
            <FanOut />
            <AllocationStrip />
            <figcaption className="fig-note">Illustration. Twenty buys at the same per-wallet limit.</figcaption>
          </figure>
        </div>
      </section>

      <section id="idea" className="s-dark sec" aria-labelledby="idea-title">
        <div className="wrap">
          <SectionHead
            idx="02"
            eyebrow="The idea"
            title={
              <span id="idea-title">
                Limit entities, <span className="muted-ink">not wallets.</span>
              </span>
            }
            lede="Other launchpads slow down or charge every early buyer. Kin leaves ordinary buyers alone and only joins up wallets that share a funding source."
          />
          <div className="reveal">
            <LimitComparison />
          </div>
        </div>
      </section>

      <section id="steps" className="s-light sec" aria-labelledby="steps-title">
        <div className="wrap">
          <SectionHead idx="03" eyebrow="Step by step" title={<span id="steps-title">A Kin launch, in four steps.</span>} />
          <ol className="steps reveal">
            {STEPS.map((s, i) => (
              <li key={s.title} className="step">
                <div className="step-top">
                  <span className="step-icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24">
                      <path d={s.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="step-n mono">0{i + 1}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="tiers" className="s-dark sec" aria-labelledby="tiers-title">
        <div className="wrap">
          <SectionHead
            idx="04"
            eyebrow="Who shares a limit"
            title={<span id="tiers-title">Three rules, applied when a wallet buys.</span>}
            lede="Exchanges are left out of the trace, so two people who withdrew from the same exchange aren't linked. Kin's test-ETH faucet is treated the same way."
          />
          <ol className="steps steps-3 reveal">
            {TIERS.map((s) => (
              <li key={s.title} className="step">
                <TierFig kind={s.fig as "linked" | "fresh" | "own"} />
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="tech" className="s-light sec" aria-labelledby="tech-title">
        <div className="wrap">
          <SectionHead
            idx="05"
            eyebrow="The tech"
            title={
              <span id="tech-title">
                What runs where. <span className="muted-ink">All of it open source.</span>
              </span>
            }
          />
          <div className="spec reveal">
            {TECH.map((t) => (
              <div key={t.k} className="spec-row">
                <div className="spec-key">
                  <p className="eyebrow">{t.k}</p>
                  <p className="spec-meta mono">{t.meta}</p>
                </div>
                <div className="spec-val">
                  <p>{t.v}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="tech-src reveal">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Read the source on GitHub
              <Arrow />
            </a>
          </p>
        </div>
      </section>

      <section id="check" className="s-dark sec" aria-labelledby="check-title">
        <div className="wrap split-5-7">
          <SectionHead
            idx="06"
            eyebrow="Check it yourself"
            title={<span id="check-title">Nothing to take on trust that you can&apos;t check.</span>}
            lede="Kin's engine decides who is linked. Everything it decides is published, and everything the pool enforced is onchain."
          />
          <ul className="ev-list reveal">
            {CHECKS.map((c, i) => (
              <li key={c.t}>
                <span className="mono">0{i + 1}</span>
                <div>
                  <h3>{c.t}</h3>
                  <p>{c.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="limits" className="s-light sec sec-tight" aria-labelledby="limits-title">
        <div className="wrap">
          <SectionHead idx="07" eyebrow="Limits" title={<span id="limits-title">What Kin does, and what it doesn&apos;t.</span>} />
          <div className="reveal">
            <KinFacts title="In short" />
          </div>
        </div>
      </section>

      <section className="s-dark sec sec-tight hiw-end">
        <div className="wrap cta-grid">
          <h2 className="display-2">See it for yourself in two minutes.</h2>
          <div className="ctas">
            <Link className="btn btn-primary btn-lg" href="/flow">
              Try to bundle a launch
              <Arrow />
            </Link>
            <Link className="btn btn-ghost btn-lg" href="/launch/new">
              Launch with Kin
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="arrow">
      <path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small picture of each rule: who funds whom, and how many limit bars they get. */
function TierFig({ kind }: { kind: "linked" | "fresh" | "own" }) {
  const bar = (x: number, h: number, key: string) => (
    <g key={key}>
      <rect x={x} y={14} width={14} height={56} rx={4} className="tf-track" />
      <rect x={x} y={70 - h} width={14} height={h} rx={4} className="tf-fill" />
    </g>
  );
  return (
    <svg className="tier-fig" viewBox="0 0 220 84" aria-hidden="true">
      {kind === "linked" && (
        <>
          <circle cx={22} cy={42} r={9} className="tf-src" />
          {[18, 42, 66].map((y) => (
            <g key={y}>
              <path d={`M 31 42 C 60 42 60 ${y} 90 ${y}`} className="tf-edge" />
              <circle cx={98} cy={y} r={7} className="tf-w is-linked" />
            </g>
          ))}
          <rect x={84} y={6} width={28} height={72} rx={12} className="tf-ring" />
          <path d="M 112 42 H 160" className="tf-edge" />
          {bar(170, 30, "b")}
        </>
      )}
      {kind === "fresh" && (
        <>
          {[14, 34, 54, 74].map((y, i) => (
            <g key={y}>
              <circle cx={40 + (i % 2) * 26} cy={y} r={6.5} className="tf-w is-new" />
              <path d={`M ${47 + (i % 2) * 26} ${y} C 120 ${y} 120 42 160 42`} className="tf-edge" />
            </g>
          ))}
          {bar(170, 22, "b")}
        </>
      )}
      {kind === "own" && (
        <>
          {[16, 42, 68].map((y, i) => (
            <g key={y}>
              <circle cx={22} cy={y} r={6} className="tf-src is-other" />
              <path d={`M 28 ${y} H 70`} className="tf-edge" />
              <circle cx={78} cy={y} r={7} className="tf-w" />
              <path d={`M 85 ${y} H ${120 + i * 26}`} className="tf-edge" />
            </g>
          ))}
          {bar(124, 34, "b1")}
          {bar(150, 20, "b2")}
          {bar(176, 44, "b3")}
        </>
      )}
    </svg>
  );
}
