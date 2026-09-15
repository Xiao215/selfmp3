import { File, Paths } from 'expo-file-system'
import { parseOutbox, type OutboxEvent } from '@selfmp3/shared'
import { createListenOutbox } from '@selfmp3/client'

import '../api/client'

/**
 * The phone's listen outbox: `packages/client`'s, over a JSON file.
 *
 * The rules live in the package because every client enforces the same rules,
 * each over its own storage. What is left here is the file itself, which is
 * the phone's: in a browser expo-file-system is the stand-in in webStubs/.
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
 * work here, but nothing calls them yet: there is no skip button that records
 * one and no badge that shows the count.
 */
