/** Static explanatory diagrams for the landing page. Illustrations of the mechanism, not live data. */

const WALLETS = Array.from({ length: 10 }, (_, i) => {
  const t = (i - 4.5) / 4.5;
  return { x: 232 + 46 * t * t, y: 22 + i * 28.4 };
});

/** One person fans out into ten wallets, and all ten land in the launch window. */
export function FanOut() {
  return (
    <svg className="fanout" viewBox="0 0 560 300" role="img" aria-label="One person funds ten wallets; all ten buy in the launch window">
      <g className="fanout-edges">
        {WALLETS.map((w, i) => (
          <path key={`a${i}`} d={`M84 150 C 150 150, ${w.x - 70} ${w.y}, ${w.x - 11} ${w.y}`} />
        ))}
        {WALLETS.map((w, i) => (
          <path key={`b${i}`} className="fanout-buy" d={`M${w.x + 11} ${w.y} C ${w.x + 90} ${w.y}, 360 ${118 + i * 7}, 410 ${118 + i * 7}`} />
        ))}
      </g>
      <g className="fanout-person">
        <circle cx="56" cy="150" r="28" />
        <circle cx="56" cy="141" r="7" className="fanout-glyph" />
        <path d="M42 166 C 42 154, 70 154, 70 166" className="fanout-glyph" />
      </g>
      {WALLETS.map((w, i) => (
        <circle key={i} className="fanout-wallet" cx={w.x} cy={w.y} r="10" />
      ))}
      <g className="fanout-pool">
        <rect x="410" y="96" width="142" height="108" rx="10" />
        <text x="428" y="128">LAUNCH</text>
        <text x="428" y="145">WINDOW</text>
        <text x="428" y="186" className="fanout-big">10 buys</text>
      </g>
      <text x="56" y="204" textAnchor="middle" className="fanout-cap">1 PERSON</text>
      <text x="232" y="298" textAnchor="middle" className="fanout-cap">10 WALLETS</text>
    </svg>
  );
}

/** Twenty buys in a window: ten from one person's wallets, ten from ten different people. */
export function AllocationStrip() {
  return (
    <figure className="alloc">
      <div className="alloc-cells" aria-hidden="true">
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className={i < 10 ? "alloc-one" : "alloc-many"} />
        ))}
      </div>
      <figcaption className="alloc-legend">
        <span>
          <i className="alloc-one" /> One person, ten wallets: <strong>50%</strong> of the window
        </span>
        <span>
          <i className="alloc-many" /> Ten different people: 50%
        </span>
      </figcaption>
    </figure>
  );
}

function Bar({ parts }: { parts: { w: number; label: string }[] }) {
  return (
    <div className="dbar">
      <div className="dbar-track">
        {parts.map((p, i) => (
          <span key={i} className={`dbar-seg dbar-seg-${i}`} style={{ width: `${p.w}%` }}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Per-wallet limits versus Kin's per-entity limit, for the same three wallets. */
export function LimitComparison() {
  return (
    <div className="diff">
      <figure className="diff-panel">
        <p className="eyebrow">Wallet-based limit</p>
        <h3>Every wallet is checked alone.</h3>
        <div className="diff-rows">
          {["A", "B", "C"].map((w) => (
            <div key={w} className="diff-row">
              <span className="diff-chip">Wallet {w}</span>
              <Bar parts={[{ w: 100, label: "1 × limit" }]} />
            </div>
          ))}
        </div>
        <div className="diff-total diff-total-bad">
          <span>Reaches the pool</span>
          <strong>3 × limit</strong>
        </div>
        <figcaption>Three addresses, three full allowances. Nothing says they are the same buyer.</figcaption>
      </figure>

      <figure className="diff-panel diff-panel-kin">
        <p className="eyebrow">Kin entity limit</p>
        <h3>Linked wallets draw from one limit.</h3>
        <div className="diff-group">
          <div className="diff-group-label">
            <span className="diff-dot" /> Shared funder found: A, B and C are one entity
          </div>
          <div className="diff-chips">
            <span className="diff-chip">Wallet A</span>
            <span className="diff-chip">Wallet B</span>
            <span className="diff-chip">Wallet C</span>
          </div>
          <Bar
            parts={[
              { w: 45, label: "A" },
              { w: 35, label: "B" },
              { w: 20, label: "C" },
            ]}
          />
          <div className="diff-reject">
            <span className="mono">C</span> tries 0.8 × limit more:{" "}
            <span className="mono diff-err">EntityCapExceeded</span>, the swap reverts
          </div>
        </div>
        <div className="diff-total diff-total-good">
          <span>Reaches the pool</span>
          <strong>1 × limit</strong>
        </div>
        <figcaption>
          The hook keeps one running total per entity. A Merkle proof binds each wallet to its entity and cap.
        </figcaption>
      </figure>
    </div>
  );
}
