#!/usr/bin/env bash
# Run offline.yaml with the Mac's server frozen, and always thaw it after.
#
#   .maestro/offline-run.sh [maestro options, e.g. --device <udid>]
#
# SIGSTOP rather than stopping the server: nothing has to be restarted with
# the right environment afterwards, and a server that accepts a connection and
# never answers is exactly what a sleeping Mac looks like from a phone.
set -euo pipefail

port="${SELFMP3_PORT:-4600}"
here="$(cd "$(dirname "$0")" && pwd)"
maestro="${MAESTRO:-maestro}"

pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | head -1)"
if [ -z "$pid" ]; then
  echo "Nothing is listening on port $port; start the server first." >&2
  exit 1
fi

trap 'kill -CONT "$pid" 2>/dev/null || true' EXIT
kill -STOP "$pid"
"$maestro" "$@" test "$here/offline.yaml"
