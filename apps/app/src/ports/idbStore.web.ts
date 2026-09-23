/**
 * Small things a browser keeps, in IndexedDB.
 *
 * IndexedDB rather than `localStorage` because the service worker reads the
 * same values (the cloud session and each song's files) to fetch a song from
 * the bucket, and a worker cannot see `localStorage` at all.
 */

const DB_NAME = 'selfmp3'
/** The service worker opens the same database with the same version and upgrade: change both together. */
const DB_VERSION = 1
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  /*
   * A failure is not remembered: a cached rejection would lock the page out of
   * its own storage after one bad moment (a private window, an upgrade another
   * tab was holding) for as long as it stayed open.
   */
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('could not open IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

/*
 * Every transaction below settles on the same three events. `abort` is the
 * one that is easy to leave out: a transaction the browser aborts (storage
 * pressure, a tab closing the database) fires neither `complete` nor `error`
 * on the request, and a promise waiting on those alone hangs forever — which
 * had sign-out, waiting on a delete, never finish.
 */

export async function readStored(key: string): Promise<unknown> {
  const db = await openDb()
  return new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(key)
    tx.oncomplete = () => resolve((request.result as unknown) ?? null)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read aborted'))
  })
}

export async function writeStored(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/**
 * Read, change and write one key in a single transaction.
 *
 * IndexedDB runs read-write transactions on a store one at a time across every
 * tab of the origin, so two tabs appending to the outbox cannot each read the
 * old one and overwrite the other's addition.
 */
export async function updateStored<T>(key: string, change: (current: unknown) => T): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    let next: T
    const request = store.get(key)
    request.onsuccess = () => {
      next = change(request.result)
      store.put(next, key)
    }
    tx.oncomplete = () => resolve(next)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB update failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB update aborted'))
  })
}

/** Every key that starts with `prefix`, gone in one transaction. */
export async function deleteStoredPrefix(prefix: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    // '￿' sorts after every character a key here is made of.
    tx.objectStore(STORE).delete(IDBKeyRange.bound(prefix, `${prefix}￿`))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
  })
}

export async function deleteStored(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
  })
}
