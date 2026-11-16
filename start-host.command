#!/bin/bash
# Double-click to run the HOST laptop: starts the hub + this laptop's agent and
# opens the control pad. Keep this Terminal window open while you work; closing
# it (or Ctrl-C) stops everything.

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
PORT="${PORT:-3000}"

clear
echo "  SYNC CONTROL — host"
echo "  ------------------------------------------"

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed. Install it (brew install node) and try again."
  echo; read -r -p "  Press return to close…" _; exit 1
fi

# Build the no-focus-steal helper if it's missing and we can.
if [ ! -x ./keypost ]; then
  if command -v swiftc >/dev/null 2>&1; then
    echo "  Building keypost helper…"
    swiftc keypost.swift -o keypost 2>/dev/null && echo "  keypost ready." \
      || echo "  keypost build failed — will fall back to osascript."
  else
    echo "  (swiftc not found — using osascript fallback. Run xcode-select --install for smoother host control.)"
  fi
fi

read -r -p "  Teleprompter app name [Your App]: " TARGET; TARGET="${TARGET:-Your App}"
read -r -p "  Host scroll speed 1-10 [1]: " SPEED;      SPEED="${SPEED:-1}"
echo

# Start hub, then this laptop's agent, then open the pad.
node server.js & SRV=$!
sleep 1
node agent.js --host "http://localhost:$PORT" --target "$TARGET" --speed "$SPEED" --name host --no-mouse & AG=$!
sleep 1
open "http://localhost:$PORT"

trap 'echo; echo "  stopping…"; kill $SRV $AG 2>/dev/null' EXIT INT TERM
echo
echo "  Running. Control pad: http://localhost:$PORT"
echo "  Close this window to stop."
wait
