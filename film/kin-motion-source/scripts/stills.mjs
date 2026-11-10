// Renders individual frames as PNGs for review: node scripts/stills.mjs out/dir 120 240 ...
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";

const browserExecutable =
  process.env.REMOTION_BROWSER ??
  "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const [outDir = "out/stills", ...frames] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "KinBrandFilm", browserExecutable });
for (const f of frames.map(Number)) {
  const output = path.join(outDir, `f${String(f).padStart(4, "0")}.png`);
  await renderStill({ composition, serveUrl, frame: f, output, browserExecutable, scale: Number(process.env.SCALE ?? 0.5) });
  console.log(output);
}
