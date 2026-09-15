import { describe, expect, it } from 'vitest'
import { pageKeptCombinations } from '@selfmp3/desktop-bridge'

import { playbackKeys } from './playbackKeys'

describe('playbackKeys', () => {
  it('gives a browser tab Space for play and pause, and nothing else', () => {
    expect([...playbackKeys(false)]).toEqual([[' ', 'play-pause']])
  })

  it('leaves the browser its own keys: Back, Forward, changing tabs, ⌘K', () => {
    const keys = playbackKeys(false)
    for (const combination of [
      'meta+ArrowLeft',
      'meta+ArrowRight',
      'meta+alt+ArrowLeft',
      'meta+alt+ArrowRight',
      'meta+k',
      'ctrl+k',
    ]) {
      expect(keys.has(combination)).toBe(false)
    }
  })

  it('gives the installed app every key its menu leaves to the page', () => {
    expect([...playbackKeys(true)]).toEqual([...pageKeptCombinations()])
  })
})
