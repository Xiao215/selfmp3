import { describe, expect, it } from 'vitest'

import {
  ALL_MENU_COMMANDS,
  MENU_SECTIONS,
  menuOwnedCombinations,
  pageCombinations,
} from './menu.js'
import { commandSchema } from './schemas.js'

describe('the menu model', () => {
  it('never gives one accelerator to two items', () => {
    const accelerators = ALL_MENU_COMMANDS.map(item => item.accelerator).filter(
      (one): one is string => one !== undefined,
    )
    expect(new Set(accelerators).size).toBe(accelerators.length)
  })

  it('only sends commands the contract knows', () => {
    for (const item of ALL_MENU_COMMANDS) {
      expect(commandSchema.safeParse(item.command).success).toBe(true)
    }
  })

  it('never gives one command to two items', () => {
    const commands = ALL_MENU_COMMANDS.map(item => item.command)
    expect(new Set(commands).size).toBe(commands.length)
  })

  it('labels every item', () => {
    for (const item of ALL_MENU_COMMANDS) expect(item.label.trim().length).toBeGreaterThan(0)
  })

  it('has a section for looking at things and one for playing them', () => {
    expect(MENU_SECTIONS.map(section => section.title)).toEqual(['View', 'Playback'])
  })
})

describe('pageCombinations', () => {
  it('spells CmdOrCtrl as both, because the page cannot tell which was pressed', () => {
    expect(pageCombinations('CmdOrCtrl+K')).toEqual(['meta+k', 'ctrl+k'])
  })

  it('uses KeyboardEvent.key names for the named keys', () => {
    expect(pageCombinations('Space')).toEqual([' '])
    expect(pageCombinations('CmdOrCtrl+Right')).toEqual(['meta+ArrowRight', 'ctrl+ArrowRight'])
  })

  it('puts the modifiers in the order useHotkeys builds them', () => {
    expect(pageCombinations('Alt+CmdOrCtrl+Down')).toEqual([
      'meta+alt+ArrowDown',
      'ctrl+alt+ArrowDown',
    ])
  })

  it('keeps a bare punctuation accelerator as itself', () => {
    expect(pageCombinations('CmdOrCtrl+,')).toEqual(['meta+,', 'ctrl+,'])
  })
})

describe('menuOwnedCombinations', () => {
  it('includes the palette, which the page also listens for', () => {
    const owned = menuOwnedCombinations()
    expect(owned.has('meta+k')).toBe(true)
    expect(owned.has('ctrl+k')).toBe(true)
  })

  it('leaves alone what the menu has no accelerator for', () => {
    expect(menuOwnedCombinations().has('meta+j')).toBe(false)
  })
})
