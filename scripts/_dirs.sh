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

# Both defaults turn on the same question — is there already a library in this
# checkout? — and neither is affected by the other being overridden, which is
# how config.ts computes them. An existing library stays where it is: an
# upgrade must never look like losing your music.
if [[ -d "$PROJECT_DIR/library" ]]; then
  _default_library="$PROJECT_DIR/library"
  _default_data="$PROJECT_DIR/data"
else
  _default_library="$HOME/Music/selfmp3"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    _default_data="$HOME/Library/Application Support/selfmp3"
  else
    _default_data="$HOME/.local/share/selfmp3"
  fi
fi

LIBRARY_DIR="${SELFMP3_LIBRARY_DIR:-$_default_library}"
DATA_DIR="${SELFMP3_DATA_DIR:-$_default_data}"
unset _default_library _default_data
