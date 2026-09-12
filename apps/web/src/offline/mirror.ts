import { LibrarySchema, type Library } from '@selfmp3/shared'

/**
 * The offline metadata mirror.
 *
 * The audio itself lives in the Cache API (see `audioCache.ts`); this stores
 * the library *metadata* in IndexedDB so the app can render its full song
 * list, tags and playlists with the server unreachable.
 *
 * Written as a hand-rolled IndexedDB wrapper rather than pulling in a library:
 * there are exactly three operations, and the promise wrapping is the only
 * genuinely awkward part.
 */

const DB_NAME = 'selfmp3'
/** sw.ts opens the same database with the same version and upgrade — change both together. */
const DB_VERSION = 1
const STORE = 'kv'
const LIBRARY_KEY = 'library-snapshot'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  /*
   * A failure is not remembered.
   *
   * The promise is cached so every reader shares one connection, but caching a
   * *rejected* one means a single bad moment — a private window, an upgrade
   * another tab was holding — locked this page out of its own storage for as
   * long as it stayed open, and even a fresh sign-in could not save anything.
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

async function put(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

async function get<T>(key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(key)
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
  })
}

/**
 * Read, change and write one key in a single transaction.
 *
 * IndexedDB runs read-write transactions on a store one at a time, across
 * every tab of the origin — so two tabs appending to the same list cannot
 * each read the old list and overwrite the other's addition.
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

export async function readStored(key: string): Promise<unknown> {
  return get<unknown>(key)
}

export async function writeStored(key: string, value: unknown): Promise<void> {
  await put(key, value)
}

export async function deleteStored(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
  })
}

/**
 * Store the library for offline use.
 *
 * Failures are swallowed on purpose. Private browsing, a full disk or a
 * storage quota can all make this fail, and none of them should stop the app
 * from working online.
 */
export async function saveLibrarySnapshot(library: Library): Promise<void> {
  try {
    await put(LIBRARY_KEY, { savedAt: Date.now(), library })
  } catch {
    // Offline mirroring is a nice-to-have, never a requirement.
  }
}

export async function loadLibrarySnapshot(): Promise<Library | null> {
  try {
    const stored = await get<{ savedAt: number; library: unknown }>(LIBRARY_KEY)
    if (!stored) return null
    // Validate rather than trust: a snapshot written by an older version of the
    // app could be missing fields the UI now assumes exist.
    const parsed = LibrarySchema.safeParse(stored.library)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(LIBRARY_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // Nothing to clear.
  }
}
