#!/usr/bin/env bash
#
# Turn raw screen recordings into the web assets docs/index.html expects.
#
# Record each clip however you like — macOS Cmd+Shift+5 cropped to the Moldavite
# window is the simplest — then drop the files in a folder named after the slot
# they fill and run this script. It produces an MP4, a WebM, and a poster frame
# per clip, sized and compressed for GitHub Pages.
#
#   ./scripts/encode-site-media.sh ~/Desktop/moldavite-raw
#
# Expected input names (extension can be .mov, .mp4, or .m4v):
#   editor   — writing a note: Markdown shortcuts, a [[wiki link]], slash menu
#   forge    — switching Forges from the sidebar
#   search   — semantic search: a meaning-based query, then Related notes
#   graph    — the graph view clustering, with a drag
#
# Record with the demo Forge active so no personal note ever reaches a frame.
set -euo pipefail

SRC_DIR="${1:-}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docs/media"
WIDTH="${WIDTH:-1400}"      # output width; height follows the source aspect
POSTER_AT="${POSTER_AT:-1}" # seconds into the clip to grab the poster frame

if [[ -z "$SRC_DIR" || ! -d "$SRC_DIR" ]]; then
  echo "usage: $0 <folder-with-raw-recordings>" >&2
  exit 1
fi

command -v ffmpeg >/dev/null || { echo "ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }

mkdir -p "$OUT_DIR"
found=0

for slot in editor forge search graph; do
  src=""
  for ext in mov mp4 m4v MOV MP4; do
    [[ -f "$SRC_DIR/$slot.$ext" ]] && src="$SRC_DIR/$slot.$ext" && break
  done

  if [[ -z "$src" ]]; then
    echo "skip  $slot — no $SRC_DIR/$slot.{mov,mp4,m4v}"
    continue
  fi

  found=$((found + 1))
  echo "encode $slot  <- $(basename "$src")"

  # Even dimensions are required by both encoders; -an drops audio entirely.
  scale="scale=${WIDTH}:-2:flags=lanczos"

  ffmpeg -y -loglevel error -i "$src" \
    -vf "$scale" -an \
    -c:v libx264 -profile:v high -pix_fmt yuv420p \
    -crf 26 -preset slow -movflags +faststart \
    "$OUT_DIR/$slot.mp4"

  ffmpeg -y -loglevel error -i "$src" \
    -vf "$scale" -an \
    -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -deadline good \
    "$OUT_DIR/$slot.webm"

  ffmpeg -y -loglevel error -ss "$POSTER_AT" -i "$src" \
    -vf "$scale" -frames:v 1 -q:v 4 \
    "$OUT_DIR/$slot-poster.jpg"

  printf '       %s\n' "$(cd "$OUT_DIR" && ls -lh "$slot.mp4" "$slot.webm" "$slot-poster.jpg" | awk '{printf "%s %s  ", $9, $5}')"
done

if [[ "$found" -eq 0 ]]; then
  echo "nothing encoded — no recognised filenames in $SRC_DIR" >&2
  exit 1
fi

echo
echo "done — $found clip(s) written to docs/media/"
echo "keep each file under ~1 MB; raise CRF (26/36) if any came out heavier."
