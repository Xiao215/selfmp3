import { File, Paths } from 'expo-file-system'
import { parseOutbox, type OutboxEvent } from '@selfmp3/shared'
import { createListenOutbox } from '@selfmp3/client'

import '../api/client'

/**
 * The phone's listen outbox: `packages/client`'s, over a JSON file.
 *
 * The rules moved to the package in phase 1 of the universal migration,
 * because the web app had the same file with the same rules over IndexedDB.
 * What is left is the file, which is genuinely the phone's.
 *
 * One JS thread, one copy: the file is only the durable mirror of `events`.
 */

const FILE_NAME = 'listen-outbox.json'

function outboxFile(): File {
  return new File(Paths.document, FILE_NAME)
}

let events: OutboxEvent[] | null = null
let loading: Promise<OutboxEvent[]> | null = null

function load(): Promise<OutboxEvent[]> {
  if (events) return Promise.resolve(events)
  loading ??= (async () => {
    try {
      const file = outboxFile()
      events = file.exists ? parseOutbox(JSON.parse(await file.text())) : []
    } catch {
      // An unreadable file loses what it held, but must not stop new plays.
      events = []
    }
    return events
  })()
  return loading
}

const outbox = createListenOutbox({
  read: () => load(),
  update: async change => {
    const next = change(await load())
    events = next
    try {
      outboxFile().write(JSON.stringify(next))
    } catch {
      // The next write carries everything again.
    }
    return next
  },
})

export const { flushListens, recordListen, loadPendingListens } = outbox

/*
 * `recordSkipListen` and `subscribePendingListens` are the package's too and
 * work here, but nothing on the phone calls them yet: there is no skip button
 * that records one and no badge that shows the count. The web app has both, and
 * the universal app will inherit them rather than have them written again.
 */
