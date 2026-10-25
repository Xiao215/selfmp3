import { Menu, app, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { APP_MENU_ITEMS, MENU_SECTIONS, menuClickSends } from '@selfmp3/desktop-bridge'
import { REPOSITORY_URL } from '@selfmp3/shared'

import { sendCommand } from './commands.js'
import { check } from './updates.js'

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
 * File and View › Reload are the shell's own. On a Mac the red button hides the
 * window rather than closing it, so File › New Window (⌘N) is how it comes back
 * without reaching for the Dock, and Close Window (⌘W) is the red button's key.
 * Reload is for a page that has got itself stuck; it is the window's, not the
 * page's, so it works however stuck the page is.
 */
export function buildMenu(window_: () => BrowserWindow | null, showWindow: () => void): void {
  const mac = process.platform === 'darwin'

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
    {
      label: 'File',
      submenu: mac
        ? [
            { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => showWindow() },
            { type: 'separator' as const },
            { role: 'close' as const },
          ]
        : [{ role: 'close' as const }, { type: 'separator' as const }, { role: 'quit' as const }],
    },
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
    ...MENU_SECTIONS.map(section => ({
      label: section.title,
      submenu: [
        ...section.items.map(item => ({
          label: item.label,
          accelerator: item.accelerator,
          registerAccelerator: item.pageKeeps !== true,
          // `event` is missing when the item is clicked from code (the smoke).
          click: (_item: Electron.MenuItem, _window: unknown, event?: Electron.KeyboardEvent) => {
            if (!menuClickSends(item, event?.triggeredByAccelerator === true)) return
            sendCommand(window_(), item.command)
          },
        })),
        ...(section.title === 'View'
          ? [
              { type: 'separator' as const },
              { role: 'reload' as const },
              { type: 'separator' as const },
              { role: 'togglefullscreen' as const },
            ]
          : []),
      ],
    })),
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
