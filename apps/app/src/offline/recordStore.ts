import { Directory, File, Paths } from 'expo-file-system'

/**
 * Small JSON records a phone keeps, a folder of them per kind, one file per
 * record: `<documents>/<kind>/<id>.json`. The browser's twin keeps them in
 * IndexedDB (`recordStore.web.ts`); the rules over either are `schemaCache.ts`.
 *
 * The documents folder, not the cache one: these are what the app opens with
 * on a plane, and the system clearing them for room would be the app
 * forgetting its library at the worst moment.
 */
export interface RecordStore {
  /** Whether a record is there, without reading it where that is cheaper. */
  has(id: string): Promise<boolean>
  /** The record as it was written, or null when there is none. Rejects when it is not JSON. */
  read(id: string): Promise<unknown>
  write(id: string, value: unknown): Promise<void>
  remove(id: string): Promise<void>
  /** Every record of this kind. */
  clear(): Promise<void>
}

export function recordStore(kind: string): RecordStore {
  const folder = (): Directory => new Directory(Paths.document, kind)
  const file = (id: string): File => new File(folder(), `${id}.json`)

  return {
    // A file check is synchronous: a pass over every kept song never waits on it.
    has: async id => file(id).exists,

    async read(id) {
      const record = file(id)
      if (!record.exists) return null
      return JSON.parse(await record.text()) as unknown
    },

    async write(id, value) {
      folder().create({ intermediates: true, idempotent: true })
      file(id).write(JSON.stringify(value))
    },

    async remove(id) {
      const record = file(id)
      if (record.exists) record.delete()
    },

    async clear() {
      const directory = folder()
      if (directory.exists) directory.delete()
    },
  }
}
