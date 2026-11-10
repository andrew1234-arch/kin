// Renders the silent master: node scripts/render.mjs [out.mp4]
// H.264, yuv420p, 1920×1080, 60 fps, 1800 frames. Audio is added afterwards by scripts/mux.sh.
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";

const browserExecutable =
  process.env.REMOTION_BROWSER ??
  "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const out = process.argv[2] ?? "out/kin-brand-film-30s-silent.mp4";
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "KinBrandFilm", browserExecutable });
const t0 = Date.now();
let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  crf: 14,
  pixelFormat: "yuv420p",
  x264Preset: "slow",
  muted: true,
  imageFormat: "png",
  concurrency: Number(process.env.CONCURRENCY ?? 4),
  outputLocation: out,
  browserExecutable,
  onProgress: ({ progress }) => {
    const p = Math.floor(progress * 20);
    if (p !== last) {
      last = p;
      console.log(`${(progress * 100).toFixed(0)}%  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  },
});
console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
