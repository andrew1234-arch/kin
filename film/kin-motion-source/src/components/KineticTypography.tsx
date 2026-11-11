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

/**
 * A headline that whips in on the beat: it arrives fast from the side, stretched, and snaps into place (camera
 * motion blur smears it on the way in). Parts marked `bracket` get the site's corner-bracket callout, which closes
 * in around the word on `bracketAt`.
 */
export const WhipLine = ({
  parts,
  x,
  y,
  size,
  inAt,
  outAt = 1e9,
  color,
  accent,
  weight = 700,
  dir = 1,
  bracketAt,
  upper = true,
  tracking = -0.035,
}: {
  parts: { t: string; bracket?: boolean; color?: string }[];
  x: number;
  y: number;
  size: number;
  inAt: number;
  outAt?: number;
  color: string;
  accent: string;
  weight?: number;
  dir?: 1 | -1;
  bracketAt?: number;
  upper?: boolean;
  tracking?: number;
}) => {
  const f = useCurrentFrame();
  if (f < inAt - 1 || f > outAt + 16) return null;
  const tx = track(f, [
    [inAt, dir * 560],
    [inAt + 20, 0, E.expoOut],
    [outAt, 0],
    [outAt + 14, -dir * 900, E.expoIn],
  ]);
  const sx = track(f, [
    [inAt, 1.3],
    [inAt + 20, 1, E.expoOut],
    [outAt, 1],
    [outAt + 14, 1.3, E.expoIn],
  ]);
  const op = clamp((f - inAt) / 3) * (1 - clamp((f - outAt - 10) / 4));
  const b = bracketAt === undefined ? 0 : clamp((f - bracketAt) / 16);
  const inset = track(f, [
    [bracketAt ?? 1e9, -0.5],
    [(bracketAt ?? 1e9) + 16, -0.13, E.backOut],
  ]);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translateX(${tx}px) scaleX(${sx})`,
        transformOrigin: dir > 0 ? "left center" : "right center",
        opacity: op,
        fontFamily: FONT.sans,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: `${tracking}em`,
        color,
        whiteSpace: "pre",
        textTransform: upper ? "uppercase" : "none",
      }}
    >
      {parts.map((p, i) => (
        <span key={i} style={{ position: "relative", color: p.color ?? color }}>
          {p.t}
          {p.bracket && b > 0 && <Brackets inset={inset} color={accent} opacity={b} />}
        </span>
      ))}
    </div>
  );
};

const Brackets = ({ inset, color, opacity }: { inset: number; color: string; opacity: number }) => {
  const arm = "0.2em";
  const th = "0.045em";
  const base = { position: "absolute" as const, width: arm, height: arm, borderColor: color, borderStyle: "solid", opacity };
  // The span's box is the font's full line box; Geist caps sit 0.275em below its top and 0.26em above its
  // bottom, so the brackets are offset to frame the capitals themselves.
  const i = `${inset}em`;
  const t = `${0.275 + inset}em`;
  const bt = `${0.26 + inset}em`;
  return (
    <>
      <span style={{ ...base, left: i, top: t, borderWidth: `${th} 0 0 ${th}` }} />
      <span style={{ ...base, right: i, top: t, borderWidth: `${th} ${th} 0 0` }} />
      <span style={{ ...base, left: i, bottom: bt, borderWidth: `0 0 ${th} ${th}` }} />
      <span style={{ ...base, right: i, bottom: bt, borderWidth: `0 ${th} ${th} 0` }} />
    </>
  );
};
