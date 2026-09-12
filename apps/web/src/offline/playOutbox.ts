import { createListenOutbox } from '@selfmp3/client'

import '../lib/api.js'
import { readStored, updateStored } from './mirror.js'

/**
 * The browser's listen outbox: `packages/client`'s, over IndexedDB.
 *
 * The rules moved to the package in phase 1 of the universal migration,
 * because the phone had the same file with the same rules over a JSON file.
 * What is left is the storage, which is genuinely the browser's, and the
 * exports the app already imported.
 */

const OUTBOX_KEY = 'listen-outbox'

const outbox = createListenOutbox({
  read: () => readStored(OUTBOX_KEY),
  // One IndexedDB transaction, so two tabs recording a play at the same moment
  // cannot lose one of them.
  update: change => updateStored(OUTBOX_KEY, change),
})

export const {
  flushListens,
  recordListen,
  recordSkipListen,
  subscribePendingListens,
  loadPendingListens,
} = outbox
