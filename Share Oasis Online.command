#!/bin/bash
# Oasis Pre School — a free internet link to the Oasis server on this Mac (Cloudflare Quick Tunnel).
# Double-click this file. It prints an https://....trycloudflare.com link that opens Oasis from anywhere.
# The link works while this window stays open and the Mac is on. It changes every time you start it.
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"
CF="$DIR/deploy/cloudflared"
LINKFILE="$DIR/Online link.txt"
done_msg() { echo; read -r -p "Press Return to close." _; }

if [ ! -x "$CF" ]; then
  echo "The tunnel app is missing (deploy/cloudflared)."; done_msg; exit 1
fi

up() { curl -fsS --max-time 2 http://localhost:8080/healthz >/dev/null 2>&1; }
if ! up; then
  echo "Starting the Oasis server first..."
  open "$DIR/Start Oasis Server.command"
  for _ in $(seq 1 40); do up && break; sleep 1; done
fi
if ! up; then
  echo "The Oasis server is not running. Double-click \"Start Oasis Server\", then try again."; done_msg; exit 1
fi

echo "Creating your free internet link (about 10 seconds)..."
LOG="$(mktemp)"
"$CF" tunnel --no-autoupdate --url http://localhost:8080 > "$LOG" 2>&1 &
CFPID=$!
caffeinate -i -w "$CFPID" &   # keep the Mac from sleeping while the link is on
trap 'kill "$CFPID" 2>/dev/null; rm -f "$LOG" "$LINKFILE"; echo; echo "The internet link is now switched off."' EXIT

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)"
  [ -n "$URL" ] && break
  kill -0 "$CFPID" 2>/dev/null || break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "The link could not be created. Check the internet connection and try again."
  tail -15 "$LOG"; done_msg; exit 1
fi

echo "$URL" > "$LINKFILE"
echo
printf '\033[1;32m  Oasis is online at:\033[0m\n\n'
printf '\033[1m      %s\033[0m\n\n' "$URL"
echo "  Share this link with staff and parents. It works on any phone or computer, anywhere."
echo "  It is also saved in the file \"Online link.txt\" in the Oasis folder."
echo
echo "  Keep this window open. Closing it, or turning off / closing the lid of this Mac, switches the link off."
echo "  The link is new each time you start it, so send the new one after a restart."
open "$URL" 2>/dev/null
wait "$CFPID"
