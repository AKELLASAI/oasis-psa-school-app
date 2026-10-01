#!/bin/bash
# Oasis Pre School — put the app on your cloud server (first time), or send an update (every time after).
# Double-click this file. It asks a few questions, uploads the app and sets everything up over SSH.
# Your answers are remembered in deploy/server.conf for next time.
cd "$(dirname "$0")" || exit 1
APPDIR="$(pwd)"
CONF="$APPDIR/deploy/server.conf"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m%s\033[0m\n\n' "$*"; read -r -p "Press Return to close." _; exit 1; }

SERVER_IP=""; SERVER_USER="root"; DOMAIN=""; CERT_EMAIL=""; SSH_KEY=""
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

bold "Put Oasis Online"
echo "This uploads the Oasis app to your cloud server and sets it up with HTTPS."
echo "Press Return to keep the value shown in [brackets]."

ask() { # ask VAR "Question"
  local cur="${!1}" ans
  read -r -p "$2${cur:+ [$cur]}: " ans
  [ -n "$ans" ] && printf -v "$1" '%s' "$ans"
}
ask SERVER_IP   "Server IP address (from your cloud provider)"
[ -n "$SERVER_IP" ] || fail "The server IP address is needed."
ask SERVER_USER "Login name on the server (root, or ubuntu on some providers)"
ask DOMAIN      "Web address, e.g. app.oasisschool.in (leave empty for a free temporary address)"
ask CERT_EMAIL  "Your email (for HTTPS certificate notices)"
ask SSH_KEY     "SSH key file, if your provider gave you one (leave empty to type a password)"
# A file dragged into Terminal arrives with a trailing space and backslashes before spaces.
SSH_KEY="$(printf '%s' "$SSH_KEY" | sed -e 's/[[:space:]]*$//' -e "s/^'//" -e "s/'$//" -e 's/\\\(.\)/\1/g')"
SSH_KEY="${SSH_KEY/#\~/$HOME}"
[ -z "$SSH_KEY" ] || [ -f "$SSH_KEY" ] || fail "The SSH key file $SSH_KEY was not found."

mkdir -p "$APPDIR/deploy"
{
  echo "# Saved by Put Oasis Online.command"
  printf 'SERVER_IP=%q\nSERVER_USER=%q\nDOMAIN=%q\nCERT_EMAIL=%q\nSSH_KEY=%q\n' "$SERVER_IP" "$SERVER_USER" "$DOMAIN" "$CERT_EMAIL" "$SSH_KEY"
} > "$CONF"
chmod 600 "$CONF"

TMP="$(mktemp -d)"
trap 'ssh -O exit -o ControlPath="$TMP/cm" "$SERVER_USER@$SERVER_IP" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$TMP/cm" -o ControlPersist=600 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
[ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")
TARGET="$SERVER_USER@$SERVER_IP"

bold "1. Packing the app"
FILES=(index.html sw.js manifest.json logo.png README.txt icons img js vendor
       server/server.js server/api.js server/package.json server/package-lock.json)
[ -f "Android App/Oasis.apk" ] && FILES+=("Android App/Oasis.apk")
for f in "${FILES[@]}"; do [ -e "$f" ] || fail "Missing $f in the Oasis folder."; done
COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "$TMP/oasis-app.tgz" --exclude '.DS_Store' "${FILES[@]}" 2>/dev/null ||
  COPYFILE_DISABLE=1 tar -czf "$TMP/oasis-app.tgz" --exclude '.DS_Store' "${FILES[@]}" || fail "Could not pack the app."
cp "$APPDIR/deploy/setup-server.sh" "$TMP/setup-server.sh"
echo "Done ($(du -h "$TMP/oasis-app.tgz" | awk '{print $1}'))."

bold "2. Connecting to $TARGET"
echo "If asked, type the server password (nothing shows while you type) and press Return."
ssh "${SSH_OPTS[@]}" "$TARGET" 'echo connected' >/dev/null || fail "Could not log in to $TARGET. Check the IP address, login name and password or key."
echo "Connected."

UP=(oasis-app.tgz setup-server.sh)
if [ -f server/.env ]; then cp server/.env "$TMP/oasis.env"; UP+=(oasis.env); fi
FIRST="$(ssh "${SSH_OPTS[@]}" "$TARGET" 'if [ -f /opt/oasis/data/oasis.db ]; then echo no; else echo yes; fi')"
if [ "$FIRST" = "yes" ] && [ -f server/data/oasis.db ]; then
  bold "Copy the school records from this Mac to the server?"
  echo "Do this once, when the app goes online. After that, the server's records are the ones that count,"
  echo "so stop using the Oasis server on this Mac."
  read -r -p "Copy records now? (y/n) [y]: " yn
  if [ "${yn:-y}" = "y" ] || [ "${yn:-y}" = "Y" ]; then cp server/data/oasis.db "$TMP/oasis.db"; UP+=(oasis.db); fi
fi

bold "3. Uploading"
ssh "${SSH_OPTS[@]}" "$TARGET" 'rm -rf ~/oasis-upload && mkdir -m 700 ~/oasis-upload' || fail "Could not create the upload folder on the server."
( cd "$TMP" && scp -q "${SSH_OPTS[@]}" "${UP[@]}" "$TARGET:oasis-upload/" ) || fail "The upload did not finish. Please try again."
echo "Uploaded."

bold "4. Setting up the server (5 to 10 minutes the first time)"
SUDO="sudo"; [ "$SERVER_USER" = "root" ] && SUDO=""
ARGS=""
[ -n "$DOMAIN" ] && ARGS="$ARGS --domain $(printf %q "$DOMAIN")"
[ -n "$CERT_EMAIL" ] && ARGS="$ARGS --email $(printf %q "$CERT_EMAIL")"
ssh -t "${SSH_OPTS[@]}" "$TARGET" "$SUDO bash ~/oasis-upload/setup-server.sh --from ~/oasis-upload $ARGS; rc=\$?; rm -rf ~/oasis-upload; exit \$rc" ||
  fail "The setup stopped with a problem. The messages above say what went wrong."

LIVE="$(ssh "${SSH_OPTS[@]}" "$TARGET" 'cat /opt/oasis/domain 2>/dev/null')"
if [ -n "$LIVE" ]; then
  bold "Opening https://$LIVE"
  open "https://$LIVE" 2>/dev/null
fi
echo
read -r -p "All done. Press Return to close." _
