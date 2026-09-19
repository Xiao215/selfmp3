import { describe, expect, it } from 'vitest'
import { rgbToOklch, type AudioFeatures } from '@selfmp3/shared'

import {
  autoVisual,
  beatKick,
  beatPhase,
  groundHue,
  horizonColors,
  keyedHue,
  KEY_PULL,
  loudnessLevel,
  motionCaption,
  parseVisualChoices,
  rippleDisc,
  sunPlace,
  synthLevels,
  visualCaption,
  visualColors,
  visualFeel,
  withVisualChoice,
} from './visuals.model'

const features = (over: Partial<AudioFeatures>): AudioFeatures => ({
  bpm: 120,
  energy: 0.5,
  loudnessLufs: -12,
  key: 'A minor',
  camelot: '8A',
  danceability: 0.4,
  analyzedAt: '2026-09-01T00:00:00Z',
  version: 1,
  ...over,
})

describe('which visual a song gets', () => {
  it('gives Horizon to a song not analysed yet, or with no energy', () => {
    expect(autoVisual(null)).toBe('horizon')
    expect(autoVisual(undefined)).toBe('horizon')
    expect(autoVisual(features({ energy: null }))).toBe('horizon')
  })

  it('gives Horizon to a calm song and Ripples from half energy up, whatever the beat', () => {
    expect(autoVisual(features({ energy: 0.49, danceability: 0.9 }))).toBe('horizon')
    expect(autoVisual(features({ energy: 0.5, danceability: 0.1 }))).toBe('ripples')
    expect(autoVisual(features({ energy: 0.95, danceability: null }))).toBe('ripples')
  })
})

describe('a choice kept for one song', () => {
  it('reads only what it understands', () => {
    expect(parseVisualChoices(null)).toEqual({})
    expect(parseVisualChoices('not json')).toEqual({})
    expect(parseVisualChoices('[1,2]')).toEqual({})
    expect(parseVisualChoices('{"4":"ripples","5":"ring","6":3}')).toEqual({ '4': 'ripples' })
  })

  it('drops a style that no longer exists, so the song goes back to Auto', () => {
    expect(parseVisualChoices('{"4":"aurora","5":"horizon"}')).toEqual({ '5': 'horizon' })
  })

  it('sets a choice, and clears it back to automatic', () => {
    const chosen = withVisualChoice({ '4': 'ripples' }, 9, 'horizon')
    expect(chosen).toEqual({ '4': 'ripples', '9': 'horizon' })
    expect(withVisualChoice(chosen, 4, null)).toEqual({ '9': 'horizon' })
  })
})

describe('the caption', () => {
  it('says there are no lyrics, then the tempo and key it knows', () => {
    expect(visualCaption(features({ bpm: 139.6, key: 'A minor' }))).toBe(
      'No lyrics · 140 BPM · A minor',
    )
    expect(visualCaption(features({ bpm: null, key: 'C major' }))).toBe('No lyrics · C major')
    expect(visualCaption(null)).toBe('No lyrics')
  })
})

describe('what the visual follows', () => {
  it('names the sound, the song or the tempo', () => {
    expect(motionCaption('live')).toBe('Following the sound')
    expect(motionCaption('curve')).toBe('Following the song')
    expect(motionCaption('beat')).toBe('Following the tempo')
  })
})

describe('colour from the key', () => {
  it('pulls a minor key cooler and a major key warmer, by a nudge', () => {
    expect(keyedHue(200, '8A')).toBe(200 + KEY_PULL)
    expect(keyedHue(100, '8B')).toBe(100 - KEY_PULL)
    expect(keyedHue(60, '3B')).toBe(45)
    expect(keyedHue(250, '1A')).toBe(250)
  })

  it('goes the short way round the wheel, and leaves an unknown key alone', () => {
    expect(keyedHue(350, '8B')).toBe(10)
    expect(keyedHue(-10, null)).toBe(350)
    expect(keyedHue(120, undefined)).toBe(120)
  })

  it('draws light inks on a dark ground', () => {
    const colors = visualColors(30, '8B')
    const light = (rgb: readonly number[]): number => rgb.reduce((sum, v) => sum + v, 0) / 3
    for (const ink of colors.inks) expect(light(ink)).toBeGreaterThan(120)
    expect(light(colors.ground[0])).toBeLessThan(70)
    expect(light(colors.ground[1])).toBeLessThan(light(colors.ground[0]))
  })
})

describe('colour from the cover’s palette', () => {
  /** Genshin's cover as analysed: cream light, lilac sky, blue water, grass, a dark teal shade. */
  const genshin = [
    { l: 0.89, c: 0.02, h: 63, share: 0.27 },
    { l: 0.76, c: 0.02, h: 317, share: 0.25 },
    { l: 0.62, c: 0.05, h: 268, share: 0.19 },
    { l: 0.48, c: 0.05, h: 147, share: 0.11 },
    { l: 0.69, c: 0.12, h: 130, share: 0.1 },
    { l: 0.28, c: 0.03, h: 193, share: 0.08 },
  ]
  const light = (rgb: readonly number[]): number => rgb.reduce((sum, v) => sum + v, 0) / 3
  const spread = (rgb: readonly number[]): number => Math.max(...rgb) - Math.min(...rgb)

  it('keeps a dark ground out of olive', () => {
    expect(groundHue(95)).toBe(160)
    expect(groundHue(80)).toBe(40)
    expect(groundHue(262)).toBe(262)
    expect(groundHue(30)).toBe(30)
  })

  it('draws a quiet dark ground and three different light inks from a cover’s colours', () => {
    const colors = visualColors(129, '11B', genshin)
    expect(light(colors.ground[0])).toBeLessThan(60)
    expect(light(colors.ground[1])).toBeLessThan(light(colors.ground[0]))
    // Quiet: the ground is barely coloured, where the olive one was plainly yellow-green.
    expect(spread(colors.ground[0])).toBeLessThan(30)
    for (const ink of colors.inks) expect(light(ink)).toBeGreaterThan(110)
    const [a, b, c] = colors.inks.map(ink => ink.join())
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('gives the sun and the disc’s middle the lightest ink, as the eye sees lightness', () => {
    // Perceived lightness, not an RGB average: a vivid green ring averages high and looks darker.
    const lightness = ([r, g, b]: readonly number[]): number => rgbToOklch(r ?? 0, g ?? 0, b ?? 0).l
    const colors = visualColors(129, '11B', genshin)
    expect(lightness(colors.inks[2])).toBeGreaterThan(lightness(colors.inks[0]))
    expect(lightness(colors.inks[2])).toBeGreaterThan(lightness(colors.inks[1]))
  })

  it('draws as it always did when a cover has no palette yet', () => {
    expect(visualColors(30, '8B', undefined)).toEqual(visualColors(30, '8B'))
    expect(visualColors(30, '8B', [])).toEqual(visualColors(30, '8B'))
  })
})

describe('motion from the song', () => {
  it('fills in a middling feel for what is not analysed, and keeps tempo drawable', () => {
    expect(visualFeel(null)).toEqual({ bpm: 96, energy: 0.45, loudness: 0.5 })
    expect(visualFeel(features({ bpm: 260 })).bpm).toBe(200)
    expect(visualFeel(features({ bpm: 30 })).bpm).toBe(50)
  })

  it('reads loudness from quiet to a loud master', () => {
    expect(loudnessLevel(-30)).toBe(0)
    expect(loudnessLevel(-18)).toBe(0.5)
    expect(loudnessLevel(-2)).toBe(1)
    expect(loudnessLevel(null)).toBe(0.5)
  })

  it('finds the beat from the position and the tempo', () => {
    expect(beatPhase(0, 120)).toBe(0)
    expect(beatPhase(0.25, 120)).toBeCloseTo(0.5)
    expect(beatPhase(1, 120)).toBeCloseTo(0)
    expect(beatKick(0)).toBe(1)
    expect(beatKick(0.9)).toBeLessThan(0.02)
  })

  it('builds stand-in bands whose bass lands on the beat', () => {
    const onBeat = synthLevels(24, 10, 120, 0.8)
    const offBeat = synthLevels(24, 10.3, 120, 0.8)
    expect(onBeat).toHaveLength(24)
    for (const level of onBeat) {
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
    }
    expect(onBeat[0]!).toBeGreaterThan(offBeat[0]!)
  })
})

describe('drawing Horizon and Ripples', () => {
  const colors = visualColors(210, null)
  const lightness = ([r, g, b]: readonly number[]): number => rgbToOklch(r ?? 0, g ?? 0, b ?? 0).l

  it('draws Horizon only in colours made from the song’s', () => {
    const look = horizonColors(colors)
    expect(look.sun).toEqual(colors.inks[2])
    expect(look.sky[0]).toEqual(colors.ground[1])
    expect(look.foot).toEqual(colors.ground[1])
    // The horizon glows brighter than the sky above it, and the hills darken as they come nearer.
    expect(lightness(look.sky[2])).toBeGreaterThan(lightness(look.sky[1]))
    expect(lightness(look.hills[0])).toBeGreaterThan(lightness(look.hills[1]))
    expect(lightness(look.hills[1])).toBeGreaterThan(lightness(look.hills[2]))
  })

  it('puts the sun in the middle on a phone and to the right on a wide screen', () => {
    expect(sunPlace(390, 844).x).toBe(195)
    expect(sunPlace(1280, 800).x).toBeGreaterThan(640)
    expect(sunPlace(390, 844).d).toBeLessThan(390 / 2)
  })

  it('keeps Ripples’ disc inside the shorter side', () => {
    expect(rippleDisc(390, 500)).toBe(195)
    expect(rippleDisc(1280, 400)).toBe(200)
  })
})
