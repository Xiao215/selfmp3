#!/usr/bin/env bash
#
# Remove the self.mp3 background service. Your music and database are untouched.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=./_dirs.sh
source "$PROJECT_DIR/scripts/_dirs.sh"
PLIST="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"

launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" 2>/dev/null || true
rm -f "$PLIST"

echo "Background service removed. Your music and your database are untouched:"
echo "  $LIBRARY_DIR"
echo "  $DATA_DIR"
echo
echo "If you also set up Tailscale serve, turn it off with:"
echo "  tailscale serve --https=443 off"
