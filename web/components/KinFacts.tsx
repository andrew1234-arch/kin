/**
 * What Kin does and doesn't do, in one place. Every page that demonstrates Kin (home, how it works, try it,
 * sandbox) shows this same box, so the claims never drift apart. Keep each line true to the code.
 */
const DOES = [
  {
    t: "Links wallets by funding",
    d: "A wallet funded by the same wallet as an earlier buyer, up to two transfers back, joins that buyer's entity.",
  },
  {
    t: "Enforces one limit per entity, onchain",
    d: "A Uniswap v4 hook checks a signed permit in every buy during the window and reverts anything over the entity's limit.",
  },
  {
    t: "Shows its work",
    d: "Every limit Kin hands out is public with the transfers behind it, and every window buy records its entity onchain.",
  },
  {
    t: "Locks window buys",
    d: "Tokens bought in the window sit in a vault until the lock ends, so nobody can buy at the capped price and dump a block later.",
  },
];

const DOESNT = [
  {
    t: "Catch every bundler",
    d: "Exchanges are left out of the trace on purpose, so wallets funded from different exchanges or bridges look unrelated. Kin makes bundling cost more and easier to see.",
  },
  {
    t: "Know who is a person",
    d: "A funding link is evidence, not identity. Two friends paid by the same wallet share one limit.",
  },
  {
    t: "Work without trusting Kin's engine",
    d: "The hook accepts the limits Kin's engine signs. Each one is public and can be audited, but a wrong one isn't blocked in advance.",
  },
  {
    t: "Order buys or limit trading after the window",
    d: "Earlier buys in the window get a better price, and once the window closes anyone can trade.",
  },
  {
    t: "Run on mainnet yet",
    d: "Launches run on Base Sepolia with test ETH. Kin Scan reads Base mainnet.",
  },
];

export function KinFacts({ title = "What Kin does, and what it doesn't" }: { title?: string }) {
  return (
    <section className="facts" aria-label={title}>
      <h2 className="facts-title">{title}</h2>
      <div className="facts-cols">
        <div>
          <p className="eyebrow facts-yes">Does</p>
          <ul>
            {DOES.map((x) => (
              <li key={x.t}>
                <strong>{x.t}.</strong> {x.d}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow facts-no">Doesn&apos;t, today</p>
          <ul>
            {DOESNT.map((x) => (
              <li key={x.t}>
                <strong>{x.t}.</strong> {x.d}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
