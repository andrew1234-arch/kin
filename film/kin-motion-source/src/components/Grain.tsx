import { useCurrentFrame } from "remotion";
import { H, W } from "../tokens";

/**
 * Film grain and a soft vignette, regenerated every frame (deterministic: the noise seed is the frame number), so
 * flat vector colour reads as printed matter rather than a screen.
 */
export const Grain = ({ amount = 1 }: { amount?: number }) => {
  const f = useCurrentFrame();
  const seed = (f * 7) % 97;
  return (
    <>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, mixBlendMode: "multiply", opacity: 0.11 * amount }}>
        <filter id={`g${seed}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.6" intercept="-0.1" />
            <feFuncG type="linear" slope="1.6" intercept="-0.1" />
            <feFuncB type="linear" slope="1.6" intercept="-0.1" />
          </feComponentTransfer>
        </filter>
        <rect width={W} height={H} filter={`url(#g${seed})`} />
      </svg>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, mixBlendMode: "screen", opacity: 0.06 * amount }}>
        <filter id={`s${seed}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={1} seed={seed + 50} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={W} height={H} filter={`url(#s${seed})`} />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(8,20,40,0.10) 100%)",
          mixBlendMode: "multiply",
        }}
      />
    </>
  );
};
