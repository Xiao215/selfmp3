#!/usr/bin/env bash
#
# Where the music and the database live, which port the server is on, and the
# launchd job that runs it on a Mac. Sourced by the other scripts so they agree
# with the server and with each other rather than each guessing.
#
# The folders are the shell half of `defaultDirs` in apps/server/src/config.ts;
# the two must answer the same, and config.test.ts pins the TypeScript side.
# Change one, change the other.
#
# Sets LIBRARY_DIR, DATA_DIR, PORT, SERVICE_LABEL, SERVICE_LOG and
# SERVICE_ERROR_LOG.

# A profile is a whole separate installation: its own music, its own database,
# and so its own cloud sign-in, since that lives in the database.
# The same normalisation as `profileSuffix` in config.ts, character for
# character: lower-cased, any run of other characters collapsed to one dash,
# dashes trimmed off both ends, then cut to twenty. Written with sed rather
# than `tr`, which cannot collapse a run, and parameter expansion, which strips
# only one dash — either would let the two halves disagree on `a  b` or `---`.
_profile="$(printf '%s' "${SELFMP3_PROFILE:-}" |
  tr '[:upper:]' '[:lower:]' |
  sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
if [[ -n "$_profile" ]]; then
  _suffix="-${_profile:0:20}"
else
  _suffix=""
fi

_default_library="$HOME/Music/selfmp3$_suffix"
if [[ "$(uname -s)" == "Darwin" ]]; then
  _default_data="$HOME/Library/Application Support/selfmp3$_suffix"
else
  _default_data="$HOME/.local/share/selfmp3$_suffix"
fi

LIBRARY_DIR="${SELFMP3_LIBRARY_DIR:-$_default_library}"
DATA_DIR="${SELFMP3_DATA_DIR:-$_default_data}"
unset _default_library _default_data _profile _suffix

# The server's port: SELFMP3_PORT, or the default the server itself picks
# (DEFAULT_SERVER_PORT in packages/shared/src/origins.ts).
PORT="${SELFMP3_PORT:-4600}"

# The background service (scripts/install-service.sh) and where its output goes.
SERVICE_LABEL="com.selfmp3.server"
SERVICE_LOG="$HOME/Library/Logs/selfmp3.log"
SERVICE_ERROR_LOG="$HOME/Library/Logs/selfmp3.error.log"
