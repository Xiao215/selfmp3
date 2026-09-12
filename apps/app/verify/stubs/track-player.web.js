// Spike-only stand-in for react-native-track-player in the web bundle.
//
// track-player 5.0.0-alpha0 ships a web implementation that imports
// `shaka-player`, a dependency this repository does not have and does not want:
// docs/UNIVERSAL.md makes the existing two-`<audio>` engine the web side of the
// PlaybackEngine port, and track-player the native side. So on web the module
// should never be reached at all.
//
// Phase 3 removes the need for this file by putting every call behind
// `src/ports/engine.{web,native}.ts`. Until then the seven files that import
// track-player directly would drag shaka into the web bundle, so the spike
// resolves the specifier here instead (see metro.config.js) to answer the only
// question it is asking: does apps/app export to web at all.
//
// Every member below throws rather than no-oping, so that if a screen ever does
// reach the native player on web it fails loudly in the spike instead of going
// quiet and looking like it worked.

// Setting the native player up is exactly what a web build should skip, so
// these answer quietly. Anything that would make or control sound still throws:
// silence that looks like success is the failure mode worth avoiding.
const SILENT = new Set([
  'registerPlaybackService',
  'setupPlayer',
  'updateOptions',
  'addEventListener',
  'reset',
])

const unreachable = (name) => () => {
  throw new Error(
    `react-native-track-player.${name} was called in the web bundle. ` +
      'On web, playback belongs to the web engine behind the PlaybackEngine port.',
  )
}

const silent = (name) => () =>
  name === 'addEventListener' ? { remove() {} } : Promise.resolve()

const handler = {
  get: (_target, prop) => {
    if (typeof prop !== 'string') return undefined
    return SILENT.has(prop) ? silent(prop) : unreachable(prop)
  },
}

const TrackPlayer = new Proxy({}, handler)

// Enum-shaped exports are read as values at module scope, so they have to be
// real objects rather than throwing proxies.
const Event = {}
const State = {}
const RepeatMode = {}
const Capability = {}
const IOSCategory = {}
const IOSCategoryMode = {}
const AndroidAudioContentType = {}
const AppKilledPlaybackBehavior = {}

// The hooks are called during render by the shared PlayerProvider, so they have
// to return something shaped right. They report a player that exists and is
// doing nothing, which on web is true: the web engine is the one playing.
const useIsPlaying = () => ({ playing: false, bufferingDuringPlay: false })
const useProgress = () => ({ position: 0, duration: 0, buffered: 0 })
const useTrackPlayerEvents = () => {}

module.exports = {
  __esModule: true,
  default: TrackPlayer,
  Event,
  State,
  RepeatMode,
  Capability,
  IOSCategory,
  IOSCategoryMode,
  AndroidAudioContentType,
  AppKilledPlaybackBehavior,
  useIsPlaying,
  useProgress,
  useTrackPlayerEvents,
}
