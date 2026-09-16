import { useMemo } from 'react'
import { hueFromString, type Song } from '@selfmp3/shared'

import { motionTuning, type MotionTuning } from './visualMotion.model'
import { visualColors, visualFeel, type VisualColors } from './visuals.model'

/**
 * How a song looks and how its motion is tuned — the half of a visual that is
 * the same on a canvas and on `Animated` views.
 *
 * Both `SongVisual` twins derive this identically from the song alone, and
 * memoise it on the same five fields; the drawing below it is what actually
 * differs between them.
 */
export function useVisualLook(song: Song): { colors: VisualColors; tuning: MotionTuning } {
  const colors = useMemo(
    () =>
      visualColors(
        song.coverTone?.hue ?? hueFromString(song.album || song.title),
        song.audioFeatures?.camelot,
        song.coverTone?.palette,
      ),
    [
      song.coverTone?.hue,
      song.coverTone?.palette,
      song.album,
      song.title,
      song.audioFeatures?.camelot,
    ],
  )
  const bpmKnown = song.audioFeatures?.bpm != null
  const tuning = useMemo(
    () => motionTuning(visualFeel(song.audioFeatures), bpmKnown),
    [song.audioFeatures, bpmKnown],
  )
  return { colors, tuning }
}
