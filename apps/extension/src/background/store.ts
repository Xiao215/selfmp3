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
  /**
   * Read, change and write one key with nothing getting in between.
   *
   * The replica's outbox is changed this way, and the worker is not the only
   * context of this origin: a popup open at the same moment would otherwise be
   * able to read the outbox, and the worker write over what it added — or hand
   * out the same log sequence number twice, the one thing the bucket's format
   * cannot survive. One IndexedDB transaction is what makes that impossible.
   */
  update(key: string, change: (current: unknown) => unknown): Promise<unknown>
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
    update: async (key, change) => {
      const db = await open()
      return new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        let next: unknown
        const request = store.get(key)
        request.onsuccess = () => {
          next = change((request.result as unknown) ?? null)
          store.put(next, key)
        }
        tx.oncomplete = () => resolve(next)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB update failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB update aborted'))
      })
    },
  }
}
