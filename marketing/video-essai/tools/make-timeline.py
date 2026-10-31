"""Shared timeline for picture and sound. Writes timeline.json next to index.html."""
import json, pathlib
hb, t, iv = [], 0.5, 1.05
while t < 6.7:
    hb.append(round(t, 3)); t += iv; iv = max(0.42, iv * 0.86)
tl = {
  "fps": 30, "duration": 50.0,
  "heartbeats": hb,
  "s1cut": 3.897,           # hard cut between the two suspense shots (on a beat)
  "black": [6.8, 7.0],     # silence + black before the reveal
  # whip / mask / iris transitions: (start of whoosh, cut)
  "whooshes": [11.55, 14.75, 17.45, 21.7, 25.7, 29.7, 33.7, 37.55, 43.55],
  "impacts": [7.0, 12.0, 18.0, 22.0, 26.0, 30.0, 34.0, 38.0, 44.0],
  "hits": [12.2, 12.6, 13.0, 15.45, 16.46],          # kinetic type slams
  "ticks": [round(18.7 + i * 0.12, 3) for i in range(8)] + [20.4],
  "dings": [23.1, 23.55, 24.0, 35.3, 36.8],
  "badge": [24.4, 36.9],
  "stars": [round(27.6 + i * 0.1, 3) for i in range(5)],
  "toggle": [31.8],
  "lights": [round(38.5 + i * 0.12, 3) for i in range(9)] + [round(41.2 + i * 0.22, 3) for i in range(10)],
  "url": [44.7],
}
pathlib.Path(__file__).resolve().parent.parent.joinpath("timeline.json").write_text(json.dumps(tl, indent=1))
print(hb)
