import { useCurrentFrame } from "remotion";
import { clamp, track } from "../lib/anim";
import { C, E, FONT } from "../tokens";

/**
 * A headline line revealed through a mask: it rises into its slot (expo out) while its tracking tightens, and
 * leaves upward (expo in). The mask keeps edges hard, as in printed Swiss layouts.
 */
export const MaskLine = ({
  text,
  x,
  y,
  size,
  inAt,
  outAt = 1e9,
  color = C.navy,
  weight = 500,
  dur = 46,
  align = "left",
  width,
}: {
  text: React.ReactNode;
  x: number;
  y: number;
  size: number;
  inAt: number;
  outAt?: number;
  color?: string;
  weight?: number;
  dur?: number;
  align?: "left" | "center";
  width?: number;
}) => {
  const f = useCurrentFrame();
  if (f < inAt - 1 || f > outAt + 40) return null;
  const rise = track(f, [
    [inAt, 1.12],
    [inAt + dur, 0, E.expoOut],
    [outAt, 0],
    [outAt + 30, -1.12, E.expoIn],
  ]);
  const tracking = track(f, [
    [inAt, -0.015],
    [inAt + dur * 1.6, -0.048, E.expoOut],
  ]);
  const lineH = size * 1.18;
  return (
    <div
      style={{
        position: "absolute",
        left: align === "center" ? x - (width ?? 1600) / 2 : x,
        top: y,
        width: width ?? (align === "center" ? 1600 : undefined),
        height: lineH,
        overflow: "hidden",
        textAlign: align,
      }}
    >
      <div
        style={{
          transform: `translateY(${rise * lineH}px)`,
          fontFamily: FONT.sans,
          fontWeight: weight,
          fontSize: size,
          lineHeight: `${lineH}px`,
          letterSpacing: `${tracking}em`,
          color,
          whiteSpace: "nowrap",
          fontKerning: "normal",
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** Mono uppercase label, typed on character by character, with the site's blue dot. */
export const MonoLabel = ({
  text,
  x,
  y,
  inAt,
  outAt = 1e9,
  size = 20,
  color = C.navy,
  dot = false,
  align = "left",
  speed = 1.4,
}: {
  text: string;
  x: number;
  y: number;
  inAt: number;
  outAt?: number;
  size?: number;
  color?: string;
  dot?: boolean;
  align?: "left" | "center" | "right";
  speed?: number;
}) => {
  const f = useCurrentFrame();
  if (f < inAt || f > outAt + 20) return null;
  const n = Math.floor(clamp((f - inAt) * speed, 0, text.length));
  const out = clamp((f - outAt) / 16);
  const shown = text.slice(0, n);
  const translate = align === "center" ? "translateX(-50%)" : align === "right" ? "translateX(-100%)" : "none";
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: translate,
        fontFamily: FONT.mono,
        fontSize: size,
        letterSpacing: "0.18em",
        color,
        opacity: 1 - out,
        whiteSpace: "pre",
        display: "flex",
        alignItems: "center",
        gap: size * 0.7,
      }}
    >
      {dot && (
        <span
          style={{
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: 99,
            background: C.blue,
            transform: `scale(${clamp((f - inAt) / 10)})`,
          }}
        />
      )}
      <span>
        {shown}
        <span style={{ opacity: 0 }}>{text.slice(n)}</span>
      </span>
    </div>
  );
};

/** The running header used on the site: "[ 01 ] THE PROBLEM". */
export const SceneLabel = ({ index, title, inAt, outAt }: { index: string; title: string; inAt: number; outAt: number }) => (
  <MonoLabel text={`[ ${index} ]  ${title}`} x={120} y={84} inAt={inAt} outAt={outAt} size={19} speed={2} />
);
