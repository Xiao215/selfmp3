#!/usr/bin/env bash
#
# Is self.mp3 healthy? One screen of answers.
#
#   ./scripts/doctor.sh
#
# Written for macOS but degrades gracefully elsewhere. Respects SELFMP3_PORT,
# SELFMP3_LIBRARY_DIR and SELFMP3_DATA_DIR the same way the server does.

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SELFMP3_PORT:-4600}"
# shellcheck source=./_dirs.sh
source "$PROJECT_DIR/scripts/_dirs.sh"
LABEL="com.selfmp3.server"
LOG="$HOME/Library/Logs/selfmp3.log"
ERR_LOG="$HOME/Library/Logs/selfmp3.error.log"

if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; RED=$'\e[31m'; RESET=$'\e[0m'
else
  BOLD=''; DIM=''; GREEN=''; RED=''; RESET=''
fi

good() { printf "  ${GREEN}✓${RESET} %-10s %s\n" "$1" "$2"; }
bad()  { printf "  ${RED}✗${RESET} %-10s %s\n" "$1" "$2"; PROBLEMS=$((PROBLEMS + 1)); }
PROBLEMS=0

echo "${BOLD}self.mp3 doctor${RESET} ${DIM}($PROJECT_DIR)${RESET}"
echo

# --- tools ------------------------------------------------------------------

if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -p 'process.versions.node')"
  if (( ${NODE_VERSION%%.*} >= 22 )); then good node "v$NODE_VERSION"; else bad node "v$NODE_VERSION (need 22+: brew install node)"; fi
else
  bad node "not installed (brew install node)"
fi

if command -v yt-dlp >/dev/null 2>&1; then
  good yt-dlp "$(yt-dlp --version 2>/dev/null)  ${DIM}(brew upgrade yt-dlp if imports fail)${RESET}"
else
  bad yt-dlp "not installed — imports will not work (brew install yt-dlp)"
fi

if command -v ffmpeg >/dev/null 2>&1; then
  good ffmpeg "$(ffmpeg -version 2>/dev/null | head -n1 | sed 's/^ffmpeg version //; s/ Copyright.*//')"
else
  bad ffmpeg "not installed — imports arrive without artwork (brew install ffmpeg)"
fi

if [[ -f "$PROJECT_DIR/apps/server/dist/main.js" ]]; then
  good build "apps/server/dist is present"
else
  bad build "not built yet (npm run build, or ./scripts/setup-mac.sh)"
fi

# --- service and port -------------------------------------------------------

if [[ "$(uname)" == "Darwin" ]]; then
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    PID="$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | awk '/^\s*pid = /{print $3}')"
    if [[ -n "${PID:-}" ]]; then
      good service "running (launchd $LABEL, pid $PID)"
    else
      bad service "installed but not running — check $ERR_LOG"
    fi
  else
    bad service "not installed (./scripts/install-service.sh)"
  fi
fi

HEALTH="$(curl -fsS --max-time 3 "http://localhost:$PORT/api/health" 2>/dev/null)"
if [[ -n "$HEALTH" ]]; then
  SONGS="$(printf '%s' "$HEALTH" | sed -n 's/.*"songCount":\([0-9]*\).*/\1/p')"
  UPTIME="$(printf '%s' "$HEALTH" | sed -n 's/.*"uptimeSeconds":\([0-9]*\).*/\1/p')"
  good port "$PORT is answering — ${SONGS:-?} songs, up $(( ${UPTIME:-0} / 60 )) min"
else
  bad port "nothing answering on http://localhost:$PORT (npm start)"
fi

# --- folders ----------------------------------------------------------------

folder_line() {
  local label="$1" dir="$2"
  if [[ -d "$dir" ]]; then
    local files size
    files="$(find "$dir" -type f 2>/dev/null | wc -l | tr -d ' ')"
    size="$(du -sh "$dir" 2>/dev/null | cut -f1)"
    good "$label" "$dir — $files files, $size"
  else
    bad "$label" "$dir — missing (created on first start)"
  fi
}
folder_line library "$LIBRARY_DIR"
folder_line data "$DATA_DIR"

# --- tailscale --------------------------------------------------------------

TAILSCALE_BIN="$(command -v tailscale || true)"
[[ -z "$TAILSCALE_BIN" && -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]] &&
  TAILSCALE_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [[ -n "$TAILSCALE_BIN" ]]; then
  TS_IP="$("$TAILSCALE_BIN" ip -4 2>/dev/null | head -n1)"
  if [[ -n "$TS_IP" ]]; then
    good tailscale "$TS_IP  ${DIM}(your phone reaches the Mac here)${RESET}"
  else
    bad tailscale "installed but not connected — open the Tailscale app and sign in"
  fi
else
  echo "  ${DIM}- tailscale  not installed; needed to reach the server from your phone (docs/SETUP.md)${RESET}"
fi

# --- logs -------------------------------------------------------------------

if [[ -f "$LOG" ]]; then
  echo
  echo "${BOLD}last 5 log lines${RESET} ${DIM}($LOG)${RESET}"
  tail -n 5 "$LOG" | sed 's/^/  /'
  if [[ -s "$ERR_LOG" ]]; then
    echo
    echo "${BOLD}last 5 error lines${RESET} ${DIM}($ERR_LOG)${RESET}"
    tail -n 5 "$ERR_LOG" | sed 's/^/  /'
  fi
fi

echo
if (( PROBLEMS == 0 )); then
  echo "${GREEN}Everything looks fine.${RESET}"
else
  echo "${RED}$PROBLEMS thing(s) to look at.${RESET}"
fi
exit $(( PROBLEMS > 0 ))
