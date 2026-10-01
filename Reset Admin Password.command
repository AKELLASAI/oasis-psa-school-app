#!/bin/bash
# Oasis Pre School — set a new password for an account (for example a locked-out administrator).
# You type the new password here; it is saved in scrambled (hashed) form and never shown.
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"
done_msg() { echo; read -r -p "Press Return to close." _; }

echo "Reset a password for Oasis"
echo
read -r -p "Email or username of the account [svakella35]: " WHO
WHO="${WHO:-svakella35}"
while true; do
  read -r -s -p "New password (8 or more characters): " P1; echo
  read -r -s -p "Type it again: " P2; echo
  if [ "${#P1}" -lt 8 ]; then echo "Too short. Please use 8 or more characters."; continue; fi
  if [ "$P1" != "$P2" ]; then echo "The two passwords are different. Please try again."; continue; fi
  break
done

# The server keeps records in memory, so it is stopped while the password is saved, then started again.
PIDS="$(lsof -ti tcp:8080 -sTCP:LISTEN 2>/dev/null)"
if [ -n "$PIDS" ]; then echo "Stopping the Oasis server for a moment..."; kill $PIDS 2>/dev/null; sleep 2; fi

cd "$DIR/server" || exit 1
if OASIS_NEW_PASSWORD="$P1" node server.js --set-password "$WHO"; then
  OK=1
else
  OK=""
fi
unset P1 P2

echo "Starting the Oasis server again..."
open "$DIR/Start Oasis Server.command"
echo
if [ -n "$OK" ]; then
  echo "Done. Log in as \"$WHO\" with the new password. The account is active again."
else
  echo "The password was not changed (see the message above). Check the email or username."
fi
done_msg
