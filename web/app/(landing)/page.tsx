import Link from "next/link";
import { KinFacts } from "@/components/KinFacts";
import { HeroScene } from "@/components/landing/HeroScene";
import { LaunchesPreview } from "@/components/landing/LaunchesPreview";
import { RevealObserver } from "@/components/landing/Reveal";

const d = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;

const STEPS = [
  {
    title: "Connect",
    body: "Open the launch and connect a wallet. No sign-up, no allowlist to join, nothing to sign.",
    icon: "M5 12.5 9.5 17 19 7.5",
  },
  {
    title: "Get your limit",
    body: "When you buy, Kin traces where the wallet got its funds. Wallets paid by the same source share one limit, and every limit handed out is public.",
    icon: "M8 8a3 3 0 1 1 0 .01M16 16a3 3 0 1 1 0 .01M10.4 10.4l3.2 3.2",
  },
  {
    title: "Buy in the window",
    body: "During the launch window you can buy up to your limit. The pool itself refuses anything above it.",
    icon: "M4 17 9.5 11.5l3.5 3.5L20 8M15 8h5v5",
  },
  {
    title: "Claim",
    body: "Window buys stay locked for a set time, then you claim them. Open trading follows the window.",
    icon: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  },
];

const CREATOR_SETTINGS = [
  { k: "Limit per entity", v: "0.01 ETH" },
  { k: "Fresh-wallet pool", v: "0.01 ETH" },
  { k: "Registration", v: "None" },
  { k: "Window opens", v: "30 min after deploy" },
  { k: "Launch window", v: "30 minutes" },
  { k: "Lock after window", v: "60 minutes" },
];

const TOOLS = [
  {
    href: "/try",
    name: "Try it",
    body: "Play the bundler: split test ETH across three wallets and watch Kin give them one limit. No wallet extension needed.",
    tag: "Base Sepolia, about 2 minutes",
    icon: "M5 12.5 9.5 17 19 7.5",
  },
  {
    href: "/sandbox",
    name: "Sandbox",
    body: "Watch one funder send twenty wallets at a Kin pool and a plain pool at once, and compare what lands.",
    tag: "Base Sepolia, automated",
    icon: "M9.5 3.5h5M10.5 3.5v5.5L5.6 17.7A2 2 0 0 0 7.3 20.5h9.4a2 2 0 0 0 1.7-2.8L13.5 9V3.5M8 14.5h8",
  },
  {
    href: "/scan",
    name: "Kin Scan",
    body: "Paste any token on Base and see which of its early buyers were funded by the same source.",
    tag: "Reads Base mainnet",
    icon: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16.2 16.2 20.5 20.5",
  },
];

export default function Home() {
  return (
    <>
      <RevealObserver />

      {/* hero */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="s-dark hero-panel">
          <div className="hero-copy">
            <p className="eyebrow hero-in" style={d(0.05)}>
              <span className="dot" /> Fair token launches on Base
            </p>
            <h1 id="hero-title" className="display">
              <span className="hero-line" style={d(0.12)}>
                Ten wallets.
              </span>{" "}
              <span className="hero-line" style={d(0.22)}>
                One funder.
              </span>{" "}
              <span className="hero-line hero-line-accent" style={d(0.32)}>
                One limit.
              </span>
            </h1>
            <p className="hero-sub hero-in" style={d(0.45)}>
              Kin is a launchpad for fair token launches. Wallets funded by the same source share one purchase limit,
              enforced in the pool by a Uniswap v4 hook. Splitting money across ten wallets no longer buys ten times
              more.
            </p>
            <div className="ctas hero-in" style={d(0.55)}>
              <Link className="btn btn-primary btn-lg" href="/launch/new">
                Launch with Kin
                <Arrow />
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/try">
                Try it: no wallet needed
              </Link>
            </div>
          </div>

          <div className="s-light hero-canvas">
            <div className="hero-scene-wrap">
              <HeroScene />
              <div className="hero-cards">
                <div className="float-card fc-1">
                  <p className="eyebrow">Linked by funding</p>
                  <p className="fc-value">6 wallets, 1 funder</p>
                </div>
                <div className="float-card fc-2">
                  <p className="eyebrow">One limit</p>
                  <p className="fc-value">0.01 ETH in total</p>
                  <div className="fc-bar" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, i) => (
                      <span key={i} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <span className="canvas-tag">Illustration</span>
          </div>
        </div>

        <ul className="hero-strip" aria-label="Kin at a glance">
          <li>
            <strong>Entity limits</strong>
            <span>Linked wallets share one cap</span>
          </li>
          <li>
            <strong>Enforced onchain</strong>
            <span>By a Uniswap v4 hook</span>
          </li>
          <li>
            <strong>Public evidence</strong>
            <span>Every link can be checked</span>
          </li>
          <li>
            <strong>Testnet today</strong>
            <span>Launches run on Base Sepolia</span>
          </li>
        </ul>
      </section>

      {/* how a launch works */}
      <section id="how" className="s-light sec sec-flat" aria-labelledby="how-title">
        <div className="wrap">
          <header className="sec-head sec-head-row reveal">
            <div>
              <p className="eyebrow">How a launch works</p>
              <h2 id="how-title" className="display-2">
                Four steps, no sign-up.
              </h2>
            </div>
            <Link className="text-link" href="/how-it-works">
              The full mechanism
              <Arrow />
            </Link>
          </header>
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

      {/* live launches */}
      <section id="launches" className="s-light sec sec-flat sec-alt" aria-labelledby="launches-title">
        <div className="wrap">
          <header className="sec-head sec-head-row reveal">
            <div>
              <p className="eyebrow">Launches</p>
              <h2 id="launches-title" className="display-2">
                On Kin right now.
              </h2>
            </div>
            <Link className="text-link" href="/launch">
              All launches
              <Arrow />
            </Link>
          </header>
          <LaunchesPreview />
        </div>
      </section>

      {/* for creators */}
      <section id="creators" className="s-dark sec" aria-labelledby="creators-title">
        <div className="wrap creators">
          <div className="reveal">
            <p className="eyebrow">
              <span className="dot" /> For token creators
            </p>
            <h2 id="creators-title" className="display-2">
              Launch to people, not wallet farms.
            </h2>
            <p className="sec-lede">
              You choose the limit, the timing and the lock. Buyers just connect: Kin sets each wallet&apos;s limit when it buys and
              publishes every decision, and the window runs through a hook that refuses settings outside its limits. Any creator share is capped by the hook and
              shown on the launch receipt.
            </p>
            <div className="ctas">
              <Link className="btn btn-primary btn-lg" href="/launch/new">
                Launch with Kin
                <Arrow />
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/how-it-works">
                How it works
              </Link>
            </div>
          </div>
          <figure className="config-card reveal">
            <div className="config-card-head">
              <span className="token-badge" aria-hidden="true">
                YT
              </span>
              <div>
                <p className="config-card-name">Your token</p>
                <p className="mono faint small">$YOURS</p>
              </div>
            </div>
            <dl className="config-list">
              {CREATOR_SETTINGS.map((s) => (
                <div key={s.k}>
                  <dt>{s.k}</dt>
                  <dd>{s.v}</dd>
                </div>
              ))}
            </dl>
            <figcaption>Default settings in the launch configurator. Change any of them.</figcaption>
          </figure>
        </div>
      </section>

      {/* tools */}
      <section id="tools" className="s-light sec" aria-labelledby="tools-title">
        <div className="wrap">
          <header className="sec-head reveal">
            <p className="eyebrow">Tools</p>
            <h2 id="tools-title" className="display-2">
              Try it, watch it, check it.
            </h2>
          </header>
          <div className="tools reveal">
            {TOOLS.map((t) => (
              <Link key={t.href} href={t.href} className="tool">
                <span className="tool-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24">
                    <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <h3>{t.name}</h3>
                <p>{t.body}</p>
                <span className="tool-foot">
                  <span className="faint small">{t.tag}</span>
                  <span className="tool-go">
                    Open
                    <Arrow />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* what Kin does and doesn't */}
      <section id="facts" className="s-light sec sec-flat sec-alt" aria-labelledby="facts-title">
        <div className="wrap">
          <header className="sec-head reveal">
            <p className="eyebrow">The honest version</p>
            <h2 id="facts-title" className="display-2">
              What Kin does, and what it doesn&apos;t.
            </h2>
          </header>
          <div className="reveal">
            <KinFacts title="In short" />
          </div>
        </div>
      </section>

      {/* final CTA */}
      <section className="s-dark sec sec-tight cta" aria-labelledby="cta-title">
        <div className="wrap cta-center reveal">
          <h2 id="cta-title" className="display-2">
            Give every buyer the same starting line.
          </h2>
          <div className="ctas">
            <Link className="btn btn-primary btn-lg" href="/launch/new">
              Launch with Kin
              <Arrow />
            </Link>
            <Link className="btn btn-ghost btn-lg" href="/try">
              Try it first
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
