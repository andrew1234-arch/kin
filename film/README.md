# KIN · The Fair Starting Line

A 30-second brand film for Kin. **Ten wallets. One funder. One limit.**

| File | What it is |
|---|---|
| `kin-brand-film-30s.mp4` | The film: 1920×1080, 16:9, 60 fps, 1,800 frames, exactly 30 s, H.264 + AAC 48 kHz stereo |
| `kin-brand-film-30s-silent.mp4` | The same video stream with no audio track |
| `kin-contact-sheet.png` | 24 frames from the final render, with timecodes and scene names |
| `kin-storyboard.pdf` | Cover + six scenes: keyframes from the final render, timing, composition, motion direction, sound |
| `kin-motion-source/` | The complete source: Remotion + React + TypeScript + SVG, the sound synthesiser, render and check scripts |

## The film

FRAGMENTATION → DISCOVERY → CONNECTION → ENFORCEMENT → FAIRNESS → BRAND, cut on a musical grid: 128 BPM, 16 bars,
exactly 30 seconds. Every cut lands on a bar line and every accent on a beat, and the same shapes change role from
scene to scene. A KIN HUD (crop marks, bar and beat counter, scene, frame and timecode), film grain and camera motion
blur tie the scenes together; colour fields cut from white to navy (the mechanism) to one blue bar (the stamp) and
back.

| Bars | Time | Scene | What happens |
|---|---|---|---|
| 1–2 | 00:00–03:75 | 01 The pattern | Navy organic forms burst into the Kin pattern; one is inspected (SHAPE PEBBLE, ROT …°); the field swells to a navy flood |
| 3–4 | 03:75–07:50 | 02 The problem | The flood bursts; ten forms become ten wallets. ONE PERSON. MULTIPLE [WALLETS]. Clasps turn blue together; lines point to one hidden source |
| 5–7 | 07:50–13:13 | 03 The link | The wallets sweep into a circle; the funder lands; a link draws on every 8th note (LINKS 01/10 → 10/10). TEN WALLETS. ONE [FUNDER]. |
| 8–10 | 13:13–18:75 | 04 The limit | Cut to navy: one ring is the shared limit; buys fill it on the beat; the sixth is refused. ONE SHARED [LIMIT]. Cut to blue: ENFORCED ONCHAIN. |
| 11–13 | 18:75–24:38 | 05 The fair starting line | Cut to white: the network becomes one emblem on one line with the pattern. ONE FUNDER. ONE LIMIT. ONE [FAIR] STARTING LINE. |
| 14–16 | 24:38–30:00 | 06 Kin | The pattern frames the screen; the ring and three dots (on three beats) become the Kin mark; the wordmark draws. Fair token launches on Base |

The motion language follows the reference reel that was provided (a 15 s, 1080p60, 128 BPM motion reel): beat-locked
hard cuts, full-bleed colour fields, heavy whip-in type with bracket callouts, design-tool overlays with live
readouts, grain and a persistent HUD. Its content and identity are not used: everything here is Kin's own palette,
type, logo and story.

**Product accuracy.** Every claim comes from the Kin site and repository: wallets funded by the same source share
one buy limit, enforced in the pool by a Uniswap v4 hook (a buy that would take the group past its limit reverts
onchain), and launches run on Base Sepolia, a testnet (stated on the end card). The film says wallets are linked by
funding, not by identity; it doesn't claim Kin catches every split, and it uses no statistics.

**Brand.** The type is the site's own typeface (Geist and Geist Mono, SIL OFL 1.1, files in
`kin-motion-source/public/fonts`), the accent is the site's blue `#2f55e4`, and the logo is drawn from the exact
geometry of `brand/kin-logo-on-light.svg`. The end frame shows that geometry unaltered.

**Sound.** An original 128 BPM score and sound design, synthesised from scratch in `kin-motion-source/scripts/sound.py`
(numpy, no samples) on the same bar grid as the picture. Integrated loudness about −16 LUFS, peaks at −1 dBFS.

## Reproduce it

Needs Node 22, Python 3 with numpy, ffmpeg/ffprobe, and a Chromium headless shell. Remotion is pointed at the
Playwright headless shell via `remotion.config.ts` and the scripts. Set `REMOTION_BROWSER=/path/to/chrome-headless-shell`
to use another.

```bash
cd film/kin-motion-source
npm ci
npm run build          # typecheck → sound → render → mux → verify → contact sheet + storyboard
```

Or step by step:

```bash
npm run typecheck
python3 scripts/sound.py public/kin-sound.wav                 # the sound design (WAV, 48 kHz stereo, 30 s)
node scripts/render.mjs out/kin-brand-film-30s-silent.mp4     # 1,800 frames, H.264 CRF 14, yuv420p (~4 min on 4 cores)
bash scripts/mux.sh                                           # adds audio (video copied untouched) → ../*.mp4
bash scripts/verify.sh                                        # duration, size, fps, frame count, codec, 16:9, audio, black frames
node scripts/docs.cjs                                         # ../kin-contact-sheet.png and ../kin-storyboard.pdf
npx remotion studio src/index.ts                              # interactive preview
node scripts/stills.mjs out/stills 300 900 1799               # single frames for review (SCALE=0.5 by default)
```

## Source map

```
kin-motion-source/
  src/tokens.ts                 colours, fonts, 12-column grid, custom easing curves
  src/timing.ts                 the 128 BPM grid (bars, beats), colour fields and their cut points, scene names
  src/lib/anim.ts               frame-based keyframe tracks, easing progress, colour mix, deterministic random
  src/lib/organic.ts            one parametric family for every shape (superellipse + taper + seeded irregularity +
                                hollow), so any shape morphs into any other
  src/lib/pattern.ts            the Kin pattern: 40 editable forms; every scene reuses it
  src/components/
    OrganicPattern.tsx          OrganicShape / OrganicPattern
    WalletSymbol.tsx            the wallet slab with its clasp and index label
    FundingNode.tsx             the shared funder
    ConnectionNetwork.tsx       curved funding links drawn progressively, with pulses
    SharedLimit.tsx             the ring: limit track, spend arc, enforcement echo
    KineticTypography.tsx       beat-locked whip-in headlines with bracket callouts, masked lines, typed mono labels
    Annotation.tsx              design-tool selection: bounding box, handles, crosshair, live readouts
    Hud.tsx                     crop marks, title, bar/beat counter, scene, frame number and timecode
    Grain.tsx                   per-frame film grain and vignette
    KinLogo.tsx                 the logo from the original SVG geometry, stroke by stroke
    SceneTransitions.tsx        radial exits, stretch-and-settle entries, arcing morphs
  src/Film.tsx                  the timeline on the bar grid: one choreography where the pattern, wallets, funder and
                                ring persist and change role; colour field → everything under camera motion blur
                                (12 samples, 200° shutter) → grain → HUD
  scripts/                      sound.py, render.mjs, mux.sh, verify.sh, docs.cjs, stills.mjs, montage.py
```

## References

- **Kin site and repository** (`web/` on `main`, the code deployed at kinverse.vercel.app): brand, type, logo and
  every product claim. The live URL was not reachable from the build environment; the deployed source was run locally.
- **Reference motion reel** (provided as an MP4, 15 s, 1920×1080, 60 fps, 128 BPM): the motion language and the
  quality bar. Analysed with ffprobe/ffmpeg: scene changes every 1.87 s (one bar), frames sampled at 4 fps.
- **Navy-and-white organic pattern**: the image was not provided to the build environment. The pattern was built
  from the brief's description and lives in one file, `src/lib/pattern.ts`, ready to be retuned to the real image.
