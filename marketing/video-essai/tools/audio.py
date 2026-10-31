"""Procedural, royalty-free soundtrack for the Linkr trial video.

Everything is synthesised here (no samples): heartbeat, drone, risers, whooshes,
impacts, UI blips and a 120 BPM track whose bars land on the picture cuts.
Reads ../timeline.json, writes ../audio/soundtrack.wav (48 kHz stereo, not normalised;
ffmpeg loudnorm does the final -14 LUFS pass).
"""
import json, pathlib
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TL = json.loads((ROOT / "timeline.json").read_text())
SR = 48000
DUR = TL["duration"]
N = int(SR * DUR)
rng = np.random.default_rng(42)

music = np.zeros((N, 2))
sfx = np.zeros((N, 2))
send = np.zeros((N, 2))  # reverb send


def tt(d):
    return np.arange(int(d * SR)) / SR


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def sos(kind, f, order=2):
    if kind == "bp":
        return signal.butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], btype="band", output="sos")
    return signal.butter(order, f / (SR / 2), btype=kind, output="sos")


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x)


def place(buf, x, t0, g=1.0, pan=0.0):
    i = int(round(t0 * SR))
    if i >= len(buf):
        return
    if i < 0:
        x = x[-i:]; i = 0
    x = x[: len(buf) - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    if x.ndim == 1:
        buf[i : i + len(x), 0] += x * g * l * 1.414
        buf[i : i + len(x), 1] += x * g * r * 1.414
    else:
        buf[i : i + len(x)] += x * g


def phase(freq_curve):
    return 2 * np.pi * np.cumsum(freq_curve) / SR


def saw(f, d):
    t = tt(d)
    return 2 * ((t * f) % 1.0) - 1


def adsr(n, a=0.005, d=0.1, s=0.0, r=0.05, hold=None):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    if hold is not None:
        rel = t > hold
        e[rel] *= np.exp(-(t[rel] - hold) / r)
    return e


# ---------------- instruments ----------------
def kick(g=1.0):
    t = tt(0.45)
    f = 45 + 110 * np.exp(-t / 0.045)
    x = np.sin(phase(f)) * np.exp(-t / 0.28)
    click = filt(rng.standard_normal(len(t)), "hp", 2500) * np.exp(-t / 0.004) * 0.25
    return (x + click) * g


def clap():
    t = tt(0.3)
    n = filt(rng.standard_normal(len(t)), "bp", (900, 2600))
    e = np.zeros_like(t)
    for o in (0.0, 0.011, 0.022):
        e += (t >= o) * np.exp(-np.clip(t - o, 0, None) / (0.012 if o < 0.02 else 0.11))
    return n * e * 0.5


def hat(open_=False):
    d = 0.22 if open_ else 0.06
    t = tt(d)
    n = filt(rng.standard_normal(len(t)), "hp", 7500)
    return n * np.exp(-t / (0.07 if open_ else 0.018)) * 0.35


def snare():
    t = tt(0.25)
    body = np.sin(phase(180 + 60 * np.exp(-t / 0.02))) * np.exp(-t / 0.06) * 0.5
    n = filt(rng.standard_normal(len(t)), "bp", (1500, 7000)) * np.exp(-t / 0.08) * 0.6
    return body + n


def bass_note(m, d):
    t = tt(d)
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * filt(saw(f, d), "lp", 420)
    return x * adsr(len(t), 0.004, 0.22, 0.25, 0.04, hold=d - 0.05) * 0.55


def pad_chord(ms, d, cutoff=1400, atk=0.35):
    t = tt(d)
    x = np.zeros((len(t), 2))
    for m in ms:
        for k, det in enumerate((-0.09, 0.0, 0.08)):
            s = saw(hz(m) * 2 ** (det / 12), d)
            x[:, k % 2] += s
            x[:, (k + 1) % 2] += s * 0.4
    x = signal.sosfilt(sos("lp", cutoff, 2), x, axis=0)
    e = np.minimum(1, t / atk) * np.minimum(1, (d - t) / 0.4)
    return x * e[:, None] * (0.07 / len(ms))


def pluck(m, d=0.3):
    t = tt(d)
    f = hz(m)
    x = filt(saw(f, d), "lp", 2600) * 0.6 + np.sin(2 * np.pi * f * t) * 0.4
    return x * np.exp(-t / 0.09) * 0.22


def bell(m, d=1.2, g=1.0):
    t = tt(d)
    f = hz(m)
    x = (np.sin(2 * np.pi * f * t) + 0.45 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.15)
         + 0.25 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / 0.05))
    return x * np.exp(-t / (d / 3.2)) * np.minimum(1, t / 0.002) * 0.18 * g


def svf_band(x, fc, q=0.9):
    """Time-varying state-variable band-pass (fc: array of Hz per sample)."""
    low = band = 0.0
    out = np.empty_like(x)
    fk = 2 * np.sin(np.pi * np.minimum(fc, SR / 6) / SR)
    for i in range(len(x)):
        f = fk[i]
        high = x[i] - low - q * band
        band += f * high
        low += f * band
        out[i] = band
    return out


def whoosh(d=0.6, peak=0.32, lo=250, hi=3800):
    t = tt(d)
    n = rng.standard_normal(len(t))
    fc = lo + (hi - lo) * np.exp(-((t - peak) / 0.13) ** 2)
    out = svf_band(n, fc, 0.7)
    env = np.where(t < peak, (t / peak) ** 2.2, np.exp(-(t - peak) / 0.12))
    return out * env * 0.5


def impact(big=False):
    d = 1.6 if big else 0.6
    t = tt(d)
    sub = np.sin(phase(28 + (70 if big else 50) * np.exp(-t / (0.18 if big else 0.08)))) * np.exp(-t / (0.85 if big else 0.22))
    burst = filt(rng.standard_normal(len(t)), "hp", 1200) * np.exp(-t / (0.22 if big else 0.06)) * (0.45 if big else 0.25)
    mid = filt(saw(98, d), "lp", 900) * np.exp(-t / 0.18) * (0.35 if big else 0.15)
    return np.tanh((sub * 1.1 + burst + mid) * 1.3)


def riser(d, f0=180, f1=1500, g=1.0):
    t = tt(d)
    u = t / d
    f = f0 * (f1 / f0) ** u
    tone = np.sin(phase(f)) * 0.3 + np.sin(phase(f * 1.5)) * 0.15
    n = filt(rng.standard_normal(len(t)), "hp", 1800) * 0.4 * u ** 2
    return (tone + n) * (u ** 2.2) * g


def heartbeat(g):
    t = tt(0.32)
    f = 38 + 30 * np.exp(-t / 0.05)
    x = np.sin(phase(f)) * np.exp(-t / 0.075) * np.minimum(1, t / 0.004)
    x += filt(rng.standard_normal(len(t)), "lp", 300) * np.exp(-t / 0.02) * 0.3
    return np.tanh(x * 1.6) * g


# ---------------- A · suspense 0–6.8 ----------------
cut = TL["black"][0]
t = tt(cut)
drone = (np.sin(2 * np.pi * 41.2 * t) + 0.6 * np.sin(2 * np.pi * 61.7 * t + 0.4) + 0.25 * np.sin(2 * np.pi * 82.4 * t)) * (0.75 + 0.25 * np.sin(2 * np.pi * 0.21 * t))
air = filt(rng.standard_normal(len(t)), "lp", 260) * 0.6
ramp = 0.12 + 0.55 * (t / cut) ** 1.6
dr = (drone * 0.45 + air) * ramp
dr[-int(0.008 * SR):] *= np.linspace(1, 0, int(0.008 * SR))
place(sfx, dr, 0, 0.55)
hb = TL["heartbeats"]
for i, b in enumerate(hb):
    g = 0.55 + 0.65 * i / (len(hb) - 1)
    place(sfx, heartbeat(g), b, 0.9)
    place(sfx, heartbeat(g * 0.68), b + 0.15, 0.9)
r = riser(cut - 4.3, 160, 1900, 0.55)
place(sfx, r, 4.3)
place(send, r, 4.3, 0.25)
# hard cut: nothing may ring past 6.8
sfx[int(cut * SR) : int(TL["black"][1] * SR)] = 0

# ---------------- B · reveal impact ----------------
place(sfx, impact(True), 7.0, 1.0)
for k, m in enumerate((84, 88, 91, 96, 100)):
    b = bell(m, 2.8, 0.9)
    place(sfx, b, 7.02 + k * 0.035, 0.7, pan=-0.5 + k * 0.25)
    place(send, b, 7.02 + k * 0.035, 0.8)

# ---------------- C · music ----------------
CH = {"Am": [57, 60, 64], "F": [53, 57, 60], "C": [55, 60, 64], "G": [55, 59, 62]}
ROOTS = {"Am": 33, "F": 29, "C": 36, "G": 31}
bars = [(7, "Am")] + [(8 + 2 * k, c) for k, c in enumerate(
    ["F", "G", "Am", "F", "C", "G", "Am", "F", "C", "G", "Am", "F", "C", "G", "Am", "F", "G", "G", "Am", "F", "C"])]
BEAT = 0.5


def chord_at(x):
    c = bars[0][1]
    for s, n in bars:
        if x >= s:
            c = n
    return c


def section(x):
    if x < 12: return "intro"
    if x < 36: return "groove"
    if x < 38: return "build"
    if x < 44: return "ambient"
    return "outro"


# pads
for (s, c), nxt in zip(bars, bars[1:] + [(50.0, None)]):
    d = nxt[0] - s
    sec = section(s)
    cutoff = {"intro": 900, "groove": 1500, "build": 1500, "ambient": 1100, "outro": 1800}[sec]
    if s == 36:
        x = pad_chord(CH[c], d + 0.3, 1500)
        x = signal.sosfilt(sos("lp", 4000, 1), x, axis=0)
    elif s >= 48:
        x = pad_chord(CH[c] + [CH[c][0] + 12], 2.0, 2200, 0.05)
    else:
        x = pad_chord(CH[c], d + 0.35, cutoff, 0.6 if sec in ("intro", "ambient") else 0.25)
    gain = {"intro": 1.7, "groove": 0.8, "build": 1.0, "ambient": 1.7, "outro": 1.0}[sec]
    place(music, x, s, gain)
    place(send, x, s, 0.5)

# drums, bass, arp on the beat grid
kicks = []
b = 8.0
while b < 50 - 1e-6:
    sec = section(b)
    beat_in_bar = int(round((b - 8) / BEAT)) % 4
    if sec in ("groove", "build") and b >= 12 or (sec == "outro" and b < 48):
        place(music, kick(), b, 0.95); kicks.append(b)
        if beat_in_bar in (1, 3):
            place(music, clap(), b, 0.8, 0.05); place(send, clap(), b, 0.15)
    if b >= 10 and sec in ("intro", "groove", "build") or (sec == "outro" and b < 48):
        place(music, hat(), b + BEAT / 2, 0.55 if sec != "intro" else 0.3 * (b - 10) / 2, 0.3)
        if sec != "intro":
            place(music, hat(), b + BEAT / 4, 0.25, -0.3); place(music, hat(), b + 3 * BEAT / 4, 0.25, -0.3)
    c = chord_at(b)
    if sec in ("groove", "build") and b >= 12 or (sec == "outro" and b < 48):
        for h in (0, BEAT / 2):
            place(music, bass_note(ROOTS[c] + 12, BEAT / 2 - 0.02), b + h, 0.9)
    elif sec in ("intro", "ambient"):
        if beat_in_bar == 0:
            place(music, bass_note(ROOTS[c], 1.9), b, 0.75)
    if sec in ("groove", "build", "intro", "outro") and b < 48:
        notes = CH[c] + [CH[c][0] + 12]
        for k in range(2):
            m = notes[(int(round((b - 8) / (BEAT / 2))) + k) % 4] + 12
            x = pluck(m)
            g = 0.65 if sec == "intro" else 0.75
            place(music, x, b + k * BEAT / 2, g, pan=-0.4 if k else 0.4)
            place(music, x, b + k * BEAT / 2 + 0.375, g * 0.35, pan=0.6 if k else -0.6)  # dotted-eighth echo
    b += BEAT

# intro pulse (half-time kicks) + a swell into the 12 s drop
for kb in (8.0, 9.0, 10.0, 10.75, 11.0, 11.5):
    place(music, kick(0.75), kb); kicks.append(kb)
place(sfx, riser(1.4, 200, 1800, 0.45), 10.6)


def crash():
    t = tt(1.6)
    n = filt(rng.standard_normal(len(t)), "hp", 4500)
    return n * np.exp(-t / 0.45) * 0.4


# fills + crash on every feature cut: each scene relaunches attention
for c in (12.0, 18.0, 22.0, 26.0, 30.0, 34.0, 44.0):
    place(music, crash(), c, 0.55, 0.2); place(send, crash(), c, 0.2)
    if c in (22.0, 26.0, 30.0, 34.0):
        for k, o in enumerate((0.5, 0.375, 0.25, 0.125)):
            place(music, snare(), c - o, 0.22 + 0.1 * k)

# build 36–38: snare roll + riser
t0 = 36.0
k = 0
while t0 < 38 - 1e-6:
    step = 0.125 if t0 < 37 else 0.0625
    place(music, snare(), t0, 0.15 + 0.5 * (t0 - 36) / 2)
    t0 += step
place(sfx, riser(2.0, 220, 2400, 0.7), 36.0)
place(sfx, riser(1.5, 160, 2000, 0.55), 42.5)
place(sfx, riser(0.9, 300, 3000, 0.35), 17.1)

# final chord ring-out
for m in (69, 72, 76, 81):
    place(send, bell(m, 2.5, 0.6), 48.0, 0.6)

# sidechain duck on music from kicks
duck = np.ones(N)
tk = np.arange(int(0.25 * SR)) / SR
for kb in kicks:
    i = int(kb * SR)
    seg = duck[i : i + len(tk)]
    seg *= 1 - 0.45 * np.exp(-tk / 0.09)[: len(seg)]
music *= duck[:, None]

# ---------------- SFX on picture events ----------------
for i, w in enumerate(TL["whooshes"]):
    x = whoosh()
    n = len(x)
    pan = np.linspace(0.7, -0.7, n)
    st = np.stack([x * np.cos((pan + 1) * np.pi / 4), x * np.sin((pan + 1) * np.pi / 4)], axis=1) * 1.4
    place(sfx, st, w, 0.75)
    place(send, st, w, 0.25)
for c in TL["impacts"]:
    if c in (7.0, 44.0):
        continue
    place(sfx, impact(False), c, 0.55)
place(sfx, impact(True), 44.0, 0.95)
for k, m in enumerate((81, 84, 88, 93)):
    place(send, bell(m, 2.4, 0.8), 44.02 + k * 0.04, 0.9)
for h in TL["hits"]:
    place(sfx, impact(False)[: int(0.35 * SR)], h, 0.6)
for i, x0 in enumerate(TL["ticks"]):
    tb = tt(0.09)
    f = 1100 + 900 * (tb / 0.09) + i * 40
    blip = np.sin(phase(f)) * np.exp(-tb / 0.03) * 0.35
    place(sfx, blip, x0, 0.8, pan=-0.3 + 0.08 * i)
for x0, m in zip(TL["dings"], (88, 91, 96, 91, 96)):
    bl = bell(m, 1.0, 1.4)
    place(sfx, bl, x0, 0.9); place(send, bl, x0, 0.5)
for x0 in TL["badge"]:
    for k, m in enumerate((84, 88, 91, 96)):
        place(sfx, bell(m, 0.9, 1.0), x0 + k * 0.05, 0.7, pan=-0.3 + 0.2 * k)
        place(send, bell(m, 0.9, 1.0), x0 + k * 0.05, 0.4)
for k, x0 in enumerate(TL["stars"]):
    place(sfx, bell((84, 86, 88, 91, 93)[k], 0.5, 1.0), x0, 0.6, pan=-0.4 + 0.2 * k)
for x0 in TL["toggle"]:
    tb = tt(0.12)
    click = filt(rng.standard_normal(len(tb)), "bp", (1500, 5000)) * np.exp(-tb / 0.01) * 0.6
    place(sfx, click, x0, 0.7)
    place(sfx, whoosh(0.3, 0.15, 800, 4000), x0 - 0.12, 0.35)
PENTA = [76, 79, 81, 84, 86, 88, 91, 93]
for k, x0 in enumerate(TL["lights"]):
    bl = bell(PENTA[(k * 3) % len(PENTA)], 1.6, 0.8)
    place(sfx, bl, x0, 0.55, pan=float(rng.uniform(-0.6, 0.6)))
    place(send, bl, x0, 0.6)
u = TL["url"][0]
for k in range(12):
    tb = tt(0.05)
    tick = np.sin(2 * np.pi * (1800 + 60 * k) * tb) * np.exp(-tb / 0.012) * 0.3
    place(sfx, tick, u + k * 0.032, 0.5, pan=-0.5 + k / 11)
place(sfx, riser(0.55, 400, 2400, 0.3), u - 0.05)

# ---------------- reverb + master ----------------
ir_t = tt(2.4)
ir = np.stack([rng.standard_normal(len(ir_t)), rng.standard_normal(len(ir_t))], axis=1) * np.exp(-ir_t / 0.55)[:, None]
ir = signal.sosfilt(sos("lp", 5000, 1), ir, axis=0)
ir /= np.sqrt((ir ** 2).sum(axis=0))
wet = np.stack([signal.fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], axis=1)

mix = music * 0.85 + sfx * 1.0 + wet * 0.45
mix[int(6.8 * SR) : int(7.0 * SR)] *= 0.0  # true silence before the reveal
fade = int(0.5 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
mix = np.tanh(mix * 0.9) / 0.9
mix /= np.max(np.abs(mix)) * 1.02
out = ROOT / "audio"
out.mkdir(exist_ok=True)
wavfile.write(out / "soundtrack.wav", SR, (mix * 32767).astype(np.int16))
print("wrote", out / "soundtrack.wav", f"{DUR}s", "peak ok")
