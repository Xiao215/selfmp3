/**
 * What the worker keeps: the server it imports through, and the library as the
 * popup needs it.
 *
 * IndexedDB, not `chrome.storage`: content scripts can read
 * `chrome.storage.local`, and content scripts run inside youtube.com. The
 * extension origin's IndexedDB is its own.
 */
export interface KeyValueStore {
  read(key: string): Promise<unknown>
  write(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

const STORE = 'kv'

export function idbStore(name = 'selfmp3-extension'): KeyValueStore {
  let opened: Promise<IDBDatabase> | null = null

  const open = (): Promise<IDBDatabase> =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('could not open IndexedDB'))
    }).catch((error: unknown) => {
      // Not remembered: one bad moment should not lock the worker out for good.
      opened = null
      throw error
    }))

  async function run(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    const db = await open()
    return new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = work(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'))
    })
  }

  return {
    read: async key => (await run('readonly', store => store.get(key))) ?? null,
    write: async (key, value) => {
      await run('readwrite', store => store.put(value, key))
    },
    remove: async key => {
      await run('readwrite', store => store.delete(key))
    },
  }
}
