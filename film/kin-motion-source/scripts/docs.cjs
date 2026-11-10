// Builds the review documents from the FINAL rendered video (never from source):
//   ../kin-contact-sheet.png  24 representative frames with timecodes and scene names
//   ../kin-storyboard.pdf     six scenes: keyframes, timing, composition, motion direction, sound
// Usage: node scripts/docs.cjs   (needs ffmpeg and Playwright's Chromium)
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const FILM = path.resolve(ROOT, "..", "kin-brand-film-30s.mp4");
const OUT = path.join(ROOT, "out", "docs");
fs.mkdirSync(OUT, { recursive: true });

const SCENES = [
  {
    n: "01", name: "The visual identity", range: [0, 240], keys: [40, 150, 222],
    story: "A white canvas. Navy organic forms (pebbles, capsules, discs, rings, eggs) arrive one after another from the centre outwards, each stretching and then relaxing into place; small dots pop in between. The field turns a few degrees as one, then swells until navy floods the frame.",
    composition: "Full-bleed pattern on a loose grid; white negative space between forms until the flood.",
    motion: "Grow on expo-out, settle on quint in-out, a stagger of ~3.4 frames by distance from centre; dots on a soft back-out. The swell is the scene's single big gesture.",
    sound: "Air and a low drone; soft plucks as forms land; a low swell into the flood.",
  },
  {
    n: "02", name: "The problem", range: [240, 480], keys: [300, 420, 470],
    story: "The flood opens: most forms fly outward and vanish, ten of them morph into identical wallet slabs that land in a row. “One person. / Multiple wallets.” rises through masks. The wallets drift apart; labels count 01 to 10; their clasps turn blue together and faint lines run down towards one hidden point below the frame.",
    composition: "Oversized two-line headline top left on the 12-column grid; the row of ten across the lower third.",
    motion: "Radial exits on expo-in; arcing morphs into the row; directional spread; typed mono labels.",
    sound: "A muted pulse at 120 BPM; a tick as each wallet lands; typed clicks.",
  },
  {
    n: "03", name: "The discovery", range: [480, 780], keys: [540, 680, 760],
    story: "The ten wallets sweep round together into a circle (their order is kept, so nothing crosses). From the point the hint lines pointed to, the funder rises into the centre. Funding links draw out to every wallet one by one, a blue pulse running along each. “Ten wallets. / One funder.”",
    composition: "Headline left, network right of centre; a mono caption: linked by funding, not by identity.",
    motion: "Polar sweep (radius and angle interpolated, with an outward bulge); funder on back-out; links drawn with a leading dot.",
    sound: "A sweep as the wallets circle; a low bloom as the funder lands; one rising ping per link.",
  },
  {
    n: "04", name: "The Kin mechanism", range: [780, 1140], keys: [880, 1000, 1050],
    story: "A ring draws around the whole group: one shared limit. Wallets buy in turn; each buy travels out to the ring and adds to one blue arc, whoever sent it. When the arc closes, the next buy reaches the ring and is refused: it bounces back hollow while the ring flashes. “One shared / limit.” then “Enforced onchain.” with: a Uniswap v4 hook in the pool refuses any buy over the limit.",
    composition: "The ring is the single strong boundary; a mono readout counts the limit used; the refusal is labelled beside it.",
    motion: "Buys on expo-in, the arc on expo-out; the refusal is a reversal plus an outward echo of the ring, not a warning panel.",
    sound: "The ring's rising draw; a precise click per buy, pitch rising as the limit fills; a firm, damped refusal.",
  },
  {
    n: "05", name: "The fair starting line", range: [1140, 1440], keys: [1200, 1330, 1420],
    story: "The network contracts into a compact emblem: one ring, one funder, ten wallets. A single line draws across the frame and the pattern returns: forms rise out of the line and stand on it side by side, the emblem among them. “One funder. / One limit. / One fair starting line.” The line turns blue under the last words.",
    composition: "Three-line headline dominating the upper half; the starting line at the lower third; generous white space.",
    motion: "Emblem moves on quint in-out; forms rise through a clip at the line with slight overshoot; gentle breathing at rest.",
    sound: "A warm D(add9) pad: the lift; a shimmer as the line draws; soft plucks as forms rise.",
  },
  {
    n: "06", name: "The brand reveal", range: [1440, 1800], keys: [1500, 1610, 1799],
    story: "The forms on the line fly out to become a frame of the pattern around the edges. The emblem's ring shrinks into the Kin mark's ring; the ten wallets merge into its three dots; the triangle draws between them. The wordmark draws stroke by stroke from the original logo. “Fair token launches on Base”, “One fair starting line.”, and the address with its status (Base Sepolia testnet).",
    composition: "The original logo (brand/kin-logo-on-light.svg) centred; the pattern frames it; the final frame stands alone as a brand visual.",
    motion: "Arcing morphs into the frame; wallets to dots on quint in-out; strokes drawn on expo-out; a slight final breath on the logo.",
    sound: "A gathering swirl; three bell tones as the three dots form; the Kin motif (a rising triad and its octave); a long resolve.",
  },
];
const tc = (f) => `00:${String(Math.floor(f / 60)).padStart(2, "0")}:${String(f % 60).padStart(2, "0")}`;
const sceneOf = (f) => SCENES.find((s) => f >= s.range[0] && f < s.range[1]) ?? SCENES[5];

function grab(frame) {
  const file = path.join(OUT, `k${String(frame).padStart(4, "0")}.png`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", FILM, "-vf", `select=eq(n\\,${frame})`, "-vsync", "vfr", "-frames:v", "1", file]);
  return file;
}

const fontCss = `
@font-face{font-family:Geist;src:url(file://${ROOT}/public/fonts/Geist-Regular.woff2);font-weight:400}
@font-face{font-family:Geist;src:url(file://${ROOT}/public/fonts/Geist-Medium.woff2);font-weight:500}
@font-face{font-family:Geist Mono;src:url(file://${ROOT}/public/fonts/GeistMono-Regular.woff2);font-weight:400}
*{box-sizing:border-box;margin:0}
body{font-family:Geist;color:#102F59;background:#fff}
.mono{font-family:'Geist Mono';text-transform:uppercase;letter-spacing:.14em;font-size:12px}
.blue{color:#2F55E4}`;

(async () => {
  const sheetFrames = [20, 90, 160, 222, 300, 380, 450, 530, 610, 690, 760, 840, 920, 1000, 1050, 1120, 1200, 1280, 1360, 1420, 1500, 1580, 1680, 1799];
  const keyFrames = SCENES.flatMap((s) => s.keys);
  const all = [...new Set([...sheetFrames, ...keyFrames])];
  const files = Object.fromEntries(all.map((f) => [f, grab(f)]));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2400, height: 1400 }, deviceScaleFactor: 1 });

  // ---- contact sheet
  const tiles = sheetFrames
    .map(
      (f) => `<figure><img src="file://${files[f]}"><figcaption><span class="mono">${tc(f)} · f${f}</span><span class="mono blue">${sceneOf(f).n} ${sceneOf(f).name}</span></figcaption></figure>`,
    )
    .join("");
  await page.setContent(`<html><head><style>${fontCss}
    body{padding:56px;width:2400px}
    header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28px}
    h1{font-weight:500;font-size:44px;letter-spacing:-.04em}
    .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:20px 16px}
    figure img{width:100%;display:block;border:1px solid rgba(16,47,89,.18)}
    figcaption{display:flex;justify-content:space-between;margin-top:8px}
  </style></head><body>
    <header><h1>KIN · The Fair Starting Line</h1><span class="mono">Contact sheet · 30 s · 1920×1080 · 60 fps · 1,800 frames · frames from the final render</span></header>
    <div class="grid">${tiles}</div></body></html>`);
  await page.waitForTimeout(500);
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 2400, height: h });
  await page.screenshot({ path: path.resolve(ROOT, "..", "kin-contact-sheet.png"), fullPage: true });

  // ---- storyboard (one landscape page per scene, plus a cover)
  const pages = SCENES.map(
    (s) => `<section>
      <div class="head"><span class="mono">[ ${s.n} ]  ${s.name}</span><span class="mono">${tc(s.range[0])} – ${tc(s.range[1])} · frames ${s.range[0]}–${s.range[1] - 1} · ${(s.range[1] - s.range[0]) / 60} s</span></div>
      <div class="keys">${s.keys.map((f) => `<figure><img src="file://${files[f]}"><figcaption class="mono">key ${tc(f)} · f${f}</figcaption></figure>`).join("")}</div>
      <div class="text">
        <div><p class="mono blue">Story</p><p>${s.story}</p></div>
        <div><p class="mono blue">Composition</p><p>${s.composition}</p><p class="mono blue">Motion direction</p><p>${s.motion}</p><p class="mono blue">Sound</p><p>${s.sound}</p></div>
      </div></section>`,
  ).join("");
  await page.setContent(`<html><head><style>${fontCss}
    @page{size:1600px 900px;margin:0}
    section{width:1600px;height:900px;padding:56px 64px;page-break-after:always;display:flex;flex-direction:column;gap:26px}
    .head{display:flex;justify-content:space-between;border-bottom:2px solid #102F59;padding-bottom:12px}
    .keys{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
    .keys img{width:100%;display:block;border:1px solid rgba(16,47,89,.18)}
    figcaption{margin-top:6px}
    .text{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;font-size:17px;line-height:1.45}
    .text p{margin-bottom:8px}
    .cover{justify-content:center}
    .cover h1{font-weight:500;font-size:96px;letter-spacing:-.05em;line-height:1}
    .cover h2{font-weight:500;font-size:40px;letter-spacing:-.03em;margin-top:18px}
    .cover .row{display:flex;gap:48px;margin-top:56px}
  </style></head><body>
    <section class="cover"><p class="mono">KIN · 30-second brand film · storyboard</p><h1>The Fair Starting Line</h1>
      <h2 class="blue">Ten wallets. One funder. One limit.</h2>
      <div class="row"><p class="mono">1920×1080 · 16:9</p><p class="mono">60 fps · 1,800 frames</p><p class="mono">H.264 · AAC 48 kHz</p><p class="mono">Fragmentation → discovery → connection → enforcement → fairness → brand</p></div>
      <p style="margin-top:40px;max-width:1100px;font-size:18px;line-height:1.5">Keyframes are taken from the final rendered video. Product claims follow the Kin site and repository: wallets funded by the same source share one buy limit, enforced in the pool by a Uniswap v4 hook; launches run on Base Sepolia (testnet). Kin links wallets by funding, not by identity, and makes splitting costly and visible; it does not claim to catch every split.</p>
    </section>${pages}</body></html>`);
  await page.waitForTimeout(500);
  await page.pdf({ path: path.resolve(ROOT, "..", "kin-storyboard.pdf"), width: "1600px", height: "900px", printBackground: true });
  await browser.close();
  console.log("wrote ../kin-contact-sheet.png and ../kin-storyboard.pdf");
})();
