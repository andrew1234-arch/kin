#!/usr/bin/env bash
# Adds the sound design to the silent master (video stream copied untouched) and copies both deliverables to film/.
set -euo pipefail
cd "$(dirname "$0")/.."
SILENT=out/kin-brand-film-30s-silent.mp4
FINAL=out/kin-brand-film-30s.mp4
ffmpeg -v error -y -i "$SILENT" -i public/kin-sound.wav -map 0:v:0 -map 1:a:0 -c:v copy -bsf:v h264_metadata=sample_aspect_ratio=1/1 -c:a aac -b:a 320k -ar 48000 \
  -t 30 -movflags +faststart "$FINAL"
# The silent deliverable: same video stream, no audio track at all, faststart for the web.
ffmpeg -v error -y -i "$SILENT" -map 0:v:0 -c:v copy -bsf:v h264_metadata=sample_aspect_ratio=1/1 -an -movflags +faststart ../kin-brand-film-30s-silent.mp4
cp "$FINAL" ../kin-brand-film-30s.mp4
echo "wrote ../kin-brand-film-30s.mp4 and ../kin-brand-film-30s-silent.mp4"
