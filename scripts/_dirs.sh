#!/usr/bin/env bash
#
# Where the music and the database live. Sourced by the other scripts so they
# agree with the server rather than each guessing.
#
# This is the shell half of `defaultDirs` in apps/server/src/config.ts; the two
# must answer the same, and config.test.ts pins the TypeScript side. Change one,
# change the other.
#
# Sets LIBRARY_DIR and DATA_DIR.

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
