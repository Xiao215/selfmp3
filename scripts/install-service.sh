#!/usr/bin/env bash
#
# Install self.mp3 as a background service on macOS.
#
# Writes a launchd job that starts the server at login and restarts it if it
# ever exits. Safe to re-run: it replaces any previous install.

set -euo pipefail

LABEL="com.selfmp3.server"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"

# --- checks -----------------------------------------------------------------

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is for macOS. On Linux, use a systemd unit instead." >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "node not found on PATH. Install Node 22 or newer first." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "Node $NODE_MAJOR found, but self.mp3 needs Node 22 or newer." >&2
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/apps/server/dist/main.js" ]]; then
  echo "The server isn't built yet. Run this first:" >&2
  echo "    cd $PROJECT_DIR && npm install && npm run build" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# launchd runs with a minimal PATH, so yt-dlp and ffmpeg from Homebrew would be
# invisible. Both Intel and Apple Silicon prefixes are included.
SERVICE_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# --- write the job ----------------------------------------------------------

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_DIR/apps/server/dist/main.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$SERVICE_PATH</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>SELFMP3_HOST</key>
        <string>127.0.0.1</string>
        <key>SELFMP3_PORT</key>
        <string>4600</string>
        <!-- Add SELFMP3_AUTH_TOKEN here if you want a shared secret. -->
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <!-- Don't hammer the CPU if it's crash-looping on a bad config. -->
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/selfmp3.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/selfmp3.error.log</string>

    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST_EOF

# --- (re)load ---------------------------------------------------------------

# Ignore the error when nothing was loaded to begin with.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo
echo "self.mp3 is now running in the background."
echo
echo "  Local:   http://localhost:4600"
echo "  Logs:    tail -f $LOG_DIR/selfmp3.log"
echo "  Restart: launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "  Stop:    launchctl bootout gui/$(id -u)/$LABEL"
echo
echo "Note: it binds to 127.0.0.1 only. To reach it from your phone, put"
echo "Tailscale in front of it:"
echo
echo "  tailscale serve --bg 4600"
echo
echo "That also gives you real HTTPS, which iOS requires for offline downloads."
echo "See docs/SETUP.md for the full walkthrough."
