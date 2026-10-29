import { useMemo } from 'react'
import { hexToRgb } from '@selfmp3/client'
import { hasColour, hueFromString, type Song } from '@selfmp3/shared'

import { useAccentColor } from '../../ui/accent'
import { motionTuning, type MotionTuning } from './visualMotion.model'
import { colourlessColors, visualColors, visualFeel, type VisualColors } from './visuals.model'

/**
 * How a song looks and how its motion is tuned — the half of a visual that is
 * the same on a canvas and on `Animated` views.
 *
 * Both `SongVisual` twins derive this identically from the song alone, and
 * memoise it on the same five fields; the drawing below it is what actually
 * differs between them.
 */
export function useVisualLook(song: Song): { colors: VisualColors; tuning: MotionTuning } {
  // A cover with no colour in it draws in its own greys with the accent's
  // rings; a song without a cover in its letter tile's hue.
  const tone = song.coverTone && hasColour(song.coverTone) ? song.coverTone : null
  const grey = song.coverTone && !tone ? song.coverTone.palette : null
  const accent = useAccentColor(grey !== null)
  const colors = useMemo(
    () =>
      grey
        ? colourlessColors(grey, hexToRgb(accent))
        : visualColors(
            tone?.hue ?? hueFromString(song.album || song.title),
            song.audioFeatures?.camelot,
            tone?.palette,
          ),
    [grey, accent, tone?.hue, tone?.palette, song.album, song.title, song.audioFeatures?.camelot],
  )
  const bpmKnown = song.audioFeatures?.bpm != null
  const tuning = useMemo(
    () => motionTuning(visualFeel(song.audioFeatures), bpmKnown),
    [song.audioFeatures, bpmKnown],
  )
  return { colors, tuning }
}
