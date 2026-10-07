import { createListenOutbox } from '@selfmp3/client'

import { readStored, updateStored } from '../ports/idbStore.web'

/**
 * A browser's listen outbox: `packages/client`'s, over IndexedDB.
 *
 * The phone keeps it as a JSON file (`listenOutbox.ts`); a browser has no files
 * to keep, and a play counted while the server was away used to live only in
 * memory and be gone at the next reload. IndexedDB keeps it, and changes it in
 * one transaction, which other tabs of the same app wait their turn for — two
 * tabs counting plays at once cannot each write over the other's.
 *
 * Reading what is stored, and falling back to memory where IndexedDB refuses
 * (a private window), are the package's.
 */
const OUTBOX_KEY = 'listen-outbox'

const outbox = createListenOutbox({
  read: () => readStored(OUTBOX_KEY),
  update: change => updateStored(OUTBOX_KEY, change),
})

export const { flushListens, recordListen } = outbox
