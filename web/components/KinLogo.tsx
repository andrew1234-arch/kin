/**
 * The Kin logo exactly as in brand/kin-logo-on-*.svg: the mark (one ring around three linked wallets) and the
 * wordmark drawn as strokes, not set in a font. The mark uses the accent token (#2f55e4 on light, #7d97ff on dark)
 * and the wordmark uses currentColor (ink on light, #ececf1 on dark), so one component serves both surfaces.
 */
export function KinLogo({ height = 26, className }: { height?: number; className?: string }) {
  return (
    <svg
      className={className}
      height={height}
      width={(height * 208) / 72}
      viewBox="0 0 208 72"
      role="img"
      aria-label="Kin"
      style={{ display: "block" }}
    >
      <g transform="translate(-2.254 2.746) scale(1.10169)">
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
      </g>
      <g transform="translate(80 6)">
        <g fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 4 V60" />
          <path d="M37 22 L13 43" />
          <path d="M21 36 L39 60" />
          <path d="M58 24 V60" />
          <path d="M78 60 V24 M78 40 a16 16 0 0 1 32 0 V60" />
        </g>
        <circle cx="58" cy="7" r="5.5" fill="currentColor" />
      </g>
    </svg>
  );
}
