import { DEFAULT_APP_URL } from '@selfmp3/shared'
import type { Handlers } from '../bridge.js'
import { serve, servePage } from '../bridge.js'
import { createCloud } from './cloud.js'
import { createHandlers, explain } from './handlers.js'
import { createPageHandler } from './pill.js'
import { installMenus, openPopupWindow } from './menus.js'
import { idbStore } from './store.js'
import { ALARM, ALARM_MINUTES, createWatcher } from './watcher.js'

/**
 * The extension's background worker: the one part of it that talks to a server
 * (docs/features/browser-extension.md, "Shape").
 *
 * Chrome starts it for a message, an alarm or a menu click, and stops it when it
 * has been idle, so nothing here may count on staying alive: what has to outlast
 * it is in IndexedDB.
 */

const store = idbStore()
/**
 * The bucket, built once: it holds this device's replica of the library, and
 * two of them would hand out the same log sequence number twice (cloud.ts).
 */
const cloud = createCloud(store, (input, init) => fetch(input, init))

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
  cloud,
})

serve(handlers, explain)
// The pill's channel, which learns nothing about the library but this one song.
servePage(createPageHandler(handlers), explain)

/**
 * A right-click import: the defaults, no questions, and the badge to follow it.
 *
 * With the server awake this reads the link first, so a song already in the
 * library is not fetched twice. With it asleep there is nothing to read the
 * link with, so the link itself goes in the bucket and the notice says so —
 * the same trade the popup makes (I3).
 */
async function quickImport(url: string): Promise<void> {
  try {
    const { mode } = await handlers.status({ type: 'status' })
    if (mode === 'bucket') {
      await handlers.requestImport({ type: 'requestImport', url, tagIds: [], playlistId: null })
      notify({
        title: 'Waiting for your server',
        message: 'Your server downloads it the next time it is awake.',
      })
      return
    }
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
  void chrome.tabs.create({ url: `${DEFAULT_APP_URL}/import` })
  void chrome.notifications.clear(id)
})

// A first install has nowhere to import to yet: open the page that says where.
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason !== 'install') return
  void handlers.status({ type: 'status' }).then(status => {
    if (status.mode === 'none') void chrome.runtime.openOptionsPage()
  })
})

/*
 * A worker started with something still in the outbox sends it now. The
 * replica's own timer fires 1.5 s after a write, and a worker Chrome stopped
 * before that leaves the change waiting for the next thing that opens the
 * library — which might be tomorrow.
 */
void cloud.flush().catch(() => {
  // Not signed in, or no network yet: the next wake tries again.
})
