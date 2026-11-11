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
    n: "01", name: "The pattern", range: [0, 225], keys: [60, 150, 205],
    story: "Bars 1-2. Navy organic forms (pebbles, capsules, discs, rings, eggs) burst out of the centre in a fast wave, stretching and snapping into place; dots pop in on 16th notes. A design-tool selection inspects one pebble (SHAPE PEBBLE, ROT …°) as the field turns, then everything swells until navy floods the frame.",
    composition: "Full-bleed pattern under the KIN HUD: crop marks, title, bar and beat counter, scene, frame and timecode.",
    motion: "Grow on expo-out with a stretch-and-settle, ~2 frames apart by distance from centre; the swell accelerates (expo-in) into the cut. Camera motion blur throughout.",
    sound: "Air and a Dmaj9 pad; a pluck per form; 16th-note pops; a riser into bar 3.",
  },
  {
    n: "02", name: "The problem", range: [225, 450], keys: [260, 330, 420],
    story: "Bars 3-4. The flood bursts on the downbeat; ten forms snap into ten identical wallets. ONE PERSON. whips in on beat 2, MULTIPLE WALLETS. on beat 3, and the site's corner brackets close around WALLETS on beat 4. Labels count 01-10 on 16ths; the clasps turn blue together; dotted lines run to one point below the frame.",
    composition: "Heavy uppercase Geist headline, top left; the row of ten across the lower third.",
    motion: "Radial burst on expo-in; whip-ins from the right with a horizontal stretch that snaps back; brackets on a small overshoot.",
    sound: "An impact on the cut; a half-time kick; a tick per wallet; typed clicks.",
  },
  {
    n: "03", name: "The link", range: [450, 788], keys: [500, 640, 760],
    story: "Bars 5-7. The wallets sweep round together into a circle (order kept, nothing crosses). The funder lands on the downbeat of bar 6, and a funding link draws to each wallet on every 8th note while a selection box counts LINKS 01/10 → 10/10. TEN WALLETS. ONE [FUNDER]. Caption: linked by funding, not by identity.",
    composition: "Headline left, network right; the inspector reads FUNDER 01.",
    motion: "Polar sweep with an outward bulge; funder on back-out with a camera kick; links drawn with a leading dot.",
    sound: "Four-on-the-floor, offbeat hats, pluck bass; a sweep; a thud and a bell as the funder lands; a ping per link.",
  },
  {
    n: "04", name: "The limit", range: [788, 1125], keys: [870, 1000, 1060],
    story: "Bars 8-10. Hard cut to navy. A ring draws around the group: ONE SHARED [LIMIT]. Buys land on the beat, each adding to one arc while LIMIT USED counts up; five buys fill it; the sixth reaches the ring and is refused: it bounces back hollow as the ring flashes. Bar 10: hard cut to blue, ENFORCED / ONCHAIN. stamped in Geist Black, with: a Uniswap v4 hook in the pool refuses any buy over the limit.",
    composition: "Navy field, white network, light-blue limit; then one blue bar with type only.",
    motion: "Buys on expo-in, the arc on expo-out; the refusal is a reversal plus an outward echo; the stamp whips in and holds.",
    sound: "Impact on the cut; a click per buy, pitch rising; a damped thud for the refusal; the stamp: drums drop to a boom and a crack, then a riser.",
  },
  {
    n: "05", name: "The fair starting line", range: [1125, 1462], keys: [1160, 1300, 1420],
    story: "Bars 11-13. Hard cut back to white. The network contracts into one emblem; a line draws across the frame and the pattern rises out of it on 8th notes, standing side by side with the emblem. ONE FUNDER. ONE LIMIT. ONE [FAIR] STARTING LINE. The line turns blue under the last words.",
    composition: "Four-line headline dominating the upper half; the starting line at the lower third.",
    motion: "Emblem on quint in-out; forms rise through a clip at the line with a small overshoot; gentle breathing at rest.",
    sound: "The lift: full groove with claps, a 16th arpeggio, a warm pad; the line's shimmer.",
  },
  {
    n: "06", name: "Kin", range: [1462, 1800], keys: [1500, 1600, 1799],
    story: "Bars 14-16. The forms on the line fly out into a frame of the pattern; the ring shrinks into the Kin mark's ring and the ten wallets merge into its three dots, one dot on each of beats 2, 3 and 4; the triangle draws; the mark locks on the downbeat of bar 15 and the wordmark draws stroke by stroke from the original logo. FAIR TOKEN LAUNCHES ON BASE · One fair starting line. · the address and status (Base Sepolia testnet). The HUD strips back to crop marks and timecode.",
    composition: "The original logo (brand/kin-logo-on-light.svg) centred in a frame of the pattern: a standalone brand frame.",
    motion: "Arcing morphs into the frame; dots on the beat; strokes on 16ths; a final breath on the logo.",
    sound: "The drums fall away; a swirl; three bells on the three dots; the Kin motif; a long D resolve.",
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
  // Pages are written to disk and opened as file:// so local frames and fonts are allowed to load.
  const open = async (name, html) => {
    const file = path.join(OUT, name);
    fs.writeFileSync(file, html);
    await page.goto("file://" + file, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
  };
  await open("contact-sheet.html", `<html><head><style>${fontCss}
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
  await open("storyboard.html", `<html><head><style>${fontCss}
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
      <div class="row"><p class="mono">1920×1080 · 16:9</p><p class="mono">60 fps · 1,800 frames</p><p class="mono">H.264 · AAC 48 kHz</p><p class="mono">128 BPM · 16 bars</p><p class="mono">Fragmentation → discovery → connection → enforcement → fairness → brand</p></div>
      <p style="margin-top:40px;max-width:1100px;font-size:18px;line-height:1.5">Cut on a 128 BPM grid: 16 bars are exactly 30 seconds, every cut lands on a bar line and every accent on a beat. Keyframes are taken from the final rendered video. Product claims follow the Kin site and repository: wallets funded by the same source share one buy limit, enforced in the pool by a Uniswap v4 hook; launches run on Base Sepolia (testnet). Kin links wallets by funding, not by identity, and makes splitting costly and visible; it does not claim to catch every split.</p>
    </section>${pages}</body></html>`);
  await page.waitForTimeout(500);
  await page.pdf({ path: path.resolve(ROOT, "..", "kin-storyboard.pdf"), width: "1600px", height: "900px", printBackground: true });
  await browser.close();
  console.log("wrote ../kin-contact-sheet.png and ../kin-storyboard.pdf");
})();
