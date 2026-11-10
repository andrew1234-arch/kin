"""
Original sound design for KIN: The Fair Starting Line. Synthesised from scratch with numpy (no samples, no
third-party audio), cue by cue against the film's frame timeline (60 fps).

    python3 scripts/sound.py public/kin-sound.wav

00-04  atmosphere: air, a low drone, soft plucks as the pattern forms, a swell into the navy flood
04-08  light rhythm: a muted pulse, ticks as the wallets land, typed labels
08-13  discovery: a sweep as the wallets circle, the funder's bloom, one ping per funding link
13-19  mechanism: the ring's rising draw, a precise click per buy (pitch rising as the limit fills),
       a firm, damped refusal
19-24  lift: a warm chord pad, the starting line's shimmer
24-30  brand: a gathering swirl, three bell tones as the mark's three dots form, the KIN motif, a long resolve
"""
import sys
import wave

import numpy as np

SR = 48000
DUR = 30.0
N = int(SR * DUR)
FPS = 60
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)


def t_of(frame):
    return frame / FPS


def place(sig, at, gain=1.0, pan=0.0):
    """Mix a mono signal in at time `at` (seconds), equal-power pan -1..1."""
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    a = (pan + 1) * np.pi / 4
    L[i : i + len(sig)] += sig * np.cos(a)
    R[i : i + len(sig)] += sig * np.sin(a)


def env(n, attack, release, curve=3.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.exp(-curve * t / max(release, 1e-4))
    return a * r


def sine(freq, dur, phase=0.0):
    t = np.arange(int(dur * SR)) / SR
    if callable(freq):
        ph = 2 * np.pi * np.cumsum(freq(t)) / SR
        return np.sin(ph + phase)
    return np.sin(2 * np.pi * freq * t + phase)


def pluck(freq, dur=0.9, bright=0.35):
    n = int(dur * SR)
    s = sine(freq, dur) + bright * sine(freq * 2, dur) * np.exp(-np.arange(n) / SR * 9) + 0.12 * sine(freq * 3, dur)
    return s * env(n, 0.004, dur, 5.0)


def bell(freq, dur=2.4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for ratio, amp, dec in [(1, 1.0, 2.2), (2.0, 0.42, 3.5), (2.76, 0.26, 4.5), (5.4, 0.12, 7.0), (8.93, 0.05, 10)]:
        s += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-dec * t / dur * 2.2)
    return s * env(n, 0.002, dur, 1.0)


def click(freq=2400, dur=0.06):
    n = int(dur * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * freq * t) * np.exp(-t * 90)
    tick = rng.standard_normal(n) * np.exp(-t * 400) * 0.5
    return (body + tick) * 0.8


def thump(freq=70, dur=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq * (1 + 1.5 * np.exp(-t * 30))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def bandnoise(dur, lo, hi):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    mask = np.exp(-(((np.log(fr + 1) - np.log((lo + hi) / 2)) / (np.log(hi / lo) / 2 + 1e-6)) ** 2))
    y = np.fft.irfft(X * mask, n)
    return y / (np.max(np.abs(y)) + 1e-9)


def whoosh(dur, lo, hi, peak=0.6):
    n = int(dur * SR)
    y = bandnoise(dur, lo, hi)
    t = np.linspace(0, 1, n)
    shape = np.where(t < peak, (t / peak) ** 2, ((1 - t) / (1 - peak)) ** 1.5)
    return y * shape


def pad(freqs, dur, attack, release):
    n = int(dur * SR)
    s = np.zeros(n)
    for k, f in enumerate(freqs):
        for d in (-0.15, 0.15):
            s += sine(f * (1 + d / 100), dur, phase=k) * (0.7 if d < 0 else 0.6)
            s += 0.18 * sine(f * 2 * (1 + d / 100), dur)
    t = np.arange(n) / SR
    e = np.clip(t / attack, 0, 1) ** 2 * np.clip((dur - t) / release, 0, 1)
    return s / len(freqs) * e


# Pitches (D major pentatonic family: open, unresolved, never "epic").
D2, A2, D3, E3, Fs3, A3, B3, D4, E4, Fs4, A4, B4, D5, E5, Fs5, A5 = (
    73.42, 110.0, 146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.26, 739.99, 880.0,
)
PENTA = [D4, E4, Fs4, A4, B4, D5, E5, Fs5, A5]

# ---------------------------------------------------------------- 00-04 identity
place(bandnoise(4.6, 300, 3000) * np.linspace(0, 1, int(4.6 * SR)) ** 1.5 * 0.05, 0.0)  # air
place(pad([D2, A2], 4.8, 1.8, 0.8), 0.0, 0.22)  # low drone
for k in range(12):  # plucks as the forms arrive (every third large form)
    place(pluck(PENTA[(k * 3) % 7], 1.0), t_of(4 + k * 10.2), 0.16, pan=np.sin(k * 1.7) * 0.6)
for k in range(6):  # small dots pop
    place(pluck(PENTA[5 + k % 4] * 2, 0.35, 0.1), t_of(118 + k * 9), 0.07, pan=np.cos(k) * 0.7)
place(whoosh(1.1, 80, 900, 0.85), t_of(176), 0.35)  # the swell into the navy flood
place(thump(55, 0.9), t_of(222), 0.5)
place(whoosh(0.9, 400, 6000, 0.2), t_of(232), 0.22, pan=0.2)  # the field opens

# A quiet bed under the middle of the film, so the cues never sit on dead silence.
bed = pad([D2, A2, E3], 16.0, 2.0, 2.0) * (0.75 + 0.25 * np.sin(np.linspace(0, 5 * np.pi, int(16.0 * SR))))
place(bed, 3.8, 0.07)
place(bandnoise(16.0, 200, 1600) * 0.025, 3.8)

# ---------------------------------------------------------------- 04-08 problem
for k in range(8):  # a muted pulse, 120 BPM
    place(thump(90, 0.25) * 0.6, 4.0 + k * 0.5, 0.22)
    place(click(900, 0.04) * 0.15, 4.0 + k * 0.5, 0.22)
for i in range(10):  # wallets land in the row
    place(click(1800 + i * 60, 0.05), t_of(240 + i * 4 + 66), 0.12, pan=-0.8 + i * 0.18)
for i in range(10):  # typed labels 01..10
    place(click(3200, 0.02), t_of(352 + i * 5), 0.05, pan=-0.8 + i * 0.18)
place(sine(lambda t: 220 + 110 * t, 1.4) * env(int(1.4 * SR), 0.6, 1.4, 1.5), t_of(384), 0.06)  # the hint

# ---------------------------------------------------------------- 08-13 discovery
place(whoosh(1.7, 200, 2500, 0.5), t_of(488), 0.3, pan=-0.3)  # the wallets sweep round
place(thump(62, 1.0), t_of(640), 0.55)  # the funder lands
place(bell(D3, 3.0), t_of(642), 0.16)
order = [0, 5, 2, 7, 4, 9, 1, 6, 3, 8]
for k in range(10):  # one ping per funding link, rising
    place(pluck(PENTA[k % len(PENTA)] * 2, 0.6, 0.5), t_of(652 + k * 7 + 10), 0.09, pan=np.cos(order[k] * 0.63) * 0.7)
place(pad([D3, A3, E4], 3.2, 1.2, 1.4), t_of(600), 0.08)

# ---------------------------------------------------------------- 13-19 mechanism
place(sine(lambda t: 180 + 260 * t, 1.25) * env(int(1.25 * SR), 0.9, 1.25, 1.2), t_of(800), 0.08)  # ring draws
BUYS = [858, 884, 906, 930, 952, 974]
fill = 0
for k, at in enumerate(BUYS):  # precise mechanical clicks as the limit fills
    arrive = t_of(at + 20)
    place(click(1400 + k * 180, 0.07), arrive, 0.32, pan=np.sin(k * 2.1) * 0.5)
    place(thump(120 + k * 12, 0.18), arrive, 0.18)
    place(pluck(PENTA[k + 1], 0.5, 0.2), arrive + 0.02, 0.06)
place(bell(A4, 1.6), t_of(994 + 14), 0.1)  # the limit is reached
refused = t_of(1012 + 20)
place(thump(48, 0.7), refused, 0.8)  # refused: firm and damped, not an alarm
place(click(600, 0.12), refused, 0.4)
place(bandnoise(0.35, 120, 600) * env(int(0.35 * SR), 0.002, 0.35, 6), refused, 0.25)
place(pad([D2, A2], 2.4, 0.6, 1.2), t_of(1020), 0.12)

# ---------------------------------------------------------------- 19-24 the fair starting line (the lift)
place(whoosh(1.2, 150, 1800, 0.7), t_of(1140), 0.22)
place(pad([D3, Fs3, A3, E4], 5.4, 1.4, 1.6), t_of(1150), 0.13)  # warm D(add9)
place(pad([D2], 5.0, 1.6, 1.4), t_of(1150), 0.18)
place(whoosh(1.1, 2000, 9000, 0.9) * 0.6, t_of(1226), 0.12, pan=-0.5)  # line draws left to right
for i in range(8):  # forms rise onto the line
    place(pluck(PENTA[i] , 0.8, 0.3), t_of(1246 + i * 6 + 20), 0.08, pan=-0.8 + i * 0.2)
place(sine(lambda t: 587 + 293 * t / 1.1, 1.1) * env(int(1.1 * SR), 0.5, 1.1, 2), t_of(1306), 0.05, pan=0.3)

# ---------------------------------------------------------------- 24-30 brand
place(whoosh(1.6, 150, 4000, 0.65), t_of(1440), 0.3)  # the field gathers into the frame
for k, f0 in enumerate([D5, Fs5, A5]):  # three bells: the mark's three dots
    place(bell(f0, 3.2), t_of(1540 + k * 8), 0.13, pan=[-0.4, 0.0, 0.4][k])
place(thump(58, 1.2), t_of(1590), 0.5)  # the mark locks
for i in range(5):  # wordmark strokes
    place(click(2600 - i * 150, 0.03), t_of(1568 + i * 9 + 18), 0.07, pan=0.1 + i * 0.08)
# The KIN motif: three notes up a major triad, then the root an octave up.
for k, (f0, at) in enumerate([(D4, 1596), (Fs4, 1608), (A4, 1620), (D5, 1640)]):
    place(bell(f0, 3.6), t_of(at), 0.14 if k < 3 else 0.18, pan=[-0.2, 0.0, 0.2, 0.0][k])
place(pad([D2, A2, D3, Fs3, A3, E4], 4.6, 0.8, 3.2), t_of(1600), 0.17)  # resolve

# ---------------------------------------------------------------- reverb + master
def reverb(x, seconds=2.4, seed=1):
    n = int(seconds * SR)
    g = np.random.default_rng(seed)
    ir = g.standard_normal(n) * np.exp(-np.arange(n) / SR * 6.0 / seconds)
    ir[0] = 0
    m = len(x) + n
    size = 1 << int(np.ceil(np.log2(m)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return y / (np.max(np.abs(ir)) * 40)


wetL, wetR = reverb(L, seed=1), reverb(R, seed=2)
outL = L + 0.6 * wetL
outR = R + 0.6 * wetR
# Fade in from silence and out to silence at the very ends (no clicks).
fade = np.ones(N)
fi = int(0.05 * SR)
fo = int(1.6 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo) ** 2
stereo = np.stack([outL * fade, outR * fade], axis=1)
stereo = np.tanh(stereo / np.max(np.abs(stereo)) * 1.3) / np.tanh(1.3)  # gentle soft limit
stereo *= 10 ** (-1.0 / 20)  # peak at -1 dBFS
pcm = (stereo * 32767).astype("<i2")

out = sys.argv[1] if len(sys.argv) > 1 else "public/kin-sound.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"wrote {out}: {DUR:.1f} s, {SR} Hz stereo")
