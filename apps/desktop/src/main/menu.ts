import { Menu, app, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { APP_MENU_ITEMS, MENU_SECTIONS } from '@selfmp3/desktop-bridge'

import { sendCommand } from './ipc.js'

/**
 * The application menu.
 *
 * Without an Edit menu Electron gives a Mac app no ⌘C and no ⌘V at all, which
 * is the first thing anyone notices, so that comes first. The rest is
 * `packages/desktop-bridge`'s menu model: an item that sends a command the
 * contract does not know is a failing test there rather than a dead key here.
 *
 * Only the sections in `DRAWN` are built. The model holds the whole menu the
 * plan settled, and Playback's items need a player the page has not been wired
 * to yet — that is phase 4, together with the media session port. A menu item
 * that does nothing is worse than one that is not there, so it waits.
 */
const DRAWN: ReadonlySet<string> = new Set(['View'])
export function buildMenu(window_: () => BrowserWindow | null): void {
  const mac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
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
    ...MENU_SECTIONS.filter(section => DRAWN.has(section.title)).map(section => ({
      label: section.title,
      submenu: [
        ...section.items.map(item => ({
          label: item.label,
          accelerator: item.accelerator,
          click: () => sendCommand(window_(), item.command),
        })),
        ...(section.title === 'View'
          ? [{ type: 'separator' as const }, { role: 'togglefullscreen' as const }]
          : []),
      ],
    })),
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'self.mp3 on GitHub',
          click: () => void shell.openExternal('https://github.com/Xiao215/selfmp3'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
