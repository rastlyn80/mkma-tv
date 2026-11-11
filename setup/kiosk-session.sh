#!/usr/bin/env bash
# Runs on the TV screen after automatic login. Opens the display full-screen
# and reopens it if it ever closes or crashes.
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8080
[ -f "$DIR/kiosk.env" ] && . "$DIR/kiosk.env"
URL="http://localhost:$PORT/display"

# Wait (up to a minute) for the server to be ready
for i in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/api/me" >/dev/null && break
  sleep 1
done

CHROME="$(command -v chromium || command -v chromium-browser)"

while true; do
  cage -d -- "$CHROME" \
    --kiosk "$URL" \
    --incognito \
    --no-first-run \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=Translate,TranslateUI \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required \
    --check-for-update-interval=31536000 \
    --password-store=basic \
    --ozone-platform=wayland \
    --enable-features=VaapiVideoDecoder,VaapiIgnoreDriverChecks,VaapiVideoDecodeLinuxGL \
    --user-data-dir="$HOME/.config/mkma-display"
  sleep 3
done
