import { describe, expect, it } from 'vitest'
import { ALL_MENU_COMMANDS } from '@selfmp3/desktop-bridge'

import { shortcutRows } from './shortcuts.model'

describe('keyboard shortcuts', () => {
  it('lists the menu’s own keys, related ones on one row', () => {
    const rows = shortcutRows(ALL_MENU_COMMANDS)
    expect(rows.map(row => `${row.keys.join(' ')} ${row.label}`)).toEqual([
      'space Play / pause',
      '⌘ ← → Previous / next',
      '⌥ ⌘ ← → Seek 10 s',
      '⌘ ↑ ↓ Volume',
      '⌥ ⌘ ↓ Mute',
      '⌘ K Search',
      '⌘ 1–3 Library · Playlists · Now Playing',
      '⌘ P Practice panel',
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
})
