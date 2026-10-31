#!/usr/bin/env bash
# encode.sh <frames dir> <output.mp4> [crf]
set -euo pipefail
cd "$(dirname "$0")/.."
FR="$1"; OUT="$2"; CRF="${3:-18}"
mkdir -p "$(dirname "$OUT")"
ffmpeg -hide_banner -v error -y -framerate 30 -i "$FR/f%05d.jpg" -i audio/soundtrack.wav \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" \
  -c:v libx264 -profile:v high -preset slow -crf "$CRF" -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration,size -of compact "$OUT"
