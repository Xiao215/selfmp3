import { Menu, app, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  APP_MENU_ITEMS,
  MENU_SECTIONS,
  MENU_SEPARATOR,
  MENU_STATE_AT_START,
  menuChecked,
  menuClickSends,
  menuCommandsIn,
  menuEnabled,
  type MenuCommand,
  type MenuEntry,
  type MenuState,
} from '@selfmp3/desktop-bridge'
import { REPOSITORY_URL } from '@selfmp3/shared'

import { sendCommand } from './commands.js'
import { check } from './updates.js'

/** What the page last said the checkmarks are; drawn into a menu built later too. */
let menuState: MenuState = MENU_STATE_AT_START

/**
 * The application menu.
 *
 * Without an Edit menu Electron gives a Mac app no ⌘C and no ⌘V at all, which
 * is the first thing anyone notices, so that comes first. The rest is
 * `packages/desktop-bridge`'s menu model: an item that sends a command the
 * contract does not know is a failing test there rather than a dead key here.
 *
 * Every section is drawn now that the page answers Playback's commands as well
 * as View's. An item marked `pageKeeps` is drawn with `registerAccelerator:
 * false`: the key is shown beside the label, and the page goes on handling it,
 * because a registered accelerator fires inside text fields too and Space would
 * never reach the search box again. On macOS that flag does nothing — a menu
 * acts on any key a text field leaves unhandled — so such an item also ignores
 * being chosen by its key, and only the pointer sends its command
 * (`menuClickSends`).
 *
 * Shuffle, Repeat's modes and Like carry checkmarks, kept as the page last
 * said (`setMenuState`): each is found by its command as its id and ticked in
 * place, so the menu is not rebuilt as the music plays.
 *
 * File's window items and View › Reload are the shell's own. On a Mac the red
 * button hides the window rather than closing it, so File › New Window (⇧⌘N;
 * ⌘N is New Playlist) is how it comes back without reaching for the Dock, and
 * Close Window (⌘W) is the red button's key. Reload is for a page that has got
 * itself stuck; it is the window's, not the page's, so it works however stuck
 * the page is.
 */
export function buildMenu(window_: () => BrowserWindow | null, showWindow: () => void): void {
  const mac = process.platform === 'darwin'

  const commandItem = (item: MenuCommand): Electron.MenuItemConstructorOptions => ({
    id: item.command,
    label: item.label,
    accelerator: item.accelerator,
    registerAccelerator: item.pageKeeps !== true,
    ...(item.check
      ? {
          type: item.check,
          checked: menuChecked(item.command, menuState),
          enabled: menuEnabled(item.command, menuState),
        }
      : {}),
    // `event` is missing when the item is clicked from code (the smoke).
    click: (_item: Electron.MenuItem, _window: unknown, event?: Electron.KeyboardEvent) => {
      if (!menuClickSends(item, event?.triggeredByAccelerator === true)) return
      sendCommand(window_(), item.command)
      // A checkbox ticks itself on a click; the page's answer is what it shows.
      if (item.check) setMenuState(menuState)
    },
  })
  const entry = (one: MenuEntry): Electron.MenuItemConstructorOptions =>
    one === MENU_SEPARATOR
      ? { type: 'separator' }
      : 'submenu' in one
        ? { label: one.label, submenu: one.submenu.map(commandItem) }
        : commandItem(one)
  // The operating system's own items, after a section's: File's New and Close Window, View's Reload and Full Screen.
  const roles: Readonly<Record<string, Electron.MenuItemConstructorOptions[]>> = {
    File: mac
      ? [
          { type: 'separator' },
          { label: 'New Window', accelerator: 'Shift+CmdOrCtrl+N', click: () => showWindow() },
          { role: 'close' },
        ]
      : [{ type: 'separator' }, { role: 'close' }, { type: 'separator' }, { role: 'quit' }],
    View: [
      { type: 'separator' },
      { role: 'reload' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
  const section = (one: (typeof MENU_SECTIONS)[number]): Electron.MenuItemConstructorOptions => ({
    label: one.title,
    submenu: [...one.items.map(entry), ...(roles[one.title] ?? [])],
  })

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              {
                label: 'Check for Updates…',
                // The same call Settings makes, so both see one answer. What it
                // can do about a newer version depends on the signing tier, and
                // the status says which — see src/main/updates.ts.
                click: () => void check(window_()),
              },
              { type: 'separator' as const },
              ...APP_MENU_ITEMS.map(item => ({
                label: item.label,
                accelerator: item.accelerator,
                click: () => sendCommand(window_(), item.command),
              })),
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    // File before Edit, as on every Mac.
    ...MENU_SECTIONS.filter(one => one.title === 'File').map(section),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    ...MENU_SECTIONS.filter(one => one.title !== 'File').map(section),
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'self.mp3 on GitHub',
          click: () => void shell.openExternal(REPOSITORY_URL),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Ticks the menu's settings as the player has them: called by the `setMenuState` handler. */
export function setMenuState(next: MenuState): void {
  menuState = next
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  for (const section of MENU_SECTIONS) {
    for (const item of menuCommandsIn(section.items)) {
      if (!item.check) continue
      const drawn = menu.getMenuItemById(item.command)
      if (!drawn) continue
      const on = menuChecked(item.command, next) === true
      // Electron's radio item takes any assignment to `checked` as "this one":
      // it unticks the rest of its group and ticks itself, false or not. So a
      // radio group is told only which of it is on.
      if (item.check !== 'radio' || on) drawn.checked = on
      drawn.enabled = menuEnabled(item.command, next)
    }
  }
}
