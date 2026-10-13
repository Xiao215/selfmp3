import { deleteStored, deleteStoredPrefix, readStored, writeStored } from '../ports/idbStore.web'
import type { RecordStore } from './recordStore'

/**
 * Small JSON records a browser keeps: IndexedDB keys `<kind>-<id>`, beside the
 * service worker's. The phone's twin keeps a folder of files
 * (`recordStore.ts`); the rules over either are `schemaCache.ts`.
 */
export function recordStore(kind: string): RecordStore {
  const key = (id: string): string => `${kind}-${id}`

  return {
    // No cheaper way to know than to read it.
    has: async id => (await readStored(key(id))) !== null,
    read: id => readStored(key(id)),
    write: (id, value) => writeStored(key(id), value),
    remove: id => deleteStored(key(id)),
    clear: () => deleteStoredPrefix(`${kind}-`),
  }
}
