#!/bin/bash
# Double-click to run a CLIENT / backup laptop: connects this laptop's agent to
# the host hub so it mirrors every scroll command. Keep this window open.

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

clear
echo "  SYNC CONTROL — backup rig"
echo "  ------------------------------------------"

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed. Install it (brew install node) and try again."
  echo; read -r -p "  Press return to close…" _; exit 1
fi

if [ ! -x ./keypost ]; then
  if command -v swiftc >/dev/null 2>&1; then
    echo "  Building keypost helper…"
    swiftc keypost.swift -o keypost 2>/dev/null && echo "  keypost ready." \
      || echo "  keypost build failed — will fall back to osascript."
  else
    echo "  (swiftc not found — using osascript fallback.)"
  fi
fi

read -r -p "  Host IP address (shown on the host, e.g. 192.168.1.42): " IP
read -r -p "  Host port [3000]: " PORT;                  PORT="${PORT:-3000}"
read -r -p "  Teleprompter app name [Your App]: " TARGET; TARGET="${TARGET:-Your App}"
read -r -p "  This rig's scroll speed 1-10 [1]: " SPEED;  SPEED="${SPEED:-1}"
read -r -p "  Name for this rig [backup]: " NAME;         NAME="${NAME:-backup}"

if [ -z "$IP" ]; then
  echo "  No host IP given — can't connect."
  echo; read -r -p "  Press return to close…" _; exit 1
fi

echo
echo "  Connecting to http://$IP:$PORT …  (make sure the teleprompter app is frontmost)"
echo "  Close this window to disconnect."
echo
exec node agent.js --host "http://$IP:$PORT" --target "$TARGET" --speed "$SPEED" --name "$NAME"
