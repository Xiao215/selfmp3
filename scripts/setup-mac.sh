#!/usr/bin/env bash
#
# One-command setup for self.mp3 on a Mac.
#
#   ./scripts/setup-mac.sh
#
# Checks Node, installs yt-dlp and ffmpeg through Homebrew if they are missing,
# builds the app, creates the library/ and data/ folders, and offers to install
# the background service. Safe to run again at any time: every step is a
# no-op when it has already been done.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# --yes answers every prompt with yes; --no-service skips the launchd step.
ASSUME_YES=0
SKIP_SERVICE=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --no-service) SKIP_SERVICE=1 ;;
    -h|--help)
      sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      echo "Options: --yes (no prompts), --no-service (skip the launchd step)"
      exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# --- output helpers ---------------------------------------------------------

if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'
else
  BOLD=''; DIM=''; GREEN=''; YELLOW=''; RED=''; RESET=''
fi

ok()   { echo "  ${GREEN}✓${RESET} $*"; }
# Yes unless the user types n; a closed stdin (CI, a pipe) counts as no.
ask()  {
  local answer
  if (( ASSUME_YES )); then return 0; fi
  read -r -p "  $* [Y/n] " answer || return 1
  [[ "${answer:-Y}" =~ ^[Yy]$ ]]
}
warn() { echo "  ${YELLOW}!${RESET} $*"; }
fail() { echo "  ${RED}✗${RESET} $*" >&2; exit 1; }
step() { echo; echo "${BOLD}$*${RESET}"; }

# --- platform ---------------------------------------------------------------

if [[ "$(uname)" != "Darwin" ]]; then
  fail "This script is for macOS. On Linux or a NAS, see docs/INSTALL.md for the Docker route."
fi

echo "${BOLD}self.mp3 setup${RESET} ${DIM}($PROJECT_DIR)${RESET}"

# --- node -------------------------------------------------------------------

step "Node"
if ! command -v node >/dev/null 2>&1; then
  fail "node is not installed. Run:  brew install node   (then re-run this script)"
fi
NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if (( NODE_MAJOR < 22 )); then
  fail "Node $NODE_VERSION found, but self.mp3 needs 22 or newer. Run:  brew install node  (or  brew upgrade node)"
fi
ok "node v$NODE_VERSION"

# --- homebrew tools ---------------------------------------------------------

step "Tools for importing"
HAVE_BREW=0
command -v brew >/dev/null 2>&1 && HAVE_BREW=1

install_tool() {
  local name="$1" formula="$2" why="$3"
  if command -v "$name" >/dev/null 2>&1; then
    ok "$name $("$name" --version 2>/dev/null | head -n1 | sed 's/^ffmpeg version //; s/ Copyright.*//')"
    return
  fi
  if (( HAVE_BREW )); then
    echo "  ${DIM}installing $name with Homebrew ($why)…${RESET}"
    brew install "$formula"
    ok "$name installed"
  else
    warn "$name not found and Homebrew is not installed."
    warn "  $why. Install Homebrew from https://brew.sh then run:  brew install $formula"
  fi
}

install_tool yt-dlp yt-dlp "yt-dlp downloads audio from links"
install_tool ffmpeg ffmpeg "ffmpeg embeds artwork and tags"

# --- build ------------------------------------------------------------------

step "Dependencies"
# `npm ci` would be faster but fails when the lockfile is ahead of package.json
# after a git pull; `npm install` always converges.
npm install --no-fund --no-audit --loglevel=error
ok "npm packages installed"

step "Build"
npm run build --silent
ok "built apps/server/dist and apps/web/dist"

# --- folders ----------------------------------------------------------------

step "Folders"
mkdir -p "$PROJECT_DIR/library" "$PROJECT_DIR/data"
ok "library/  ${DIM}(your audio files go here)${RESET}"
ok "data/     ${DIM}(database and cover cache)${RESET}"

# --- background service -----------------------------------------------------

step "Background service"
LABEL="com.selfmp3.server"
if (( SKIP_SERVICE )); then
  warn "skipped (--no-service). Start it by hand with:  npm start"
elif launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  ok "already installed (launchd: $LABEL)"
  echo "  ${DIM}Restarting it picks up the build you just made.${RESET}"
  if ask "Restart the service now?"; then
    ./scripts/install-service.sh
  fi
else
  echo "  self.mp3 can start at login and restart itself if it ever crashes."
  if ask "Install it as a background service now?"; then
    ./scripts/install-service.sh
  else
    warn "skipped. Start it by hand with:  npm start   (or later:  ./scripts/install-service.sh)"
  fi
fi

# --- done -------------------------------------------------------------------

echo
echo "${BOLD}All set.${RESET}"
echo
echo "  Open:        http://localhost:4600"
echo "  Check:       ./scripts/doctor.sh"
echo "  Import:      npm run cli -- import <url>"
echo "  Your phone:  docs/SETUP.md"
echo
