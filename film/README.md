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

FRAGMENTATION → DISCOVERY → CONNECTION → ENFORCEMENT → FAIRNESS → BRAND, as one continuous piece: the same shapes
change role from scene to scene instead of cutting.

| Time | Scene | What happens |
|---|---|---|
| 00:00–00:04 | 01 The visual identity | Navy organic forms assemble into the Kin pattern, turn, and swell until navy floods the frame |
| 00:04–00:08 | 02 The problem | The flood opens; ten forms become ten wallets. "One person. Multiple wallets." Their clasps turn blue together; faint lines point to one hidden source |
| 00:08–00:13 | 03 The discovery | The wallets sweep into a circle, the funder rises into the centre, the funding links draw out. "Ten wallets. One funder." |
| 00:13–00:19 | 04 The mechanism | One ring around the group is the shared limit. Each buy adds to one arc; when it closes, the next buy is refused at the ring. "One shared limit." "Enforced onchain." |
| 00:19–00:24 | 05 The fair starting line | The network becomes one emblem standing on a single line with the returning pattern. "One funder. One limit. One fair starting line." |
| 00:24–00:30 | 06 The brand reveal | The pattern frames the screen; the ring becomes the Kin mark's ring, the ten wallets merge into its three dots, the wordmark draws. "Fair token launches on Base" |

**Product accuracy.** Every claim comes from the Kin site and repository: wallets funded by the same source share
one buy limit, enforced in the pool by a Uniswap v4 hook (a buy that would take the group past its limit reverts
onchain), and launches run on Base Sepolia, a testnet (stated on the end card). The film says wallets are linked by
funding, not by identity; it doesn't claim Kin catches every split, and it uses no statistics.

**Brand.** The type is the site's own typeface (Geist and Geist Mono, SIL OFL 1.1, files in
`kin-motion-source/public/fonts`), the accent is the site's blue `#2f55e4`, and the logo is drawn from the exact
geometry of `brand/kin-logo-on-light.svg`. The end frame shows that geometry unaltered.

**Sound.** Original, synthesised from scratch in `kin-motion-source/scripts/sound.py` (numpy, no samples), cued
to the frame timeline. Integrated loudness about −17 LUFS, peaks at −1 dBFS.

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
  src/tokens.ts                 colours, fonts, 12-column grid, scene boundaries, custom easing curves
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
    KineticTypography.tsx       masked headline lines, typed mono labels, scene labels
    KinLogo.tsx                 the logo from the original SVG geometry, stroke by stroke
    SceneTransitions.tsx        radial exits, stretch-and-settle entries, arcing morphs
  src/Film.tsx                  the timeline: one choreography where the pattern, wallets, funder and ring persist
                                and change role; graphics under camera motion blur (12 samples, 180° shutter),
                                typography above it, crisp
  scripts/                      sound.py, render.mjs, mux.sh, verify.sh, docs.cjs, stills.mjs, montage.py
```

## What was missing

The brief referenced an uploaded motion-design video and an uploaded navy-and-white abstract pattern. Neither was
in this build environment (the uploads folder was empty), so they could not be inspected. The pattern was built
from the brief's description of it (deep navy organic shapes, white negative space, irregular rounded silhouettes,
varied proportions, circles, hollow forms, elongated forms) and lives in one file, `src/lib/pattern.ts`, so it can
be retuned to the real image in minutes. The live site (kinverse.vercel.app) was not reachable from this
environment either; its source (`web/` on `main`, the deployed code) was run locally and studied instead.
