import { describe, expect, it } from 'vitest'

import {
  ALL_MENU_COMMANDS,
  MENU_SECTIONS,
  menuClickSends,
  menuOwnedCombinations,
  pageCombinations,
  pageKeptCombinations,
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

  it('leaves the keys a text field needs to the page', () => {
    // Space, and the ⌘-arrows that mean start and end of line on a Mac. A
    // registered accelerator would take these out of every input in the app.
    const kept = ALL_MENU_COMMANDS.filter(item => item.pageKeeps).map(item => item.accelerator)
    expect(kept).toEqual([
      'Space',
      'CmdOrCtrl+Right',
      'CmdOrCtrl+Left',
      'Alt+CmdOrCtrl+Right',
      'Alt+CmdOrCtrl+Left',
    ])
  })
})

describe('who owns which key', () => {
  it('claims the keys the menu really takes', () => {
    const owned = menuOwnedCombinations()
    expect(owned.has('meta+k')).toBe(true)
    expect(owned.has('ctrl+1')).toBe(true)
    expect(owned.has('meta+,')).toBe(true)
  })

  it('leaves the page-kept ones out, or the page would stop listening for them', () => {
    const owned = menuOwnedCombinations()
    for (const combination of pageKeptCombinations().keys())
      expect(owned.has(combination)).toBe(false)
  })

  it('hands the page a key for every command it kept', () => {
    expect(pageKeptCombinations().get(' ')).toBe('play-pause')
    expect(pageKeptCombinations().get('meta+ArrowRight')).toBe('next')
    expect(pageKeptCombinations().get('ctrl+alt+ArrowLeft')).toBe('seek-back')
  })

  it('divides every accelerator between the two, and gives none to both', () => {
    const owned = menuOwnedCombinations()
    const kept = pageKeptCombinations()
    const all = ALL_MENU_COMMANDS.flatMap(item =>
      item.accelerator ? [...pageCombinations(item.accelerator)] : [],
    )
    for (const combination of all) {
      expect(owned.has(combination) !== kept.has(combination)).toBe(true)
    }
  })

  /*
   * macOS: a menu acts on an item's key whenever the page leaves it unhandled,
   * whatever `registerAccelerator` says, and a text field leaves Space
   * unhandled. So a key the page keeps must never reach the page a second time
   * through the menu — only the pointer may choose those items.
   */
  it('sends nothing when a key chose an item the page keeps, on every platform', () => {
    for (const item of ALL_MENU_COMMANDS.filter(one => one.pageKeeps)) {
      expect(menuClickSends(item, true)).toBe(false)
      expect(menuClickSends(item, false)).toBe(true)
    }
  })

  it('sends every other item however it was chosen', () => {
    for (const item of ALL_MENU_COMMANDS.filter(one => !one.pageKeeps)) {
      expect(menuClickSends(item, true)).toBe(true)
      expect(menuClickSends(item, false)).toBe(true)
    }
  })

  it('so a command reaches the page once for any key, from the menu or the page', () => {
    const kept = pageKeptCombinations()
    for (const item of ALL_MENU_COMMANDS.filter(one => one.accelerator)) {
      const byMenu = menuClickSends(item, true)
      const byPage = pageCombinations(item.accelerator ?? '').some(combination =>
        kept.has(combination),
      )
      expect(byMenu !== byPage).toBe(true)
    }
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
