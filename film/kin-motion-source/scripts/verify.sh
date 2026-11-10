#!/usr/bin/env bash
# Checks both deliverables: duration, size, frame rate, frame count, codec, aspect ratio, audio, black frames.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ok    $1 = $2"; else echo "  FAIL  $1 = $2 (want $3)"; fail=1; fi; }
for f in kin-brand-film-30s.mp4 kin-brand-film-30s-silent.mp4; do
  echo "== $f"
  v() { ffprobe -v error -select_streams v:0 -show_entries "stream=$1" -of default=nw=1:nk=1 "$f"; }
  check codec "$(v codec_name)" h264
  check profile_pixfmt "$(v pix_fmt)" yuv420p
  check width "$(v width)" 1920
  check height "$(v height)" 1080
  check display_aspect "$(v display_aspect_ratio)" 16:9
  check frame_rate "$(v r_frame_rate)" 60/1
  check frames "$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of default=nw=1:nk=1 "$f")" 1800
  check video_duration "$(v duration)" 30.000000
  audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of default=nw=1:nk=1 "$f")
  if [ "$f" = kin-brand-film-30s.mp4 ]; then check audio "$audio" aac; else check audio "${audio:-none}" none; fi
  black=$(ffmpeg -nostats -i "$f" -vf "blackdetect=d=0.02:pix_th=0.10" -an -f null - 2>&1 | grep -c black_start || true)
  check black_segments "$black" 0
done
exit $fail
