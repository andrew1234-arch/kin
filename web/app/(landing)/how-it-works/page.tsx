import type { Metadata } from "next";
import Link from "next/link";
import { AllocationStrip, FanOut, LimitComparison } from "@/components/landing/Diagrams";
import { EvidenceFigure } from "@/components/landing/EvidenceFigure";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LiveEngine, ReplayStrip } from "@/components/landing/LiveEngine";
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

const WEIGHTS = [
  { label: "Wallet funds wallet", w: 1 },
  { label: "Same direct funder within 24 h", w: 1 },
  { label: "Shared funding ancestor within 2 hops", w: 0.8 },
  { label: "Same-block early buy (Kin Scan)", w: 0.5 },
];

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Kin groups wallets by funding source, enforces one purchase limit per entity with a Uniswap v4 hook, locks window buys and publishes the evidence.",
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
        <h1 className="display-2">One person, one limit. Here is how Kin enforces it.</h1>
        <p className="sec-lede">
          The problem, the mechanism, the live engine and the evidence, in that order. Every number in the live section
          comes from the engine this site is connected to.
        </p>
        <nav className="hiw-toc" aria-label="On this page">
          <a href="#problem">Problem</a>
          <a href="#difference">Entity limits</a>
          <a href="#how">Five steps</a>
          <a href="#live">Live engine</a>
          <a href="#evidence">Evidence</a>
          <a href="#technology">Technology</a>
          <a href="#limits">Limitations</a>
        </nav>
      </header>

      {/* ------------------------------------------------------------ problem */}
      <section id="problem" className="s-light sec" aria-labelledby="problem-title">
        <div className="wrap split-5-7">
          <div>
            <SectionHead
              idx="01"
              eyebrow="The problem"
              title={
                <span id="problem-title">
                  One person. Ten wallets. <span className="muted-ink">Ten chances to dominate.</span>
                </span>
              }
              lede="A per-wallet limit caps addresses, not buyers. Split one balance across ten fresh wallets and the allowance is ten times larger. To the pool it looks like ten strangers."
            />
            <ReplayStrip />
          </div>
          <figure className="problem-fig reveal">
            <FanOut />
            <AllocationStrip />
            <figcaption className="fig-note">Illustration. Twenty buys at the same per-wallet limit.</figcaption>
          </figure>
        </div>
      </section>

      {/* ------------------------------------------------------------ difference */}
      <section id="difference" className="s-dark sec" aria-labelledby="diff-title">
        <div className="wrap">
          <SectionHead
            idx="02"
            eyebrow="The Kin difference"
            title={
              <span id="diff-title">
                Enforce limits by entity, <span className="muted-ink">not by wallet.</span>
              </span>
            }
            lede="Kin does not slow down or tax every early buyer. It finds wallets that share a funding source and makes them share one limit. Everyone else buys as normal."
          />
          <div className="reveal">
            <LimitComparison />
          </div>
          <div className="others reveal">
            <p className="eyebrow">Other launch protections on Base work on time or price</p>
            <div className="table-wrap">
              <table className="compare">
                <thead>
                  <tr>
                    <th>Approach</th>
                    <th>Mechanism</th>
                    <th>Who it limits</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Clanker v4</td>
                    <td>2-block delay, auction of first swaps, fee from up to 80% decaying over at most 2 minutes</td>
                    <td>Every early buyer</td>
                  </tr>
                  <tr>
                    <td>Flaunch</td>
                    <td>Fixed-price fair-launch window</td>
                    <td>Every early buyer</td>
                  </tr>
                  <tr>
                    <td>Uniswap CCA</td>
                    <td>Continuous clearing auction, one uniform price</td>
                    <td>Every early buyer</td>
                  </tr>
                  <tr className="compare-kin">
                    <td>Kin</td>
                    <td>One cap per funding-linked entity, published evidence, vault lock</td>
                    <td>Wallets that share a funding source</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ how */}
      <section id="how" className="s-light sec" aria-labelledby="how-title">
        <div className="wrap">
          <SectionHead
            idx="03"
            eyebrow="How Kin works"
            title={<span id="how-title">From sign-up to open trading, in five steps.</span>}
            lede="This is an allowlist launch, where wallets register first. Instant launches skip the sign-up: see below."
          />
          <HowItWorks />
          <div className="hiw-instant reveal">
            <h3>Instant launches: the same limits, no registration</h3>
            <p>
              A creator can launch without an allowlist. Buyers just connect. Any time after the launch is deployed, a wallet that
              asks for its limit gets traced on the spot (the same two-hop funding trace) and assigned an entity: it joins an earlier
              buyer&apos;s entity if they share a funder, the fresh pool if it is new, or gets its own limit. The engine signs a
              permit for that entity and limit, valid until the window closes, and the KinHook checks the signature in the swap, then charges the
              buy to the entity&apos;s running total exactly as above.
            </p>
            <p>
              What changes: no dispute period, so every assignment is public instead, with the funding link behind it, and
              the rules&apos; hash is committed onchain at deploy. New wallets need the engine to be online to get a limit (a wallet
              that already has its permit can buy without it), and the hook trusts its permit signer.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ live */}
      <section id="live" className="s-dark sec" aria-labelledby="live-title">
        <div className="wrap">
          <SectionHead
            idx="04"
            eyebrow="Live product"
            title={
              <span id="live-title">
                Not a mockup. <span className="muted-ink">The engine, running.</span>
              </span>
            }
            lede="Everything in this section is fetched from the Kin engine this site is connected to. Each block is tagged with where its data comes from: mainnet, testnet, a local chain or a sandbox simulation."
          />
          <LiveEngine />
        </div>
      </section>

      {/* ------------------------------------------------------------ evidence */}
      <section id="evidence" className="s-light sec" aria-labelledby="evidence-title">
        <div className="wrap split-5-7">
          <div>
            <SectionHead
              idx="05"
              eyebrow="Evidence and transparency"
              title={<span id="evidence-title">Every decision should have evidence.</span>}
              lede="A limit you can't check is just a rule someone made up. Kin publishes why every wallet landed in its entity, before anyone can buy."
            />
            <ul className="ev-list reveal">
              <li>
                <span className="mono">01</span>
                <div>
                  <h3>Wallet relationships</h3>
                  <p>Every entity lists its members and the links between them, each with a reason and a weight.</p>
                </div>
              </li>
              <li>
                <span className="mono">02</span>
                <div>
                  <h3>Funding-source proof</h3>
                  <p>Each funding link carries the transaction hashes on both paths, so anyone can follow the money.</p>
                </div>
              </li>
              <li>
                <span className="mono">03</span>
                <div>
                  <h3>Enforcement decisions</h3>
                  <p>Each wallet&apos;s tier, entity ID and cap sit in a Merkle tree. The root is what the hook enforces.</p>
                </div>
              </li>
              <li>
                <span className="mono">04</span>
                <div>
                  <h3>Verification and disputes</h3>
                  <p>
                    The keccak256 of the evidence file goes onchain. Your browser recomputes it. Wrongly linked
                    wallets can dispute until the window opens.
                  </p>
                </div>
              </li>
            </ul>
            <div className="ctas reveal">
              <Link className="btn" href="/launch">
                Inspect a launch
              </Link>
              <Link className="btn btn-ghost" href="/scan">
                Scan a Base token
              </Link>
            </div>
          </div>
          <div className="reveal">
            <EvidenceFigure />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ technology */}
      <section id="technology" className="s-dark sec" aria-labelledby="tech-title">
        <div className="wrap">
          <SectionHead
            idx="06"
            eyebrow="Technology"
            title={
              <span id="tech-title">
                What runs where. <span className="muted-ink">All of it open source.</span>
              </span>
            }
          />
          <div className="spec reveal">
            <div className="spec-row">
              <div className="spec-key">
                <p className="eyebrow">Clustering engine</p>
                <p className="spec-meta mono">Bun + TypeScript · engine/src/cluster</p>
              </div>
              <div className="spec-val">
                <p>
                  Weighted evidence between wallet pairs, ported from the Nuno cluster engine. A pair merges into one
                  entity when its weight reaches <strong>1.0</strong>. Exchanges are excluded. Hubs funding more than 50
                  wallets are ignored unless they pay out like a farm.
                </p>
                <ul className="weights" aria-label="Evidence weights">
                  {WEIGHTS.map((x) => (
                    <li key={x.label}>
                      <span>{x.label}</span>
                      <span className="weights-bar" aria-hidden="true">
                        <i style={{ width: `${x.w * 100}%` }} />
                      </span>
                      <span className="mono">{x.w.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="spec-row">
              <div className="spec-key">
                <p className="eyebrow">Allowlist</p>
                <p className="spec-meta mono">OpenZeppelin StandardMerkleTree</p>
              </div>
              <div className="spec-val">
                <p>
                  One leaf per wallet: <code className="mono">(wallet, entityId, entityCap)</code>. Every wallet in an
                  entity carries the same entity ID, so its buys land on one counter. The launch admin can replace the
                  root before the window, after a dispute for example. Every replacement pushes the window back so the
                  full review period remains to check the new root. The root freezes when the window opens.
                </p>
              </div>
            </div>
            <div className="spec-row">
              <div className="spec-key">
                <p className="eyebrow">KinHook</p>
                <p className="spec-meta mono">Uniswap v4 hook · contracts/src</p>
              </div>
              <div className="spec-val">
                <p>
                  Before the window, every swap reverts. During it, only the KinRouter may swap: buys only, exact input,
                  with a valid proof. Each entity has one running total, counted in what each swap actually paid, and its
                  cap is pinned by the entity&apos;s first buy. Passing it reverts with{" "}
                  <code className="mono">EntityCapExceeded</code>. After the window, any router, any direction, and the
                  Fairness Receipt is final.
                </p>
              </div>
            </div>
            <div className="spec-row">
              <div className="spec-key">
                <p className="eyebrow">Launch limits</p>
                <p className="spec-meta mono">Fixed when the hook is deployed</p>
              </div>
              <div className="spec-val">
                <p>
                  Every launch on a hook must fit limits set at deploy time: a minimum review period before the window,
                  a minimum and maximum window length, a maximum lock and a maximum creator share of supply. The
                  creator&apos;s share sits outside every cap and is printed on the Fairness Receipt.
                </p>
              </div>
            </div>
            <div className="spec-row">
              <div className="spec-key">
                <p className="eyebrow">KinVault</p>
                <p className="spec-meta mono">Lock after the window</p>
              </div>
              <div className="spec-val">
                <p>
                  Tokens bought in the window go to the vault, not the buyer, and are claimable when the lock ends.
                  Selling during the window reverts. Nobody can buy at the capped price and dump it a block later.
                </p>
              </div>
            </div>
            <div className="spec-row">
              <div className="spec-key">
                <p className="eyebrow">Base Verify</p>
                <p className="spec-meta mono">Optional tier · Base Sepolia</p>
              </div>
              <div className="spec-val">
                <p>
                  A launch can give verified humans a larger cap. One verified account can verify one wallet per launch.
                </p>
              </div>
            </div>
            <div className="spec-row">
              <div className="spec-key">
                <p className="eyebrow">Kin Scan</p>
                <p className="spec-meta mono">Base mainnet · read-only</p>
              </div>
              <div className="spec-val">
                <p>
                  Runs the same clustering over the early buyers of any token already on Base mainnet and shows what
                  Kin&apos;s limits would have blocked. <Link href="/scan">Try it on a token</Link>.
                </p>
              </div>
            </div>
          </div>
          <p className="tech-src reveal">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Read the source on GitHub
              <Arrow />
            </a>
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ limits */}
      <section id="limits" className="s-light sec sec-tight" aria-labelledby="limits-title">
        <div className="wrap split-5-7">
          <SectionHead
            idx="07"
            eyebrow="Limitations"
            title={<span id="limits-title">What Kin does not claim.</span>}
            lede="Kin makes coordinated wallet buying more expensive, less effective and more visible. It does not stop it, and it never claims to know who is behind a wallet."
          />
          <ul className="limits reveal">
            <li>
              <h3>Funding links are evidence, not identity.</h3>
              <p>Two different people can share a funder. One person can hide behind addresses with nothing in common.</p>
            </li>
            <li>
              <h3>Exchange-funded and pre-aged wallets are hard to attribute.</h3>
              <p>
                Exchanges are excluded from linking, so wallets withdrawn from one look independent. A patient bundler
                can age wallets in advance.
              </p>
            </li>
            <li>
              <h3>Fresh wallets split one pooled cap.</h3>
              <p>
                The pool is divided evenly between fresh wallets. That blunts a farm of brand-new wallets, but it also
                gives genuine first-time users a small share.
              </p>
            </li>
            <li>
              <h3>Disputes are resolved by the launch operator.</h3>
              <p>
                In allowlist launches anyone can dispute before the window and every resolution is public, but the decision is a
                trusted role today. Instant launches have no disputes: the engine&apos;s permit signer decides at buy time, and
                every decision is published.
              </p>
            </li>
            <li>
              <h3>Kin is not on Base mainnet.</h3>
              <p>
                Launches and the sandbox target Base Sepolia, and this site tags which chain every number comes from. Kin
                Scan only reads Base mainnet.
              </p>
            </li>
          </ul>
        </div>
      </section>

      <section className="s-dark sec sec-tight hiw-end">
        <div className="wrap cta-grid">
          <h2 className="display-2">Ready to launch with one limit per person?</h2>
          <div className="ctas">
            <Link className="btn btn-primary btn-lg" href="/launch/new">
              Launch with Kin
              <Arrow />
            </Link>
            <Link className="btn btn-ghost btn-lg" href="/launch">
              Explore launches
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
