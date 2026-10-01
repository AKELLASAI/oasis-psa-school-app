#!/bin/bash
# Double-click once to create the WhatsApp login-code template (or to check whether Meta has approved it).
cd "$(dirname "$0")/server" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo ""
node server.js --whatsapp-template
echo ""
read -n 1 -s -r -p "Press any key to close."
