#!/bin/bash
# Render build/icon.svg to build/icon.icns using only built-in macOS tools
# (qlmanage renders the SVG via WebKit; sips resizes; iconutil packs the .icns).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SVG="$DIR/icon.svg"
TMP="$(mktemp -d)"
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"

qlmanage -t -s 1024 -o "$TMP" "$SVG" >/dev/null 2>&1 || true
BASE="$TMP/icon.svg.png"
if [ ! -f "$BASE" ]; then echo "error: qlmanage could not render $SVG"; exit 1; fi

gen() { sips -z "$1" "$1" "$BASE" --out "$ICONSET/$2" >/dev/null; }
gen 16   icon_16x16.png
gen 32   icon_16x16@2x.png
gen 32   icon_32x32.png
gen 64   icon_32x32@2x.png
gen 128  icon_128x128.png
gen 256  icon_128x128@2x.png
gen 256  icon_256x256.png
gen 512  icon_256x256@2x.png
gen 512  icon_512x512.png
gen 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET" -o "$DIR/icon.icns"
echo "wrote $DIR/icon.icns"
