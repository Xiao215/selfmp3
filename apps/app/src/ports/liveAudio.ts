/**
 * Whether a visual may listen to the music as it plays: route playback through
 * the engine's analyser and draw the sound itself.
 *
 * Never on a phone. Its player has no analyser to ask (`engine.ts` says so in
 * its capabilities), so Spectrum there is drawn from the song's tempo and
 * energy, which the browser's half (`liveAudio.web.ts`) also falls back to
 * wherever listening would cost more than it shows.
 */
export function canHearMusic(): boolean {
  return false
}
