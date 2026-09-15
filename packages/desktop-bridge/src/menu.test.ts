import { describe, expect, it } from 'vitest'

import {
  ALL_MENU_COMMANDS,
  MENU_SECTIONS,
  acceleratorKeys,
  drawnMenuItem,
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
    for (const combination of pageKeptCombinations().keys()) expect(owned.has(combination)).toBe(false)
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
})

describe('the menu as each platform draws it', () => {
  const drawn = (platform: string) =>
    ALL_MENU_COMMANDS.map(item => ({ item, drawn: drawnMenuItem(item, platform) }))

  it('gives a page-kept item no key at all on macOS, and names the key in its label', () => {
    // A Mac menu acts on an item's key whenever the page leaves it unhandled,
    // and a text field leaves Space unhandled: typing a space played the music.
    const kept = drawn('darwin').filter(({ item }) => item.pageKeeps)
    expect(kept.map(({ drawn: one }) => one.label)).toEqual([
      'Play / Pause (space)',
      'Next (⌘→)',
      'Previous (⌘←)',
      'Seek forward (⌥⌘→)',
      'Seek back (⌥⌘←)',
    ])
    for (const { drawn: one } of kept) expect(one.accelerator).toBeUndefined()
  })

  it('shows a page-kept key without taking it everywhere else', () => {
    for (const platform of ['linux', 'win32']) {
      for (const { item, drawn: one } of drawn(platform).filter(({ item }) => item.pageKeeps)) {
        expect(one).toEqual({ label: item.label, accelerator: item.accelerator, registerAccelerator: false })
      }
    }
  })

  it('writes the key in a macOS label in the caps Settings draws', () => {
    for (const { item, drawn: one } of drawn('darwin').filter(({ item }) => item.pageKeeps)) {
      const { modifiers, key } = acceleratorKeys(item.accelerator ?? '')
      expect(one.label).toBe(`${item.label} (${[...modifiers, key].join('')})`)
    }
  })

  it('gives no key to both the macOS menu and the page', () => {
    const owned = menuOwnedCombinations()
    const kept = pageKeptCombinations()
    const taken = drawn('darwin').flatMap(({ drawn: one }) =>
      one.accelerator && one.registerAccelerator ? [...pageCombinations(one.accelerator)] : [],
    )
    // What the macOS menu really takes is exactly what the page stops listening for,
    for (const combination of taken) expect(owned.has(combination)).toBe(true)
    expect(new Set(taken)).toEqual(owned)
    // and nothing the page keeps is among it.
    for (const combination of kept.keys()) expect(taken).not.toContain(combination)
  })

  it('leaves every other item as the model has it', () => {
    for (const platform of ['darwin', 'linux']) {
      for (const { item, drawn: one } of drawn(platform).filter(({ item }) => !item.pageKeeps)) {
        expect(one.label).toBe(item.label)
        expect(one.accelerator).toBe(item.accelerator)
        expect(one.registerAccelerator).toBe(true)
      }
    }
  })
})

describe('acceleratorKeys', () => {
  it('draws a key the way a Mac does', () => {
    expect(acceleratorKeys('Alt+CmdOrCtrl+Right')).toEqual({ modifiers: ['⌥', '⌘'], key: '→' })
    expect(acceleratorKeys('CmdOrCtrl+Alt+Down')).toEqual({ modifiers: ['⌥', '⌘'], key: '↓' })
    expect(acceleratorKeys('CmdOrCtrl+k')).toEqual({ modifiers: ['⌘'], key: 'K' })
    expect(acceleratorKeys('Space')).toEqual({ modifiers: [], key: 'space' })
    expect(acceleratorKeys('CmdOrCtrl+,')).toEqual({ modifiers: ['⌘'], key: ',' })
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
