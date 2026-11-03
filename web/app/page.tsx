export default function Home() {
  return (
    <section className="hero">
      <h1>Token launches on Base that cap entities, not wallets.</h1>
      <p className="lede">
        Clanker taxes everyone who&apos;s early. Kin only limits the ones who are secretly the same person.
      </p>
      <p>
        Wallets register before a launch. Wallets linked by shared funding are grouped into one entity with one
        cap, and the evidence is published before the window opens. A Uniswap v4 hook enforces the caps onchain,
        and window buys sit in a vault until the lock ends. This makes bundling expensive and visible.
      </p>
      <div className="ctas">
        <a className="cta" href="/scan">Scan a token</a>
        <a className="cta" href="/sandbox">Run the attack</a>
        <a className="cta" href="/launch">See a fair launch</a>
      </div>
    </section>
  );
}
