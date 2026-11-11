import { useCurrentFrame } from "remotion";
import { clamp } from "../lib/anim";
import { at, BARS, barOf, beatOf, BPM, fieldAt, INK, sceneOfBar } from "../timing";
import { DURATION, FONT, H, W } from "../tokens";

/**
 * The frame's instrument panel: crop marks, title, bar and beat counter, scene, frame and timecode. It ties every
 * scene to one grid. In the closing bars it strips back to the crop marks and the timecode.
 */
export const Hud = () => {
  const f = useCurrentFrame();
  const field = fieldAt(f);
  const ink = INK[field];
  const inP = clamp(f / 14);
  const closing = f >= at(14);
  const bar = barOf(f);
  const beat = beatOf(f);
  const scene = sceneOfBar(bar);
  const sec = Math.floor(f / 60);
  const tc = `00:00:${String(sec).padStart(2, "0")}:${String(f % 60).padStart(2, "0")}`;
  const mono = { fontFamily: FONT.mono, fontSize: 17, letterSpacing: "0.2em", whiteSpace: "pre" as const };
  const m = 56;
  const L = 30 * inP;
  const corner = (x: number, y: number, sx: number, sy: number) => (
    <path d={`M${x} ${y + sy * L} V${y} H${x + sx * L}`} fill="none" stroke={ink.fg} strokeWidth={2} />
  );
  const fade = closing ? 1 - clamp((f - at(14)) / 16) : 1;
  return (
    <div style={{ position: "absolute", inset: 0, color: ink.fg, pointerEvents: "none" }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {corner(m, m, 1, 1)}
        {corner(W - m, m, -1, 1)}
        {corner(m, H - m, 1, -1)}
        {corner(W - m, H - m, -1, -1)}
      </svg>
      <div style={{ position: "absolute", left: 86, top: 72, ...mono, opacity: fade * clamp((f - 4) / 10) }}>
        <span style={{ fontWeight: 600 }}>KIN</span>
        <span style={{ color: ink.faint }}>{"  THE FAIR STARTING LINE"}</span>
      </div>
      <div
        style={{
          position: "absolute",
          right: 86,
          top: 72,
          ...mono,
          display: "flex",
          alignItems: "center",
          gap: 14,
          opacity: fade * clamp((f - 8) / 10),
        }}
      >
        <span style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{ width: 9, height: 9, border: `1.5px solid ${ink.faint}`, background: i === beat ? ink.fg : "transparent" }}
            />
          ))}
        </span>
        <span style={{ color: ink.faint }}>BAR {String(bar + 1).padStart(2, "0")}/{BARS}</span>
        <span style={{ fontWeight: 600 }}>{BPM} BPM</span>
      </div>
      <div style={{ position: "absolute", left: 86, bottom: 70, ...mono, opacity: fade * clamp((f - 10) / 10) }}>
        <span style={{ color: ink.faint }}>[ {scene.index} ]</span>
        <span style={{ fontWeight: 600 }}>{"  " + scene.title}</span>
      </div>
      <div style={{ position: "absolute", right: 86, bottom: 70, ...mono, opacity: clamp((f - 10) / 10) }}>
        {!closing && <span style={{ color: ink.faint }}>F{String(Math.min(f, DURATION - 1)).padStart(4, "0")}{"   "}</span>}
        <span style={{ fontWeight: 600 }}>{tc}</span>
      </div>
    </div>
  );
};
