import { useMemo } from 'react'
import { useMotion, type FrequencyAnalyser } from '@selfmp3/client'
import type { Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider'
import { canHearMusic } from '../../ports/liveAudio'
import { chooseSampler, type MotionCurveLike, type MotionSampler } from './motionSource'
import { debugCurve } from './visualDebug'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { visualFeel } from './visuals.model'

/**
 * The analyser, once any visual on this page has asked for it: asking routes
 * playback through Web Audio for the life of the page, so the answer is kept.
 */
let heard: FrequencyAnalyser | null = null

/**
 * What a song's visual follows: the sound where this device can listen, the
 * song's stored motion curve where it cannot, its tempo where neither is
 * there (`chooseSampler`).
 *
 * `active` is whether a visual is actually showing. The analyser is asked for
 * only then — never for a song with lyrics, never under Reduce Motion, which
 * draws one still frame — because asking re-routes the page's audio for good.
 * It is asked while rendering, which is safe only because the engine makes one
 * analyser and keeps it: a second render, or Strict Mode's double one, is
 * handed the same node and changes nothing.
 */
export function useMotionSampler(song: Song, active: boolean): MotionSampler {
  const player = usePlayer()
  const reduced = useReducedMotion()

  const forced = debugCurve()
  // The curve analysis stored for this song, fetched only while a visual shows:
  // a song with lyrics never needs it. Offline it comes from the device's copy.
  const stored: MotionCurveLike | null = useMotion(active ? song.id : null)
  const curve = forced ?? stored

  const canHear = canHearMusic() && !forced
  const listen = canHear && active && !reduced
  const ask = player.analyser
  const analyser = useMemo(
    () => (listen ? (heard ??= ask()) : canHear ? heard : null),
    [listen, canHear, ask],
  )

  const feel = useMemo(() => visualFeel(song.audioFeatures), [song.audioFeatures])
  const songId = song.id
  return useMemo(
    () => chooseSampler({ canHear, analyser, curve, feel, songId }),
    [canHear, analyser, curve, feel, songId],
  )
}
