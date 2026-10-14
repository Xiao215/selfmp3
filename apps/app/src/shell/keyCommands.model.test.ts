import { describe, expect, it } from 'vitest'
import { ALL_MENU_COMMANDS, pageKeptCombinations } from '@selfmp3/desktop-bridge'

import { combinationOf, menuKeys, nativeKey } from './keyCommands.model'

describe('key commands', () => {
  it('spells a combination as a key command and back', () => {
    expect(nativeKey('meta+alt+ArrowLeft')).toEqual({
      input: 'ArrowLeft',
      modifiers: ['command', 'alternate'],
    })
    expect(nativeKey('meta+,')).toEqual({ input: ',', modifiers: ['command'] })
    expect(nativeKey(' ')).toEqual({ input: ' ', modifiers: [] })
    expect(nativeKey('Escape')).toEqual({ input: 'Escape', modifiers: [] })
    expect(nativeKey('meta++')).toEqual({ input: '+', modifiers: ['command'] })
    for (const combination of ['meta+k', 'meta+alt+ArrowDown', ' ', 'Escape', 'meta+1']) {
      expect(combinationOf(nativeKey(combination))).toBe(combination)
    }
  })

  it('reads a press in the order the web writes it, whatever order UIKit gave', () => {
    expect(combinationOf({ input: 'ArrowRight', modifiers: ['alternate', 'command'] })).toBe(
      'meta+alt+ArrowRight',
    )
    expect(combinationOf({ input: 'K', modifiers: ['command'] })).toBe('meta+k')
  })

  it('registers the menu’s keys with ⌘, each titled as its item', () => {
    const keys = menuKeys(ALL_MENU_COMMANDS)
    expect(keys.map(key => key.combination)).toEqual([
      'meta+,',
      'meta+1',
      'meta+2',
      'meta+3',
      'meta+k',
      ' ',
      'meta+ArrowRight',
      'meta+ArrowLeft',
      'meta+alt+ArrowRight',
      'meta+alt+ArrowLeft',
      'meta+ArrowUp',
      'meta+ArrowDown',
      'meta+alt+ArrowDown',
    ])
    expect(keys.find(key => key.command === 'search')?.title).toBe('Search')
    // Shuffle and Repeat have no key in the menu, so none here.
    expect(keys.some(key => key.command === 'shuffle')).toBe(false)
  })

  it('stands the page’s keys aside while typing and keeps the menu’s own', () => {
    const kept = pageKeptCombinations()
    for (const key of menuKeys(ALL_MENU_COMMANDS)) {
      expect(key.whileTyping).toBe(!kept.has(key.combination))
    }
    const space = menuKeys(ALL_MENU_COMMANDS).find(key => key.combination === ' ')
    expect(space?.whileTyping).toBe(false)
  })
})
