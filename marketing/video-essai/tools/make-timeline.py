"""Shared timeline for picture and sound (v2, dynamic cut). Writes ../timeline.json."""
import json, pathlib
cuts = [3.0, 7.0, 10.0, 13.0, 15.5, 18.0, 20.5, 23.5, 26.0, 28.5, 31.0, 33.0, 35.0, 37.5, 40.0, 44.0]
tl = {
  "fps": 30, "duration": 50.0,
  "heartbeats": [0.3, 1.05, 1.65, 2.15, 2.55],
  "bloom": 3.0,
  "cuts": cuts,
  # whoosh starts ~0.28 s before each cut (3.0 is a riser + bloom, 10.0 is the dive)
  "whooshes": [round(c - 0.28, 2) for c in cuts if c not in (3.0, 44.0)],
  "impacts": cuts,
  "hits": [7.1, 7.35, 7.55, 8.6, 9.23],
  "taps": [10.45, 14.85, 19.75, 22.1, 22.75, 24.9, 26.85, 27.7, 28.1, 38.55],
  "typing": [round(18.35 + i * 0.04, 3) for i in range(22)],
  "ticks": [round(10.7 + i * 0.09, 3) for i in range(8)] + [12.1],
  "dings": [19.3, 19.95, 24.35, 25.25, 31.3, 31.6, 31.9],
  "stamp": [32.3],
  "stars": [round(29.0 + i * 0.08, 3) for i in range(5)],
  "counter": [28.9, 29.55],
  "notifs": [26.2, 35.4, 35.75, 36.1],
  "flip": [38.6],
  "lights": [round(40.35 + i * 0.08, 3) for i in range(9)] + [round(42.0 + i * 0.16, 3) for i in range(10)],
  "url": [44.7],
  "logopins": [round(5.1 + i * 0.11, 3) for i in range(7)],
}
pathlib.Path(__file__).resolve().parent.parent.joinpath("timeline.json").write_text(json.dumps(tl, indent=1))
print(len(tl["whooshes"]), "whooshes")
