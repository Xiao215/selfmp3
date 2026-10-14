import { describe, expect, it } from 'vitest'
import { ALL_MENU_COMMANDS } from '@selfmp3/desktop-bridge'

import { acceleratorKeys, listShortcutRows, shortcutRows } from './shortcuts.model'

describe('keyboard shortcuts', () => {
  it('draws a key the way a Mac does', () => {
    expect(acceleratorKeys('Alt+CmdOrCtrl+Right')).toEqual({ modifiers: ['⌥', '⌘'], key: '→' })
    expect(acceleratorKeys('CmdOrCtrl+Alt+Down')).toEqual({ modifiers: ['⌥', '⌘'], key: '↓' })
    expect(acceleratorKeys('CmdOrCtrl+k')).toEqual({ modifiers: ['⌘'], key: 'K' })
    expect(acceleratorKeys('Space')).toEqual({ modifiers: [], key: 'space' })
    expect(acceleratorKeys('CmdOrCtrl+,')).toEqual({ modifiers: ['⌘'], key: ',' })
  })

  it('lists the menu’s own keys, related ones on one row', () => {
    const rows = shortcutRows(ALL_MENU_COMMANDS)
    expect(rows.map(row => `${row.keys.join(' ')} ${row.label}`)).toEqual([
      'space Play / pause',
      '⌘ ← → Previous / next',
      '⌥ ⌘ ← → Seek 10 s',
      '⌘ ↑ ↓ Volume',
      '⌥ ⌘ ↓ Mute',
      '⌘ K Search',
      '⌘ 1–3 Library · Playlists · Now playing',
      '⌘ , Settings',
    ])
  })

  it('leaves out what has no key, and keeps caps apart when modifiers differ', () => {
    expect(shortcutRows([{ command: 'shuffle' }])).toEqual([])
    expect(
      shortcutRows([
        { command: 'previous', accelerator: 'CmdOrCtrl+Left' },
        { command: 'next', accelerator: 'Alt+Right' },
      ]),
    ).toEqual([{ keys: ['⌘', '←', '⌥', '→'], label: 'Previous / next' }])
  })

  it('lists a song list’s keys, drawn as the menu’s are', () => {
    expect(listShortcutRows(true).map(row => `${row.keys.join(' ')} ${row.label}`)).toEqual([
      'tab Into or out of the list of songs',
      '↑ ↓ Move between songs',
      '← → Move between a song’s buttons',
      'space ↵ Tick / play the song you moved to',
      '⇧ F10 Open the song’s menu',
      '⌘ A Select all songs',
      'esc Clear the selection',
    ])
  })

  it('leaves out the keys that need a row the keyboard is on, which an iPad has not', () => {
    expect(listShortcutRows(false).map(row => `${row.keys.join(' ')} ${row.label}`)).toEqual([
      '⌘ A Select all songs',
      'esc Clear the selection',
    ])
  })
})
