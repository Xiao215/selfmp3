import { serve } from '../bridge.js'
import { createHandlers, explain, storedServer } from './handlers.js'
import { idbStore } from './store.js'

/**
 * The extension's background worker: the one part of it that talks to a server
 * (docs/EXTENSION.md, "Shape").
 *
 * Chrome starts it for a message and stops it when it has been idle for a
 * while, so nothing here may count on staying alive: what has to outlast it is
 * in IndexedDB.
 */
const store = idbStore()

serve(createHandlers({ store, fetch: (input, init) => fetch(input, init) }), explain)

// A first install has nowhere to import to yet: open the page that says where.
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason !== 'install') return
  void storedServer(store).then(server => {
    if (!server) void chrome.runtime.openOptionsPage()
  })
})
