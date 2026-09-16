import type { Handlers } from '../bridge.js'
import { serve, servePage } from '../bridge.js'
import { createHandlers, explain, storedServer } from './handlers.js'
import { createPageHandler } from './pill.js'
import { installMenus, openPopupWindow } from './menus.js'
import { idbStore } from './store.js'
import { ALARM, ALARM_MINUTES, createWatcher } from './watcher.js'

/**
 * The extension's background worker: the one part of it that talks to a server
 * (docs/EXTENSION.md, "Shape").
 *
 * Chrome starts it for a message, an alarm or a menu click, and stops it when it
 * has been idle, so nothing here may count on staying alive: what has to outlast
 * it is in IndexedDB.
 */

const store = idbStore()

const badge = async (text: string): Promise<void> => {
  await chrome.action.setBadgeText({ text })
  if (text) {
    // The app's accent, and its danger red for a failure.
    await chrome.action.setBadgeBackgroundColor({ color: text === '!' ? '#d4503f' : '#7b76e8' })
  }
}

const notify = (notice: { title: string; message: string }): void => {
  void chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-192.png'),
    title: notice.title,
    message: notice.message,
  })
}

/*
 * The watcher reads the queue through the handlers, and the handlers tell the
 * watcher what they started — so each is built with a reference to the other,
 * and the arrow below is what unties the knot.
 */
const watcher = createWatcher({
  store,
  queue: () => handlers.queue({ type: 'queue' }),
  badge,
  notify,
})

const handlers: Handlers = createHandlers({
  store,
  fetch: (input, init) => fetch(input, init),
  watcher,
})

serve(handlers, explain)
// The pill's channel, which learns nothing about the library but this one song.
servePage(createPageHandler(handlers), explain)

/** A right-click import: the defaults, no questions, and the badge to follow it. */
async function quickImport(url: string): Promise<void> {
  try {
    const preview = await handlers.preview({ type: 'preview', url })
    const items = preview.items.filter(item => !item.alreadyHave)
    if (items.length === 0) {
      notify({
        title: 'Already in your library',
        message: preview.items[0]?.title ?? 'Nothing new at that link.',
      })
      return
    }
    await handlers.enqueue({
      type: 'enqueue',
      request: { items, tagIds: [], playlistId: null, createPlaylistName: null },
      label: preview.kind === 'playlist' ? preview.playlistTitle : null,
    })
  } catch (error) {
    notify({ title: 'Could not import that link', message: explain(error).message })
  }
}

installMenus({ quickImport, openReview: openPopupWindow })

// The badge, kept right even when the worker was stopped in between.
void chrome.alarms.create(ALARM, { periodInMinutes: ALARM_MINUTES })
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void watcher.tick()
})
void watcher.tick()

chrome.notifications.onClicked.addListener(id => {
  void storedServer(store).then(server => {
    if (server) void chrome.tabs.create({ url: `${server.baseUrl}/import` })
    void chrome.notifications.clear(id)
  })
})

// A first install has nowhere to import to yet: open the page that says where.
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason !== 'install') return
  void storedServer(store).then(server => {
    if (!server) void chrome.runtime.openOptionsPage()
  })
})
