import { ImageResponse } from "next/og";

export const alt = "Kin: token launches on Base that cap entities, not wallets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BLUE = "#7d97ff";
const INK = "#ececf1";
const BG = "#0f1013";
const MUTED = "#a3a4ae";

/** Social card: the Kin logo, the one-line pitch, and the three facts that make it different. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BG, padding: "72px 80px" }}>
        <svg width="436" height="151" viewBox="0 0 208 72">
          <g transform="translate(0 4)">
            <circle cx="32" cy="32" r="27" fill="none" stroke={BLUE} strokeWidth="5" />
            <g stroke={BLUE} strokeWidth="3" strokeLinecap="round">
              <line x1="32" y1="20" x2="21.6" y2="38" />
              <line x1="21.6" y1="38" x2="42.4" y2="38" />
              <line x1="42.4" y1="38" x2="32" y2="20" />
            </g>
            <g fill={BLUE}>
              <circle cx="32" cy="20" r="6" />
              <circle cx="21.6" cy="38" r="6" />
              <circle cx="42.4" cy="38" r="6" />
            </g>
          </g>
          <g transform="translate(80 6)">
            <g fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4 V60" />
              <path d="M37 22 L13 43" />
              <path d="M21 36 L39 60" />
              <path d="M58 24 V60" />
              <path d="M78 60 V24 M78 40 a16 16 0 0 1 32 0 V60" />
            </g>
            <circle cx="58" cy="7" r="5.5" fill={INK} />
          </g>
        </svg>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, fontWeight: 700, color: INK, lineHeight: 1.08, letterSpacing: -1.5 }}>
            Token launches that cap entities, not wallets.
          </div>
          <div style={{ marginTop: 28, fontSize: 30, color: MUTED, lineHeight: 1.35 }}>
            Linked wallets share one cap · evidence committed onchain · enforced by a Uniswap v4 hook on Base
          </div>
        </div>
      </div>
    ),
    size,
  );
}
