#!/usr/bin/env bash
#
# Remove the self.mp3 background service. Your music and database are untouched.

set -euo pipefail

LABEL="com.selfmp3.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"

echo "Background service removed."
echo "Your library/ and data/ folders are untouched."
echo
echo "If you also set up Tailscale serve, turn it off with:"
echo "  tailscale serve --https=443 off"
