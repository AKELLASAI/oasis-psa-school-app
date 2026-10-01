#!/bin/bash
# Double-click to start the Oasis Pre School server. Close this window (or press Ctrl+C) to stop it.
cd "$(dirname "$0")/server" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js is not installed on this Mac."
  echo "Install the LTS version from https://nodejs.org, then double-click this file again."
  echo ""
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
if [ ! -d node_modules ]; then npm install --no-audit --no-fund || { read -n 1 -s -r -p "Install failed. Press any key to close."; exit 1; }; fi
( sleep 3; open "http://localhost:8080" ) &
npm start
echo ""
read -n 1 -s -r -p "The Oasis server has stopped. Press any key to close."
