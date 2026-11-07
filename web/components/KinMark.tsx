/** The Kin mark: one ring (an entity) around three linked wallets. Uses the current accent colour. */
export function KinMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--accent)" strokeWidth="5" />
      <g stroke="var(--accent)" strokeWidth="3" strokeLinecap="round">
        <line x1="32" y1="20" x2="21.6" y2="38" />
        <line x1="21.6" y1="38" x2="42.4" y2="38" />
        <line x1="42.4" y1="38" x2="32" y2="20" />
      </g>
      <g fill="var(--accent)">
        <circle cx="32" cy="20" r="6" />
        <circle cx="21.6" cy="38" r="6" />
        <circle cx="42.4" cy="38" r="6" />
      </g>
    </svg>
  );
}
