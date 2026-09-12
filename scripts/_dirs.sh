#!/usr/bin/env bash
#
# Where the music and the database live. Sourced by the other scripts so they
# agree with the server rather than each guessing.
#
# This is the shell half of `defaultDirs` in apps/server/src/config.ts; the two
# must answer the same, and config.test.ts pins the TypeScript side. Change one,
# change the other.
#
# Expects PROJECT_DIR to be set. Sets LIBRARY_DIR and DATA_DIR.

# A profile is a whole separate installation: its own music, its own database,
# and so its own cloud sign-in, since that lives in the database. Asking for one
# means asking not to be the real library, so a checkout's own folders lose.
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

# Otherwise both defaults turn on the same question — is there already a library
# in this checkout? — and neither is affected by the other being overridden,
# which is how config.ts computes them. An existing library stays where it is:
# an upgrade must never look like losing your music.
if [[ -z "$_suffix" && -d "$PROJECT_DIR/library" ]]; then
  _default_library="$PROJECT_DIR/library"
  _default_data="$PROJECT_DIR/data"
else
  _default_library="$HOME/Music/selfmp3$_suffix"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    _default_data="$HOME/Library/Application Support/selfmp3$_suffix"
  else
    _default_data="$HOME/.local/share/selfmp3$_suffix"
  fi
fi

LIBRARY_DIR="${SELFMP3_LIBRARY_DIR:-$_default_library}"
DATA_DIR="${SELFMP3_DATA_DIR:-$_default_data}"
unset _default_library _default_data _profile _suffix
