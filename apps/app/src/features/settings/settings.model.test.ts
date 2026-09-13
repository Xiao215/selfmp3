import { describe, expect, it } from 'vitest'

import {
  accentName,
  activeSection,
  crossfadeLabel,
  healthLine,
  percentLabel,
  scanHint,
  sectionsFor,
} from './settings.model'

const TOPS = [
  { id: 'a', top: 0 },
  { id: 'b', top: 600 },
  { id: 'c', top: 1200 },
  { id: 'd', top: 1500 },
]

describe('settings', () => {
  it('leaves out the Mac sections for a library in the cloud', () => {
    const ids = sectionsFor(true).map(section => section.id)
    expect(ids).toContain('playback')
    expect(ids).not.toContain('importing')
    expect(ids).not.toContain('devices')
    expect(sectionsFor(false)).toHaveLength(10)
  })

  it('picks the last section past the reading line', () => {
    expect(activeSection(TOPS, 0, 800, 2400)).toBe('a')
    expect(activeSection(TOPS, 520, 800, 2400)).toBe('b')
  })

  it('gives the short last sections their turn over the final screenful', () => {
    // At the very bottom the line is the bottom edge, so the last section wins.
    expect(activeSection(TOPS, 1600, 800, 2400)).toBe('d')
    expect(activeSection([], 0, 800, 2400)).toBeNull()
  })

  it('words the rows', () => {
    expect(crossfadeLabel(0)).toBe('off')
    expect(crossfadeLabel(4)).toBe('4s')
    expect(percentLabel(0.55)).toBe('55%')
    expect(accentName(330, [{ hue: 330, name: 'Pink' }])).toBe('Pink')
    expect(accentName(30, [{ hue: 330, name: 'Pink' }])).toBe('Hue 30°')
  })

  it('says what it is connected to', () => {
    expect(healthLine(undefined)).toBe('Not connected to your library right now')
    expect(
      healthLine({
        ok: true,
        version: '1.0.0',
        uptimeSeconds: 5,
        storageDriver: 'local',
        songCount: 13,
      }),
    ).toBe('self.mp3 1.0.0 · 13 songs · local storage')
    expect(scanHint({ added: 1, updated: 2, removed: 0, total: 13, durationMs: 40 })).toBe(
      'Last scan found 13 songs — 1 new, 2 updated, 0 now missing.',
    )
  })
})
