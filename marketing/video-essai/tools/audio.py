"""Soundtrack v4 — original funk-électro at 120 BPM, royalty-free (fully synthesised here, no samples).

0–2 s  : dark drone, heartbeats, riser into the bloom.
2 s    : impact + the 4-note signature (C5 F5 G5 A5) on a bright lead, brass-like stab.
4–34 s : breakbeat (kick, backbeat snare, ghost notes, swung 16th hats, shaker), slap-style synth
         bass, syncopated stabs. F – E♭ – B♭ – F, then the lift B♭ – C – Dm – C with a hook melody.
34–38 s: break then build (snare roll, riser), a breath, and the drop on the call to action
         with the signature again on linkrapp.com. Final stab rings out to the end.
Sound effects follow the picture (whooshes on whip pans, clicks on taps, chimes on confirmations).
Reads ../timeline.json (exported from the CONFIG block of anim.js), writes ../audio/soundtrack.wav.
"""
import json, pathlib
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TL = json.loads((ROOT / "timeline.json").read_text())
A, SC = TL["at"], TL["scenes"]
SR, DUR = 48000, TL["duration"]
N = int(SR * DUR)
BEAT = 60 / TL["bpm"]; BAR = 4 * BEAT; S16 = BEAT / 4
rng = np.random.default_rng(7)
drums = np.zeros((N, 2)); music = np.zeros((N, 2)); sfx = np.zeros((N, 2)); send = np.zeros((N, 2)); delay = np.zeros((N, 2))


def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def tt(d): return np.arange(int(d * SR)) / SR
def ph(f): return 2 * np.pi * np.cumsum(f) / SR
def lp(x, f, o=2): return signal.sosfilt(signal.butter(o, min(f, 20000) / (SR / 2), output="sos"), x)
def hp(x, f, o=2): return signal.sosfilt(signal.butter(o, f / (SR / 2), btype="high", output="sos"), x)
def bp(x, a, b, o=2): return signal.sosfilt(signal.butter(o, [a / (SR / 2), b / (SR / 2)], btype="band", output="sos"), x)


def place(buf, x, t0, g=1.0, pan=0.0, rev=0.0, dly=0.0):
    i = int(round(t0 * SR))
    if i < 0: x = x[-i:]; i = 0
    if i >= N: return
    x = x[: N - i]
    if x.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
        st = np.stack([x * l, x * r], 1)
    else:
        st = x
    buf[i:i + len(st)] += st * g
    if rev: send[i:i + len(st)] += st * g * rev
    if dly: delay[i:i + len(st)] += st * g * dly


_c = {}
def cached(key, fn):
    if key not in _c: _c[key] = fn()
    return _c[key]


def bl_saw(f, n, phase=0.0, top=9000):
    """Band-limited sawtooth (additive), so the bright parts never alias."""
    t = np.arange(n) / SR
    K = max(1, int(top / f))
    k = np.arange(1, K + 1)[:, None]
    return (np.sin(2 * np.pi * f * k * t[None, :] + phase * k) / k).sum(0) * (2 / np.pi)


def bl_square(f, n, top=9000):
    t = np.arange(n) / SR
    K = max(1, int(top / f))
    k = np.arange(1, K + 1, 2)[:, None]
    return (np.sin(2 * np.pi * f * k * t[None, :]) / k).sum(0) * (4 / np.pi)


def amp_env(n, a, hold, rel, dec=None, sus=1.0):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    if dec: e = e * (sus + (1 - sus) * np.exp(-np.maximum(0, t - a) / dec))
    r = t > hold
    e[r] *= np.exp(-(t[r] - hold) / rel)
    return e


# ---------------- drums ----------------
def kick():
    def mk():
        t = tt(0.42)
        x = np.sin(ph(48 + 125 * np.exp(-t / 0.035))) * np.exp(-t / 0.24)
        x += hp(rng.standard_normal(len(t)), 3000) * np.exp(-t / 0.003) * 0.3
        return np.tanh(x * 1.6) * 0.9
    return cached("kick", mk)


def snare(v=1.0):
    def mk():
        t = tt(0.28)
        body = np.sin(ph(195 + 70 * np.exp(-t / 0.015))) * np.exp(-t / 0.05) * 0.55
        noise = bp(rng.standard_normal(len(t)), 1400, 8000) * np.exp(-t / 0.085) * 0.7
        clap = np.zeros_like(t)
        for o in (0.0, 0.009, 0.018):
            clap += (t >= o) * np.exp(-np.clip(t - o, 0, None) / 0.01)
        clap = bp(rng.standard_normal(len(t)), 900, 3000) * (clap * 0.5 + 0.4 * np.exp(-t / 0.06) * (t > 0.02)) * 0.45
        return np.tanh((body + noise + clap) * 1.3)
    return cached("snare", mk) * v


def hat(open_=False):
    def mk():
        d = 0.26 if open_ else 0.08
        t = tt(d)
        x = hp(rng.standard_normal(len(t)), 7800, 3) * np.exp(-t / (0.08 if open_ else 0.022))
        return x * 0.4 * np.minimum(1, t / 0.0008)
    return cached(("hat", open_), mk)


def shaker():
    def mk():
        t = tt(0.07)
        return bp(rng.standard_normal(len(t)), 5000, 11000) * np.minimum(1, t / 0.012) * np.exp(-t / 0.025) * 0.3
    return cached("shaker", mk)


def crash(g=1.0):
    def mk():
        t = tt(2.2)
        x = hp(rng.standard_normal(len(t)), 4200) * np.exp(-t / 0.55) * 0.35
        return np.stack([x, np.roll(x, 211)], 1)
    return cached("crash", mk) * g


# ---------------- tonal ----------------
def slapbass(m, d, pop=False):
    def mk():
        f = hz(m); n = int((d + 0.08) * SR); t = np.arange(n) / SR
        raw = bl_saw(f, n, top=6000) * 0.7 + 0.45 * np.sin(2 * np.pi * f * t)
        bright, dark = lp(raw, 3200 if pop else 1700), lp(raw, 280)
        fe = np.exp(-t / (0.035 if pop else 0.07))
        y = fe * bright + (1 - fe) * dark + 0.55 * np.sin(2 * np.pi * f * t)
        if pop: y += hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.004) * 0.35
        return np.tanh(y * amp_env(n, 0.002, d, 0.03, dec=0.18, sus=0.55) * 1.3) * 0.5
    return cached(("bass", m, round(d, 3), pop), mk)


def stab(notes, d=0.16, g=1.0):
    def mk():
        n = int((d + 0.12) * SR); t = np.arange(n) / SR
        x = np.zeros((n, 2))
        for j, m in enumerate(notes):
            for k, det in enumerate((-0.07, 0.07)):
                s = bl_saw(hz(m) * 2 ** (det / 12), n, phase=1.3 * j + k)
                x[:, k] += s; x[:, 1 - k] += 0.35 * s
        fe = np.exp(-t / 0.06)[:, None]
        y = fe * signal.sosfilt(signal.butter(2, 4200 / (SR / 2), output="sos"), x, axis=0) + (1 - fe) * signal.sosfilt(signal.butter(2, 900 / (SR / 2), output="sos"), x, axis=0)
        return y * amp_env(n, 0.004, d, 0.05, dec=0.12, sus=0.7)[:, None] * (0.16 / len(notes))
    return cached(("stab", tuple(notes), round(d, 3)), mk) * g


def pluck(m, d=0.25):
    def mk():
        n = int(d * SR); t = np.arange(n) / SR
        x = lp(bl_saw(hz(m), n), 3000) * 0.55 + np.sin(2 * np.pi * hz(m) * t) * 0.45
        return x * np.exp(-t / 0.07) * np.minimum(1, t / 0.002) * 0.16
    return cached(("pluck", m, d), mk)


def lead(m, d, g=1.0):
    def mk():
        n = int((d + 0.15) * SR); t = np.arange(n) / SR
        vib = 1 + 0.009 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) / 0.2, 0, 1)
        f = hz(m) * vib
        p = ph(f)
        K = int(7000 / hz(m))
        x = sum(np.sin(k * p) / k for k in range(1, K + 1)) * 0.55 + sum(np.sin(k * p) / k for k in range(1, K + 1, 2)) * 0.35
        x = lp(x, 4600)
        return x * amp_env(n, 0.006, d, 0.07, dec=0.25, sus=0.75) * 0.22
    return cached(("lead", m, round(d, 3)), mk) * g


def pad(notes, d, cutoff=1500, atk=0.4, g=1.0):
    n = int(d * SR); t = np.arange(n) / SR
    x = np.zeros((n, 2))
    for j, m in enumerate(notes):
        for k, det in enumerate((-0.1, 0.0, 0.1)):
            s = bl_saw(hz(m) * 2 ** (det / 12), n, phase=0.7 * j + k, top=5000)
            x[:, k % 2] += s; x[:, (k + 1) % 2] += 0.5 * s
    x = signal.sosfilt(signal.butter(2, cutoff / (SR / 2), output="sos"), x, axis=0)
    e = np.minimum(1, t / atk) * np.minimum(1, (d - t) / 0.3)
    return x * e[:, None] * (0.05 / len(notes)) * g


def bell(m, d=1.0, g=1.0):
    t = tt(d); f = hz(m)
    x = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.12) + 0.2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / 0.04))
    return x * np.exp(-t / (d / 3.2)) * np.minimum(1, t / 0.002) * 0.16 * g


def blip(f0, f1, d=0.07, g=0.3):
    t = tt(d)
    return np.sin(ph(f0 + (f1 - f0) * t / d)) * np.exp(-t / (d / 3)) * np.minimum(1, t / 0.002) * g


def click():
    t = tt(0.06)
    return bp(rng.standard_normal(len(t)), 1800, 6500) * np.exp(-t / 0.005) * 0.45 + np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.018) * 0.35


def svf_band(x, fc, q=0.8):
    low = band = 0.0; out = np.empty_like(x); fk = 2 * np.sin(np.pi * np.minimum(fc, SR / 6) / SR)
    for i in range(len(x)):
        high = x[i] - low - q * band; band += fk[i] * high; low += fk[i] * band; out[i] = band
    return out


def whoosh(d=0.55, peak=0.32, lo=300, hi=4200, pan_from=0.7, pan_to=-0.7):
    t = tt(d)
    fc = lo + (hi - lo) * np.exp(-((t - peak) / 0.12) ** 2)
    x = svf_band(rng.standard_normal(len(t)), fc, 0.7)
    x *= np.where(t < peak, (t / peak) ** 2.2, np.exp(-(t - peak) / 0.11)) * 0.5
    p = np.linspace(pan_from, pan_to, len(t))
    return np.stack([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)], 1) * 1.414


def impact(big=False):
    d = 1.6 if big else 0.55; t = tt(d)
    sub = np.sin(ph(32 + (75 if big else 55) * np.exp(-t / (0.16 if big else 0.07)))) * np.exp(-t / (0.8 if big else 0.2))
    burst = hp(rng.standard_normal(len(t)), 1300) * np.exp(-t / (0.18 if big else 0.05)) * (0.4 if big else 0.22)
    return np.tanh((sub * 1.1 + burst) * 1.3)


def riser(d, f0=180, f1=2400, g=1.0):
    t = tt(d); u = t / d
    f = f0 * (f1 / f0) ** u
    x = np.sin(ph(f)) * 0.25 + np.sin(ph(f * 1.5)) * 0.12 + hp(rng.standard_normal(len(t)), 2000) * 0.35 * u ** 2
    return x * u ** 2.2 * g


def heartbeat(g):
    t = tt(0.3)
    x = np.sin(ph(40 + 32 * np.exp(-t / 0.05))) * np.exp(-t / 0.07) * np.minimum(1, t / 0.004)
    x += lp(rng.standard_normal(len(t)), 300) * np.exp(-t / 0.02) * 0.3
    return np.tanh(x * 1.6) * g


def buzz():
    t = tt(0.28)
    x = np.sign(np.sin(2 * np.pi * 160 * t)) * 0.5 + np.sin(2 * np.pi * 160 * t) * 0.5
    return lp(x, 900) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 22 * t))) * np.minimum(1, t / 0.01) * np.minimum(1, (0.28 - t) / 0.03) * 0.12


# ---------------- harmony ----------------
VO = {  # stab voicing, bass root
    "F": ([60, 65, 69, 72], 41), "Eb": ([58, 63, 67, 70], 39), "Bb": ([58, 62, 65, 70], 34),
    "C": ([60, 64, 67, 72], 36), "Dm": ([62, 65, 69, 74], 38), "Csus": ([60, 65, 67, 72], 36),
}
BARS = []  # (start, chord, section)
for k, c in enumerate(["F", "Eb", "Bb", "F", "F", "Eb", "Bb"]): BARS.append((4.0 + 2 * k, c, "A"))
for k, c in enumerate(["Bb", "C", "Dm", "C", "Bb", "C", "Dm", "C"]): BARS.append((18.0 + 2 * k, c, "B"))
BARS += [(34.0, "Bb", "break"), (36.0, "Csus", "build"), (38.0, "F", "cta"), (40.0, "Eb", "cta"), (42.0, "Bb", "cta"), (44.0, "F", "end")]
MOTIF = [(72, 0.0, 0.25), (77, 0.25, 0.25), (79, 0.5, 0.25), (81, 0.75, 1.0)]

# 0 – 2 s · dark intro into the bloom
B0 = A["bloom"]
t = tt(B0)
drone = (np.sin(2 * np.pi * 43.65 * t) + 0.6 * np.sin(2 * np.pi * 65.4 * t + 0.4) + 0.25 * np.sin(2 * np.pi * 87.3 * t)) * (0.85 + 0.15 * np.sin(2 * np.pi * 0.5 * t))
place(sfx, (drone * 0.4 + lp(rng.standard_normal(len(t)), 260) * 0.5) * (0.2 + 0.6 * (t / B0) ** 1.5), 0, 0.55)
for i, b in enumerate(A["heartbeats"]):
    g = 0.65 + 0.55 * i / (len(A["heartbeats"]) - 1)
    place(sfx, heartbeat(g), b, 0.9); place(sfx, heartbeat(g * 0.6), b + 0.13, 0.9)
place(sfx, riser(1.9, 160, 2600, 0.75), B0 - 1.9, rev=0.25)
for k, m in enumerate((65, 72, 77, 81, 84)):
    tb = tt(1.8)
    place(sfx, np.sin(2 * np.pi * hz(m) * tb) * (tb / 1.8) ** 3 * 0.07, B0 - 1.8, 1.0, pan=-0.6 + 0.3 * k, rev=0.7)
rs = hp(rng.standard_normal(int(0.8 * SR)), 3200) * np.linspace(0, 1, int(0.8 * SR)) ** 3 * 0.45
place(sfx, rs, B0 - 0.8, 0.8)

# 2 s · the bloom: impact, crash, long stab, the signature on the lead
place(sfx, impact(True), B0, 0.95)
place(drums, crash(1.0), B0, 0.7, rev=0.2)
place(music, stab(VO["F"][0], 1.3), B0, 1.3, rev=0.35)
for m, o, d in MOTIF:
    place(music, lead(m, d), TL["motif"][0] + o, 1.0, 0.1, rev=0.3, dly=0.35)
place(music, slapbass(41, 0.9), B0, 1.0)
place(music, slapbass(53, 0.2, True), B0 + 0.75, 0.9)
place(music, slapbass(41, 0.4), B0 + 1.0, 1.0)
place(music, slapbass(48, 0.2, True), B0 + 1.5, 0.9)
place(music, slapbass(51, 0.2, True), B0 + 1.75, 0.9)
kicks = []
for o in (0.0, 1.0, 1.5):
    place(drums, kick(), B0 + o, 1.0); kicks.append(B0 + o)
for k in range(8):
    place(drums, hat(), B0 + 0.5 + k * 0.25 / 1, 0.3 + 0.05 * k, 0.25)
for k in range(8):  # pickup roll into the groove
    place(drums, snare(0.15 + 0.08 * k), B0 + 1.5 + k * S16, 1.0, 0.05)

# 4 – 38 s · groove, then break and build; 38 – 45 s · the drop on the call to action
KICK = {"A": [[0, 7, 10], [0, 3, 8, 10]], "B": [[0, 7, 10], [0, 3, 8, 10, 13]], "cta": [[0, 7, 10], [0, 3, 8, 10, 13]]}
BASS = [(0, 0, 2, False), (3, 12, 1, True), (6, 0, 1, False), (7, 0, 1, False), (10, 0, 2, False), (11, 12, 1, True), (14, 7, 2, False)]
MEL = {
    "Bb": [(0, 77, 2), (3, 74, 1), (4, 77, 2), (6, 79, 2), (10, 77, 2), (12, 74, 3)],
    "C": [(0, 76, 2), (3, 72, 1), (4, 76, 2), (6, 79, 3), (10, 76, 2), (12, 72, 3)],
    "Dm": [(0, 77, 2), (3, 74, 1), (4, 77, 2), (6, 81, 3), (10, 79, 2), (12, 77, 2), (14, 76, 2)],
    "C2": [(0, 72, 1), (2, 77, 1), (4, 79, 1), (6, 81, 7)],
}
for bi, (s, c, sec) in enumerate(BARS):
    vo, root = VO[c]
    sw = lambda k: s + k * S16 + (0.018 if k % 2 else 0.0)        # swing on odd 16ths
    if sec in ("A", "B", "cta"):
        for k in KICK[sec][bi % 2]:
            place(drums, kick(), s + k * S16, 1.0); kicks.append(s + k * S16)
        for k in (4, 12): place(drums, snare(1.0), s + k * S16, 0.95, 0.05, rev=0.12)
        for k in ((2, 9, 14) if sec == "A" else (2, 6, 9, 14)): place(drums, snare(0.2), sw(k), 1.0, 0.1)
        for k in range(16):
            if k == 15 and (sec != "A" or bi % 2): place(drums, hat(True), sw(k), 0.45, 0.3); continue
            place(drums, hat(), sw(k), 0.5 if k % 2 == 0 else 0.3, 0.3 if k % 2 else -0.2)
        if sec != "A":
            for k in range(1, 16, 2): place(drums, shaker(), sw(k), 0.8, -0.4)
        for k, iv, ln, pop in BASS:
            place(music, slapbass(root + iv, ln * S16 * 0.9, pop), s + k * S16, 1.0, -0.05)
        for k in ((3, 10) if sec == "A" else (3, 10, 14)):
            place(music, stab(vo, 0.11 if k == 14 else 0.15), s + k * S16, 1.0 if sec == "A" else 1.1, 0.0, rev=0.15, dly=0.12)
        place(music, pad(vo, BAR + 0.05, 1300 if sec == "A" else 1700, 0.08), s, 4.5 if sec == "A" else 4.0, rev=0.25)   # glue under the groove
        arp = vo + vo[1:3][::-1]
        step = 2 if sec == "A" else 1
        for k in range(0, 16, step):
            place(music, pluck(arp[(k // step) % len(arp)] + 12), sw(k), 0.55 if sec == "A" else 0.45, 0.45 if (k // step) % 2 else -0.45, dly=0.3)
        if sec == "B":
            key = "C2" if (c == "C" and (bi % 4) == 3) else c
            for k, m, ln in MEL[key]:
                place(music, lead(m, ln * S16 * 0.92, 0.9), s + k * S16, 1.0, 0.1, rev=0.25, dly=0.25)
                if s >= 26.0: place(music, lead(m - 12, ln * S16 * 0.92, 0.45), s + k * S16, 1.0, -0.15)
    elif sec == "break":  # 34–36: air before the build
        for k in (0, 8): place(drums, kick(), s + k * S16, 0.9); kicks.append(s + k * S16)
        for k in range(0, 16, 2): place(drums, hat(), sw(k), 0.3, 0.2)
        place(music, slapbass(root, 1.8), s, 0.9)
        place(music, pad(vo, 2.1, 1400, 0.2), s, 3.5, rev=0.3)
    elif sec == "build":  # 36–38: snare roll, riser, a breath at 37.875
        place(music, pad(vo, 1.9, 1100, 1.2), s, 4.0, rev=0.3)
        place(music, slapbass(root, 1.8), s, 0.8)
        for k in (0, 4, 8): place(drums, kick(), s + k * S16, 0.85); kicks.append(s + k * S16)
        x = s
        while x < s + 1.875 - 1e-6:
            u = (x - s) / 1.875
            place(drums, snare(0.12 + 0.5 * u), x, 1.0, 0.05)
            x += 0.25 if u < 0.25 else (0.125 if u < 0.6 else 0.0625)
        place(sfx, riser(1.8, 200, 3200, 0.7), s, rev=0.2)
    elif sec == "end":   # 44: final stab rings out
        place(drums, kick(), s, 1.0); kicks.append(s)
        place(drums, crash(1.0), s, 0.65, rev=0.25)
        place(music, stab(vo, 0.9), s, 1.25, rev=0.4)
        place(music, slapbass(root, 0.9), s, 1.0)
        for k, m in enumerate((84, 89, 91, 93)):
            place(sfx, bell(m, 1.4, 0.8), s + 0.25 + 0.12 * k, 0.6, -0.3 + 0.2 * k, rev=0.6)

# the signature again, on linkrapp.com
M2 = TL["motif"][1]
for m, o, d in MOTIF:
    place(music, lead(m, d), M2 + o, 1.1, 0.1, rev=0.3, dly=0.35)
    place(music, lead(m + 12, d, 0.35), M2 + o, 1.0, -0.1, rev=0.3)
place(drums, crash(1.0), 38.0, 0.7, rev=0.2)
place(sfx, impact(True), 38.0, 0.75)

# cuts: whooshes on whip pans and the wipe, a soft hit on zooms, crashes on bar-level cuts
for T, kind in TL["cuts"].items():
    T = float(T)
    if kind == "whipL": place(sfx, whoosh(), T - 0.32, 0.8, rev=0.15)
    elif kind == "whipU": place(sfx, whoosh(0.55, 0.32, 400, 5200, 0.0, 0.0), T - 0.32, 0.8, rev=0.15)
    elif kind == "wipe": place(sfx, whoosh(0.8, 0.45, 220, 3200, -0.8, 0.8), T - 0.45, 1.0, rev=0.2); place(sfx, impact(False), T, 0.35)
    elif kind == "zoom" and T != 38.0: place(sfx, riser(0.32, 500, 2600, 0.45), T - 0.32); place(sfx, impact(False), T, 0.35)
    if T in (17.0, 21.5, 25.5, 29.5, 32.5): place(drums, crash(0.6), T, 0.5)

# picture events
P = lambda x, f0, f1, g=0.28, pan=0.0: place(sfx, blip(f0, f1, 0.07, g), x, 0.9, pan, rev=0.15)
for i, z in enumerate(A["logoZones"]): P(z, 1300 + 80 * i, 2000 + 80 * i, 0.18, -0.5 + 0.2 * i)
for i, b in enumerate(A["beats"]): P(b, 900 + 120 * i, 1500 + 120 * i, 0.22, -0.4 + 0.27 * i)
for i in range(6): P(A["zones"] + 0.1 * i, 1100 + 90 * i, 1800 + 90 * i, 0.22, -0.5 + 0.2 * i)
x = A["sonar"]
while x < SC["proximity"][1] - 0.4:
    place(sfx, bell(93, 0.8, 0.5), x, 0.6, 0.2, rev=0.5); x += 1.0
c0, c1 = A["counter"]
for k in range(12): P(c0 + (c1 - c0) * (k / 11) ** 0.7, 2300, 2500, 0.12, 0.3)
for k in range(5): place(sfx, bell((84, 86, 88, 91, 93)[k], 0.5, 0.9), A["stars"] + 0.07 * k, 0.6, -0.4 + 0.2 * k, rev=0.3)
place(sfx, whoosh(0.35, 0.2, 800, 4000, 0.6, -0.2), A["review"] - 0.18, 0.35)
taps = [A["request"], A["sortTap"], A["acceptTap"], *A["proTaps"], A["roleTap"], *A["clicks"]]
for x in taps: place(sfx, click(), x, 0.9, 0.1)
for x, ms in ((A["sent"] + 0.2, (77, 81, 84)), (A["acceptTap"] + 0.2, (77, 81, 84)), (A["paid"], (81, 84, 89))):
    for k, m in enumerate(ms): place(sfx, bell(m + 12, 0.9, 1.0), x + 0.07 * k, 0.6, 0.2, rev=0.35)
for i, q in enumerate(A["quotes"]): P(q + 0.05, 1200 + 150 * i, 1900 + 150 * i, 0.25, 0.4)
place(sfx, whoosh(0.45, 0.25, 500, 3000, 0.3, -0.3), A["reorder"] - 0.1, 0.4)
place(sfx, bell(96, 0.6, 0.9), A["best"], 0.55, 0.3, rev=0.3)
for i, c in enumerate(A["checks"]): place(sfx, bell((84, 88, 91)[i], 0.7, 1.0), c, 0.65, -0.3 + 0.3 * i, rev=0.3)
for a0 in (A["checks"][0] + 0.05, A["checks"][2] + 0.05):
    for k in range(8): P(a0 + 0.4 * (k / 7) ** 0.7, 2400, 2600, 0.1, 0.2)
for k in range(10): P(A["fee"][0] + 0.4 * (k / 9) ** 0.7, 2200, 2400, 0.1, 0.2)
place(sfx, bell(88, 0.5, 1.0), A["toast"] + 0.1, 0.6, 0.5, rev=0.3); place(sfx, bell(93, 0.6, 0.9), A["toast"] + 0.19, 0.55, 0.5, rev=0.3)
place(sfx, bell(91, 0.5, 0.8), A["feePulse"], 0.5, 0.0, rev=0.3)
for x in A["mails"]:
    place(sfx, buzz(), x - 0.02, 0.9, -0.2)
    place(sfx, bell(88, 0.5, 1.0), x + 0.05, 0.6, -0.3, rev=0.3); place(sfx, bell(93, 0.6, 0.9), x + 0.14, 0.55, -0.3, rev=0.3)
place(sfx, whoosh(0.45, 0.22, 600, 5000, -0.4, 0.4), A["flip"] - 0.12, 0.6)
for i, x in enumerate(A["stamps"]): place(sfx, impact(False)[: int(0.3 * SR)], x, 0.45); place(sfx, click(), x, 0.6)
for k in range(12): P(A["url"] + 0.05 * k + 0.08, 1500 + 70 * k, 1900 + 70 * k, 0.12, -0.5 + k / 11)
place(sfx, whoosh(0.4, 0.25, 700, 4500, -0.5, 0.5), A["urlUnderline"] - 0.15, 0.45)
PENTA = [84, 86, 89, 91, 93, 96]
for k in range(9): place(sfx, bell(PENTA[(k * 2) % 6], 0.9, 0.5), A["sparks"] + 0.06 * k, 0.4, float(rng.uniform(-0.6, 0.6)), rev=0.5)
for x in A["clicks"]: place(sfx, bell(96, 0.5, 0.6), x + 0.05, 0.4, 0.3, rev=0.3)

# ---------------- mix ----------------
duck = np.ones(N); tk = np.arange(int(0.22 * SR)) / SR
for kb in kicks:
    i = int(kb * SR); seg = duck[i:i + len(tk)]; seg *= 1 - 0.4 * np.exp(-tk / 0.08)[: len(seg)]
music *= duck[:, None]
# dotted-eighth echo (0.375 s), two repeats, darker each time
dl = int(0.375 * SR); echo = np.zeros_like(delay)
echo[dl:] += delay[:-dl] * 0.45; echo[2 * dl:] += delay[:-2 * dl] * 0.2
echo = signal.sosfilt(signal.butter(2, 3500 / (SR / 2), output="sos"), echo, axis=0)
echo = echo[:, ::-1]  # ping-pong feel
ir_t = tt(2.2)
ir = np.stack([rng.standard_normal(len(ir_t)), rng.standard_normal(len(ir_t))], 1) * np.exp(-ir_t / 0.5)[:, None]
ir[: int(0.01 * SR)] = 0
ir = signal.sosfilt(signal.butter(2, 5000 / (SR / 2), output="sos"), ir, axis=0); ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([signal.fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1)
mix = drums * 0.8 + music * 0.95 + echo * 0.5 + sfx * 0.9 + wet * 0.4
mix = signal.sosfilt(signal.butter(1, 30 / (SR / 2), btype="high", output="sos"), mix, axis=0)
fade = int(0.5 * SR); mix[-fade:] *= (np.linspace(1, 0, fade) ** 1.6)[:, None]
print('pre-master peak', round(float(np.max(np.abs(mix))),2), 'rms', round(float(np.sqrt((mix**2).mean())),3))
mix /= np.percentile(np.abs(mix), 99.95)          # a few transients only reach the soft clip
mix = np.tanh(mix * 1.1) / 1.1
mix /= np.max(np.abs(mix)) * 1.03
(ROOT / "audio").mkdir(exist_ok=True)
wavfile.write(ROOT / "audio" / "soundtrack.wav", SR, (mix * 32767).astype(np.int16))
print("wrote soundtrack.wav", DUR, "s")
