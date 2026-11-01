"""Soundtrack v3 — piano and plucked strings, 100 BPM, royalty-free (fully synthesised here).

A 4-note signature motif (C5 F5 G5 A5) opens the video on the logo and returns on
linkrapp.com. No drums, no synth pads, no sound effects. Reads ../timeline.json (exported
from the CONFIG block of anim.js), writes ../audio/soundtrack.wav (48 kHz stereo).
"""
import json, pathlib
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TL = json.loads((ROOT / "timeline.json").read_text())
SR, DUR = 48000, TL["duration"]
N = int(SR * DUR)
BEAT = 60 / TL["bpm"]
rng = np.random.default_rng(3)
mix = np.zeros((N, 2)); send = np.zeros((N, 2))


def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def tt(d): return np.arange(int(d * SR)) / SR


def place(x, t0, g=1.0, pan=0.0, rev=0.3):
    i = int(round(t0 * SR))
    if i >= N: return
    x = x[: N - i]
    l, r = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
    mix[i:i + len(x), 0] += x * g * l; mix[i:i + len(x), 1] += x * g * r
    send[i:i + len(x), 0] += x * g * l * rev; send[i:i + len(x), 1] += x * g * r * rev


_cache = {}
def piano(m, dur, vel):
    key = ("p", m, round(dur, 2), round(vel, 2))
    if key in _cache: return _cache[key]
    f = hz(m); t = tt(dur + 1.2)
    T1 = float(np.clip(3.2 * (261.6 / f) ** 0.55, 0.5, 7.0))
    out = np.zeros_like(t)
    for n in range(1, 13):
        fn = n * f * np.sqrt(1 + 0.00038 * n * n)
        if fn > 15000: break
        a = (vel ** (1 + 0.18 * n)) / n ** 1.15
        Tn = T1 / (1 + 0.55 * (n - 1))
        env = 0.65 * np.exp(-t / (0.22 * Tn)) + 0.35 * np.exp(-t / Tn)
        ph = rng.uniform(0, 6.28)
        out += a * np.sin(2 * np.pi * fn * t + ph) * env
        if n <= 3:  # second string, slightly detuned: the gentle beating of a real piano
            out += 0.6 * a * np.sin(2 * np.pi * fn * 1.00045 * t + ph * 1.3) * env
    hammer = signal.sosfilt(signal.butter(2, 2500 / (SR / 2), output="sos"), rng.standard_normal(len(t))) * np.exp(-t / 0.004) * 0.06 * vel
    out = (out + hammer) * np.minimum(1, t / 0.0025)
    rel = t > dur
    out[rel] *= np.exp(-(t[rel] - dur) / 0.35)     # damper
    out *= 0.16
    _cache[key] = out
    return out


def ks(m, dur, vel, g=0.996, bright=4500, body=True):
    key = ("k", m, round(dur, 2), round(vel, 2), g, bright)
    if key in _cache: return _cache[key]
    f = hz(m); L = int(SR * dur); Nd = int(round(SR / f))
    x = np.zeros(L)
    burst = signal.sosfilt(signal.butter(2, min(bright * (0.5 + vel), 18000) / (SR / 2), output="sos"), rng.standard_normal(Nd))
    x[:Nd] = burst * vel
    a = np.zeros(Nd + 2); a[0] = 1; a[Nd] = -g / 2; a[Nd + 1] = -g / 2
    y = signal.lfilter([1.0], a, x)
    if body:  # small wooden body
        y = 0.7 * y + 0.5 * signal.sosfilt(signal.butter(2, [180 / (SR / 2), 1200 / (SR / 2)], btype="band", output="sos"), y)
    y = signal.sosfilt(signal.butter(2, 6500 / (SR / 2), output="sos"), y)   # soft strings, no fizz
    y *= np.exp(-tt(dur) / (dur * 0.45)) * np.minimum(1, tt(dur) / 0.003)      # no click on the attack
    y[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    y *= 0.32
    _cache[key] = y
    return y


CH = {  # bass, voicing
    "F": (41, [57, 60, 65, 67]), "C/E": (40, [55, 60, 64, 67]), "Dm7": (38, [57, 60, 62, 65]), "Bbmaj7": (34, [57, 62, 65, 69]),
    "Gm7": (43, [55, 58, 62, 65]), "C": (36, [55, 60, 64, 67]), "Am7": (45, [57, 60, 64, 67]), "Bbadd9": (34, [58, 62, 65, 72]),
    "Csus4": (36, [55, 60, 65, 67]),
}
M2 = TL["motif"][1]
PROG = [(0.0, "F"), (2.4, "C/E"), (4.8, "Dm7"), (7.2, "Bbmaj7"), (9.6, "F"), (12.0, "C/E"), (14.4, "Dm7"), (16.8, "Bbmaj7"),
        (19.2, "Gm7"), (21.6, "C"), (24.0, "Am7"), (26.4, "Dm7"), (28.8, "Gm7"), (31.2, "Bbmaj7"), (33.6, "C"),
        (36.0, "Bbadd9"), (38.4, "Csus4"), (M2, "F"), (42.0, "Bbmaj7"), (43.2, "F")]
SC = TL["scenes"]


def section(x):
    if x < SC["needs"][0]: return "open"
    if x < SC["quotes"][0]: return "flow"
    if x < SC["soon"][0]: return "lift"
    if x < SC["cta"][0]: return "hold"
    return "end"


def hum(v): return float(np.clip(v * rng.uniform(0.9, 1.08), 0.05, 1))


def pp(m): return float(np.clip((m - 60) / 30, -0.6, 0.6))   # pan by pitch, like a piano seen from the stool


# 1 · the signature motif (logo at 0.0, linkrapp.com later)
MOTIF = [(72, 0.0, 0.3), (77, 0.3, 0.3), (79, 0.6, 0.3), (81, 0.9, 1.6)]
for t0, v in ((TL["motif"][0], 0.78), (M2, 0.85)):
    for m, o, d in MOTIF:
        place(piano(m, d, hum(v)), t0 + o, 1.0, pp(m), 0.4)

# 2 · harmony, arrangement by section
for (s, c), nxt in zip(PROG, PROG[1:] + [(DUR, None)]):
    d = nxt[0] - s
    bass, vo = CH[c]
    sec = section(s)
    if sec in ("open", "hold", "end"):
        # rolled chord (low to high, 40 ms apart), held
        for k, m in enumerate([bass + 12] + vo):
            place(piano(m, d, hum(0.42 if sec == "open" else 0.5)), s + 0.04 * k, 1.0, pp(m), 0.45)
        if sec == "end" and s >= 43.2:
            for k, m in enumerate([84, 89, 91, 93]):          # gentle closing echo of the motif, an octave up
                place(piano(m, 1.4, hum(0.32)), s + 0.6 + 0.3 * k, 0.9, pp(m), 0.6)
    else:
        # left hand: bass on beat 1 (and beat 3 later on)
        place(piano(bass + 12, BEAT * 2, hum(0.5)), s, 1.0, -0.3, 0.35)
        if sec == "lift":
            place(piano(bass + 12, BEAT * 2, hum(0.42)), s + 2 * BEAT, 1.0, -0.3, 0.35)
        # right hand: flowing eighths through the voicing
        seq = vo + [vo[2], vo[1]] + vo[:2]
        n8 = int(round(d / (BEAT / 2)))
        for k in range(n8):
            m = seq[k % len(seq)] + 12
            place(piano(m, BEAT * 0.9, hum(0.34 if sec == "flow" else 0.4)), s + k * BEAT / 2, 1.0, pp(m), 0.35)
        # plucked strings: off-beats, then every eighth when the story lifts
        for k in range(n8):
            if sec == "flow" and k % 2 == 0: continue
            m = vo[(k * 3) % len(vo)] + 24
            place(ks(m, 0.7, hum(0.5)), s + k * BEAT / 2, 0.9 if k % 2 else 0.6, 0.35, 0.3)
        # plucked bass, beats 1 and 3
        for b in (0, 2):
            if s + b * BEAT < nxt[0]:
                place(ks(bass + 12, 1.3, hum(0.8), g=0.998, bright=900), s + b * BEAT, 1.2, -0.1, 0.15)
    # anticipation before the call to action: soft repeated plucks that swell
    if sec == "hold":
        for k in range(int(round(d / (BEAT / 2)))):
            m = vo[-1] + 12
            place(ks(m, 0.5, hum(0.25 + 0.5 * k / 10)), s + k * BEAT / 2, 0.8, 0.3, 0.35)

# 3 · a simple melody once the story lifts (quotes → pros)
MEL = {21.6: [72, 74, 76, 79], 24.0: [76, 74, 72, 69], 26.4: [74, 77, 76, 72], 28.8: [74, 72, 70, 74], 31.2: [77, 74, 76, 77], 33.6: [79, 76, 77, 79]}
for s, notes in MEL.items():
    for k, m in enumerate(notes):
        place(piano(m, BEAT * 0.95, hum(0.6)), s + k * BEAT, 1.0, pp(m), 0.4)
        place(ks(m + 12, 0.6, hum(0.35)), s + k * BEAT + 0.005, 0.5, 0.45, 0.4)   # doubled softly by the strings

# 4 · room: warm plate-like reverb
ir_t = tt(2.8)
ir = np.stack([rng.standard_normal(len(ir_t)), rng.standard_normal(len(ir_t))], 1) * np.exp(-ir_t / 0.7)[:, None]
ir[: int(0.012 * SR)] = 0
ir = signal.sosfilt(signal.butter(2, 5200 / (SR / 2), output="sos"), ir, axis=0)
ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([signal.fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1)
out = mix + wet * 0.55
out = signal.sosfilt(signal.butter(1, 35 / (SR / 2), btype="high", output="sos"), out, axis=0)
fade = int(0.45 * SR); out[-fade:] *= (np.linspace(1, 0, fade) ** 1.6)[:, None]
out = np.tanh(out * 1.2) / 1.2
out /= np.max(np.abs(out)) * 1.03
(ROOT / "audio").mkdir(exist_ok=True)
wavfile.write(ROOT / "audio" / "soundtrack.wav", SR, (out * 32767).astype(np.int16))
print("wrote soundtrack.wav", DUR, "s")
