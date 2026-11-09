import Link from "next/link";
import { SandboxClient } from "./SandboxClient";
import { TestDrive } from "./TestDrive";

export const metadata = {
  title: "The flow",
  description: "Kin end to end, live on Base Sepolia: game a launch with three wallets yourself, then watch one funder send twenty at a Kin pool and a normal pool.",
  alternates: { canonical: "/flow" },
};

/** Try it and the sandbox as one story: the same mechanism by hand with 3 wallets, then automated at 20. */
export default function FlowPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Live on Base Sepolia · nothing to install</p>
          <h1>The flow</h1>
          <p className="lede">
            One person funds several wallets and buys with all of them. Kin traces the funding, treats them as one buyer, and the
            pool refuses what goes over their shared limit. Do it yourself, then watch it at scale.
          </p>
          <nav className="flow-toc" aria-label="On this page">
            <a href="#yourself">
              <span className="mono">01</span> Do it yourself · 3 wallets
            </a>
            <a href="#scale">
              <span className="mono">02</span> At scale · 20 wallets
            </a>
            <Link href="/launch/new">
              <span className="mono">03</span> Launch your own token
            </Link>
          </nav>
        </div>
      </header>

      <section id="yourself" className="flow-part" aria-labelledby="yourself-title">
        <p className="eyebrow">
          <span className="mono">01</span> Do it yourself
        </p>
        <h2 id="yourself-title">Try to game a live launch</h2>
        <TestDrive />
      </section>

      <section id="scale" className="flow-part" aria-labelledby="scale-title">
        <p className="eyebrow">
          <span className="mono">02</span> At scale
        </p>
        <h2 id="scale-title">Watch one funder send 20 wallets</h2>
        <p className="muted flow-lede">All 20 buy the moment the window opens, on a Kin pool and on a normal pool with the same settings.</p>
        <SandboxClient />
      </section>
    </>
  );
}
