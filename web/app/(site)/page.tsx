import Link from "next/link";
import { LatestSandbox } from "@/components/LatestSandbox";

export default function Home() {
  return (
    <>
      <section className="hero">
        <span className="pill pill-accent">Built for Base · Uniswap v4 hook</span>
        <h1 style={{ marginTop: 14 }}>Token launches that cap entities, not wallets.</h1>
        <p className="lede">
          Clanker taxes everyone who&apos;s early. Kin only limits the ones who are secretly the same person.
        </p>
        <div className="ctas">
          <Link className="btn btn-lg" href="/scan">
            Scan a token
          </Link>
          <Link className="btn btn-lg btn-ghost" href="/sandbox">
            Run the attack
          </Link>
          <Link className="btn btn-lg btn-ghost" href="/launch">
            See a fair launch
          </Link>
        </div>
      </section>

      <LatestSandbox />

      <h2>How it works</h2>
      <div className="steps">
        <div className="card step">
          <h3>Register</h3>
          <p className="muted small">Wallets sign up for a launch before it opens. Signing is free; a launch can require a small balance.</p>
        </div>
        <div className="card step">
          <h3>Group by funding</h3>
          <p className="muted small">
            Wallets funded by the same source become one entity with one cap. New wallets split one fresh pool evenly.
            Every link is backed by transaction hashes.
          </p>
        </div>
        <div className="card step">
          <h3>Publish, then dispute</h3>
          <p className="muted small">
            The allowlist root and a hash of the evidence file go onchain before the window. Any wallet can dispute
            until it opens.
          </p>
        </div>
        <div className="card step">
          <h3>Capped window, then open</h3>
          <p className="muted small">
            A Uniswap v4 hook enforces each entity&apos;s cap. Window buys sit in a vault until the lock ends. Then
            anyone trades.
          </p>
        </div>
      </div>

      <h2>Why entities</h2>
      <p className="muted">
        The usual anti-sniper tools on Base work on time or price, so genuine early buyers face the same limits as bots.
      </p>
      <div className="table-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th>Approach</th>
              <th>Mechanism</th>
              <th>Who pays</th>
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
            <tr>
              <td>
                <strong>Kin</strong>
              </td>
              <td>One cap per funding-linked entity, published evidence, vault lock</td>
              <td>Wallets that are secretly the same person</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="faint small" style={{ marginTop: 12 }}>
        Kin makes bundling expensive and visible; it does not stop it. Pre-aged or exchange-funded wallets can still get
        through, which is why new wallets split one fixed fresh pool and window buys are locked.
      </p>
    </>
  );
}
