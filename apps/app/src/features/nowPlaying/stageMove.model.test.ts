import { describe, expect, it } from 'vitest'
import { stageGeometry } from './nowPlaying.model'
import {
  COVER_TOP,
  coverPose,
  laidOutRadius,
  moveKeyframes,
  stackedTabsTop,
  stageCover,
  wordsFrame,
  wordsPose,
  type MovePose,
} from './stageMove.model'

const WIDTH = 1400
const HEIGHT = 816
const g = stageGeometry(WIDTH, HEIGHT)
const box = stageCover(g)

/** The box a transformed cover is seen in: scaled about its centre, then moved. */
function seenCover(pose: MovePose, from = box): { left: number; top: number; size: number } {
  const scale = pose.scale ?? 1
  const size = from.size * scale
  const centreX = from.left + from.size / 2 + (pose.translateX ?? 0)
  const centreY = from.top + from.size / 2 + (pose.translateY ?? 0)
  return { left: centreX - size / 2, top: centreY - size / 2, size }
}

describe('stageCover', () => {
  it('puts the cover at the top of the left column, lyrics or none', () => {
    expect(box).toEqual({ left: g.pad, top: COVER_TOP, size: g.cover })
  })
})

describe('coverPose', () => {
  it('leaves the cover where the stage lays it out', () => {
    expect(seenCover(coverPose(box, 0))).toEqual({ left: g.pad, top: COVER_TOP, size: g.cover })
    expect(coverPose(box, 0).radius).toBe(22)
  })

  it('shrinks it into the header in Focus', () => {
    const seen = seenCover(coverPose(box, 1))
    expect(seen.left).toBeCloseTo(64)
    expect(seen.top).toBeCloseTo(10)
    expect(seen.size).toBeCloseTo(40)
    expect(coverPose(box, 1).radius).toBe(10)
  })

  it('moves its edges on the same straight line the animated layout did', () => {
    for (const m of [0.25, 0.5, 0.8]) {
      const seen = seenCover(coverPose(box, m))
      expect(seen.left).toBeCloseTo(g.pad + (64 - g.pad) * m)
      expect(seen.top).toBeCloseTo(COVER_TOP + (10 - COVER_TOP) * m)
      expect(seen.size).toBeCloseTo(g.cover + (40 - g.cover) * m)
    }
  })

  it('lays out corners that are seen at the right radius once scaled', () => {
    const pose = coverPose(box, 1)
    expect((laidOutRadius(pose) ?? 0) * (pose.scale ?? 1)).toBeCloseTo(10)
    expect(laidOutRadius({ opacity: 1 })).toBeUndefined()
  })
})

describe('wordsPose', () => {
  it('is still wherever the column is laid out for its mode', () => {
    expect(wordsPose(WIDTH, g, false, 0)).toEqual({ translateX: 0, translateY: 0 })
    expect(wordsPose(WIDTH, g, true, 1)).toEqual({ translateX: 0, translateY: 0 })
  })

  it('starts from where the other mode had the column', () => {
    const stage = wordsFrame(WIDTH, g, 0)
    const focus = wordsFrame(WIDTH, g, 1)
    // Just switched to Focus: laid out wide, still seen at the stage's left.
    expect(wordsPose(WIDTH, g, true, 0)).toEqual({
      translateX: stage.left - focus.left,
      translateY: stage.top - focus.top,
    })
    // And back again.
    expect(wordsPose(WIDTH, g, false, 1)).toEqual({
      translateX: focus.left - stage.left,
      translateY: focus.top - stage.top,
    })
  })
})

describe('moveKeyframes', () => {
  it('needs only the two ends for a straight move', () => {
    const frames = moveKeyframes(m => ({ opacity: 1 - m }), 0, 1)
    expect(frames).toEqual([
      { offset: 0, transform: 'translateX(0px) translateY(0px) scale(1)', opacity: 1 },
      { offset: 1, transform: 'translateX(0px) translateY(0px) scale(1)', opacity: 0 },
    ])
  })

  it('starts from part-way through when a move is turned round', () => {
    const frames = moveKeyframes(m => ({ opacity: m }), 0.4, 0)
    expect(frames[0]?.opacity).toBeCloseTo(0.4)
    expect(frames[1]?.opacity).toBe(0)
  })

  it('samples a radius under a changing scale, since that is not a straight line', () => {
    const frames = moveKeyframes(m => coverPose(box, m), 0, 1)
    expect(frames.length).toBeGreaterThan(2)
    for (const frame of frames) {
      const pose = coverPose(box, frame.offset)
      expect(frame.borderRadius).toBe(`${laidOutRadius(pose)}px`)
    }
  })
})

describe('a stacked page (T05)', () => {
  const tall = stageGeometry(834, 1110, 24)

  it('starts the cover under the status bar, and the words under the row of tabs', () => {
    expect(stageCover(tall).top).toBe(COVER_TOP + 24)
    const words = wordsFrame(834, tall, 0)
    expect(words.left).toBe(tall.pad)
    expect(words.top).toBeGreaterThan(stackedTabsTop(tall))
  })

  it('moves the cover into the header under the status bar in Focus', () => {
    const cover = stageCover(tall)
    expect(seenCover(coverPose(cover, 1, 24), cover).top).toBeCloseTo(10 + 24)
  })
})
