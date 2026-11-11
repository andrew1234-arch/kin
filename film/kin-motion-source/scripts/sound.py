"""
Original score and sound design for KIN: The Fair Starting Line. Synthesised from scratch with numpy (no samples,
no third-party audio) on the same grid as the picture: 128 BPM, 4/4, 16 bars = exactly 30 s.

    python3 scripts/sound.py public/kin-sound.wav

bars  0-1   intro: air, a Dmaj9 pad, a soft pluck as each form lands, 16th-note pops for the dots, riser into bar 2
bars  2-3   the burst (impact); half-time kick; a tick as each wallet lands; typed labels
bars  4-6   four-on-the-floor, offbeat hats, pluck bass; the sweep; the funder lands; a ping per link on 8ths
bars  7-8   cut to navy (impact); tighter, mechanical: a click per buy on the beat, pitch rising as the limit fills;
            the refusal: a damped thud
bar   9     cut to blue: the stamp. Drums drop; a low boom and a crack; sub only
bars 10-12  cut to white: the lift. Full groove with claps, 16th arpeggio, a warm pad; the line's shimmer
bars 13-15  the drums fall away; a swirl; three bells on the mark's three dots; the Kin motif; a long D resolve
"""
import sys
import wave

import numpy as np

SR = 48000
BPM = 128
BEAT_S = 60 / BPM
BAR_S = BEAT_S * 4
DUR = 30.0
N = int(SR * DUR)
FPS = 60
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)


def t(bar, beat=0.0):
    return bar * BAR_S + beat * BEAT_S


def t_of(frame):
    return frame / FPS


def place(sig, at, gain=1.0, pan=0.0):
    i = int(round(at * SR))
    if i >= N or i < 0:
        return
    sig = sig[: N - i] * gain
    a = (pan + 1) * np.pi / 4
    L[i : i + len(sig)] += sig * np.cos(a)
    R[i : i + len(sig)] += sig * np.sin(a)


def env(n, attack, release, curve=3.0):
    tt = np.arange(n) / SR
    return np.clip(tt / max(attack, 1e-4), 0, 1) * np.exp(-curve * tt / max(release, 1e-4))


def sine(freq, dur, phase=0.0):
    tt = np.arange(int(dur * SR)) / SR
    if callable(freq):
        return np.sin(2 * np.pi * np.cumsum(freq(tt)) / SR + phase)
    return np.sin(2 * np.pi * freq * tt + phase)


def filt(x, lo, hi):
    """Band-limit by FFT (gaussian in log-frequency)."""
    n = len(x)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    c = np.sqrt(lo * hi)
    w = np.log(hi / lo) / 2 + 1e-6
    return np.fft.irfft(X * np.exp(-(((np.log(fr + 1) - np.log(c)) / w) ** 2)), n)


def norm(x):
    return x / (np.max(np.abs(x)) + 1e-9)


# ---------------------------------------------------------------- instruments
def kick(dur=0.42):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = 46 + 110 * np.exp(-tt * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7.5)
    click = filt(rng.standard_normal(n), 1500, 6000) * np.exp(-tt * 300) * 0.25
    return np.tanh((body + click) * 1.6)


def hat(dur=0.05, open_=False):
    n = int((0.22 if open_ else dur) * SR)
    tt = np.arange(n) / SR
    return norm(filt(rng.standard_normal(n), 7000, 14000)) * np.exp(-tt * (18 if open_ else 90))


def clap():
    n = int(0.25 * SR)
    tt = np.arange(n) / SR
    noise = norm(filt(rng.standard_normal(n), 900, 3200))
    e = np.zeros(n)
    for d in (0, 0.009, 0.018):
        e += np.exp(-np.clip(tt - d, 0, None) * 60) * (tt >= d)
    return noise * e * 0.6


def pluck(freq, dur=0.6, bright=0.4):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = sine(freq, dur) + bright * sine(freq * 2, dur) * np.exp(-tt * 10) + 0.15 * sine(freq * 3, dur) * np.exp(-tt * 14)
    return s * env(n, 0.003, dur, 5.0)


def bass(freq, dur=0.4):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = np.tanh(1.8 * (sine(freq, dur) + 0.35 * sine(freq * 2, dur)))
    return s * env(n, 0.004, dur, 3.2)


def bell(freq, dur=2.6):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = np.zeros(n)
    for ratio, amp, dec in [(1, 1.0, 2.0), (2.0, 0.4, 3.4), (2.76, 0.24, 4.4), (5.4, 0.1, 7.0), (8.93, 0.05, 10)]:
        s += amp * np.sin(2 * np.pi * freq * ratio * tt) * np.exp(-dec * tt / dur * 2.2)
    return s * env(n, 0.002, dur, 1.0)


def click(freq=2400, dur=0.06):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * freq * tt) * np.exp(-tt * 90) + rng.standard_normal(n) * np.exp(-tt * 420) * 0.4) * 0.8


def thud(freq=60, dur=0.7):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = freq * (1 + 1.6 * np.exp(-tt * 26))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7)


def whoosh(dur, lo, hi, peak=0.7):
    n = int(dur * SR)
    y = norm(filt(rng.standard_normal(n), lo, hi))
    x = np.linspace(0, 1, n)
    return y * np.where(x < peak, (x / peak) ** 2.2, ((1 - x) / (1 - peak)) ** 1.4)


def riser(dur, f0=200, f1=2400):
    n = int(dur * SR)
    x = np.linspace(0, 1, n)
    tone = sine(lambda tt: f0 * (f1 / f0) ** (tt / dur), dur) * 0.4
    noise = norm(filt(rng.standard_normal(n), 2000, 9000)) * 0.6
    return (tone + noise) * x**2.5


def impact(gain=1.0):
    n = int(1.4 * SR)
    tt = np.arange(n) / SR
    boom = thud(42, 1.4) * 1.1
    crack = norm(filt(rng.standard_normal(n), 1200, 7000)) * np.exp(-tt * 22) * 0.55
    return (boom + crack) * gain


def pad(freqs, dur, attack, release):
    n = int(dur * SR)
    s = np.zeros(n)
    for k, fq in enumerate(freqs):
        for d in (-0.18, 0.18):
            s += sine(fq * (1 + d / 100), dur, phase=k * 0.7) * 0.6 + 0.16 * sine(fq * 2 * (1 + d / 100), dur)
    tt = np.arange(n) / SR
    return s / len(freqs) * np.clip(tt / attack, 0, 1) ** 2 * np.clip((dur - tt) / release, 0, 1)


# ---------------------------------------------------------------- pitches (D major)
def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


D2, E2, Fs2, G2, A2, B2 = 38, 40, 42, 43, 45, 47
D3, Fs3, A3, B3 = 50, 54, 57, 59
D4, E4, Fs4, A4, B4, D5, E5, Fs5, A5 = 62, 64, 66, 69, 71, 74, 76, 78, 81
PENTA = [D4, E4, Fs4, A4, B4, D5, E5, Fs5, A5]
# Root of each bar (the harmony under the cuts).
ROOT = [D2, D2, D2, B2 - 12, G2, D2, A2 - 12, B2 - 12, G2, A2 - 12, D2, G2, A2 - 12, D2, D2, D2]
CHORD = {
    D2: [D3, Fs3, A3, E4],
    B2 - 12: [B2, D3, Fs3, A3],
    G2: [G2 + 12, B3, D4, Fs4],
    A2 - 12: [A2, E4 - 12, A3, Fs4 - 12],
}

# ---------------------------------------------------------------- bars 0-1: intro
place(norm(filt(rng.standard_normal(int(4.0 * SR)), 300, 3000)) * np.linspace(0, 1, int(4.0 * SR)) ** 1.5 * 0.05, 0.0)
place(pad([hz(D3), hz(A3), hz(E4)], 4.2, 1.2, 0.8), 0.0, 0.22)
for k in range(16):  # a soft pluck as forms land (the opening wave, ~2 frames apart)
    place(pluck(hz(PENTA[(k * 3) % 7]), 0.8), t_of(2 + k * 4.2), 0.11, pan=np.sin(k * 1.7) * 0.6)
for k in range(15):  # dots pop on 16ths through bar 2
    place(pluck(hz(PENTA[3 + k % 5] + 12), 0.25, 0.1), t(1, k / 4), 0.06, pan=np.cos(k) * 0.7)
place(riser(t(2) - t(1, 2), 160, 3200), t(1, 2), 0.22)

# ---------------------------------------------------------------- drums and bass across the grid
for bar in range(16):
    root = ROOT[bar]
    for beat in range(4):
        tb = t(bar, beat)
        four = 4 <= bar <= 8 or 10 <= bar <= 12
        half = bar in (2, 3) and beat in (0, 2)
        if four or half or (bar == 13 and beat == 0):
            place(kick(), tb, 0.55)
        if 4 <= bar <= 12 and bar != 9:
            place(hat(), tb + BEAT_S / 2, 0.07, pan=0.25)  # offbeat
            if bar >= 10:
                place(hat(0.03), tb + BEAT_S * 0.75, 0.035, pan=-0.25)
        if (7 <= bar <= 8 or 10 <= bar <= 12) and beat in (1, 3):
            place(clap(), tb, 0.2, pan=-0.05)
        if 4 <= bar <= 12 and bar != 9:
            place(bass(hz(root), BEAT_S * 0.9), tb + (BEAT_S / 2 if bar in (7, 8) else 0), 0.26)

# ---------------------------------------------------------------- bars 2-3: the problem
place(impact(0.6), t(2), 0.5)
for i in range(10):  # wallets land in the row
    place(click(1800 + i * 60, 0.05), t_of(226 + i * 2 + 40), 0.1, pan=-0.8 + i * 0.18)
for i in range(10):  # typed labels on 16ths
    place(click(3200, 0.02), t(3, i / 4), 0.05, pan=-0.8 + i * 0.18)
place(pad([hz(n) for n in CHORD[D2]], 2 * BAR_S, 0.6, 0.6), t(2), 0.07)
place(sine(lambda tt: 300 + 300 * tt, 0.9) * env(int(0.9 * SR), 0.3, 0.9, 2), t(3, 2), 0.05)  # the hint lines

# ---------------------------------------------------------------- bars 4-6: the link
place(whoosh(1.1, 200, 2600, 0.6), t(4), 0.3, pan=-0.3)  # the sweep
place(thud(58, 1.0), t(5), 0.6)  # the funder lands
place(bell(hz(D4), 2.6), t(5), 0.12)
for k in range(10):  # a ping per link, 8th notes
    place(pluck(hz(PENTA[k % len(PENTA)] + 12), 0.4, 0.5), t(5, k / 2) + 0.1, 0.07, pan=np.cos(k * 0.63) * 0.7)
for b in (4, 5, 6):
    place(pad([hz(n) for n in CHORD[ROOT[b]]], BAR_S, 0.3, 0.4), t(b), 0.07)

# ---------------------------------------------------------------- bars 7-8: the limit (navy)
place(impact(0.8), t(7), 0.55)
place(sine(lambda tt: 180 + 400 * tt, 0.66) * env(int(0.66 * SR), 0.5, 0.66, 1.2), t(7), 0.07)  # the ring draws
for k, (bar, beat) in enumerate([(7, 2), (7, 3), (8, 0), (8, 1), (8, 2)]):  # a buy lands on each beat
    place(click(1300 + k * 220, 0.07), t(bar, beat), 0.32, pan=np.sin(k * 2.1) * 0.5)
    place(pluck(hz(PENTA[k + 2]), 0.35, 0.2), t(bar, beat) + 0.01, 0.07)
place(thud(46, 0.8), t(8, 3), 0.9)  # the refusal: firm and damped, not an alarm
place(click(520, 0.12), t(8, 3), 0.45)
for b in (7, 8):
    place(pad([hz(n) for n in CHORD[ROOT[b]]], BAR_S, 0.2, 0.3), t(b), 0.06)

# ---------------------------------------------------------------- bar 9: the stamp (blue)
place(impact(1.0), t(9), 0.8)
place(thud(36, 1.8) * 0.7, t(9), 0.6)
place(click(4200, 0.03), t(9, 1), 0.12)  # ONCHAIN.
place(riser(t(10) - t(9, 2), 200, 2600), t(9, 2), 0.18)
place(pad([hz(A2), hz(E4 - 12)], BAR_S, 0.1, 0.6), t(9), 0.1)

# ---------------------------------------------------------------- bars 10-12: the lift
place(impact(0.7), t(10), 0.5)
place(whoosh(0.9, 2000, 9000, 0.9) * 0.6, t_of(1128), 0.12, pan=-0.5)  # the line draws
for b in (10, 11, 12):
    place(pad([hz(n) for n in CHORD[ROOT[b]]], BAR_S, 0.25, 0.5), t(b), 0.11)
    for k in range(16):  # 16th arpeggio, quiet
        place(pluck(hz(PENTA[(k * 2 + b) % len(PENTA)]), 0.22, 0.25), t(b, k / 4), 0.035, pan=np.sin(k) * 0.5)
for i in range(8):  # forms rise onto the line, 8ths
    place(pluck(hz(PENTA[i]), 0.5, 0.3), t(10, 2 + i / 2), 0.07, pan=-0.8 + i * 0.2)

# ---------------------------------------------------------------- bars 13-15: Kin
place(whoosh(1.4, 150, 4000, 0.6), t(13) - 0.15, 0.3)  # the field gathers into the frame
for k, n in enumerate([D5, Fs5, A5]):  # the mark's three dots, on beats 2-4
    place(bell(hz(n), 2.8), t(13, 1 + k), 0.13, pan=[-0.4, 0.4, 0.0][k])
place(impact(0.55), t(14), 0.45)  # the mark locks
for i in range(5):  # wordmark strokes, 16ths
    place(click(2600 - i * 150, 0.03), t(14, i / 4), 0.07, pan=0.1 + i * 0.08)
for k, (n, beat) in enumerate([(D4, 1), (Fs4, 1.5), (A4, 2), (D5, 3)]):  # the Kin motif
    place(bell(hz(n), 3.4), t(14, beat), 0.14 if k < 3 else 0.17, pan=[-0.2, 0.0, 0.2, 0.0][k])
place(pad([hz(D2), hz(A2), hz(D3), hz(Fs3), hz(A3), hz(E4)], DUR - t(14) + 0.1, 0.5, 3.0), t(14), 0.17)


# ---------------------------------------------------------------- reverb + master
def reverb(x, seconds=2.2, seed=1):
    n = int(seconds * SR)
    g = np.random.default_rng(seed)
    ir = g.standard_normal(n) * np.exp(-np.arange(n) / SR * 6.0 / seconds)
    ir[0] = 0
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return y / (np.max(np.abs(ir)) * 40)


outL = L + 0.45 * reverb(L, seed=1)
outR = R + 0.45 * reverb(R, seed=2)
fade = np.ones(N)
fi, fo = int(0.03 * SR), int(1.4 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo) ** 2
stereo = np.stack([outL * fade, outR * fade], axis=1)
stereo = np.tanh(stereo / np.max(np.abs(stereo)) * 1.6) / np.tanh(1.6)  # soft limit
stereo *= 10 ** (-1.0 / 20)  # peak −1 dBFS
pcm = (stereo * 32767).astype("<i2")
out = sys.argv[1] if len(sys.argv) > 1 else "public/kin-sound.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"wrote {out}: {DUR:.1f} s, {SR} Hz stereo, {BPM} BPM")
