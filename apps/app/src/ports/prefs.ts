import { File, Paths } from 'expo-file-system'

/**
 * Small things this device remembers about itself, and that are nobody's
 * secret: which accent colour this screen wears, and whatever joins it later.
 *
 * The second port, and the same reason as the first (`secrets.ts`): the phone's
 * answer is `expo-file-system`, which has no web implementation at all — the
 * Metro config stubs it out of the browser bundle — so on the web every read
 * returned the default and every write vanished. That is not a small thing: the
 * accent picker in Settings appeared to work and then forgot, and the app came
 * up violet on the web while the same library was pink on the phone.
 *
 * Reads are synchronous on purpose. The accent is read during the first render
 * so the app never paints one colour and repaints to another a frame later, and
 * a promise cannot be read during a render.
 *
 * Values are opaque strings; what is in them is the caller's business. On
 * native each key is its own small file, which keeps `accent.json` exactly the
 * file — and exactly the contents — it has always been.
 */
export interface PrefStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

function fileFor(key: string): File {
  return new File(Paths.document, `${key}.json`)
}

export const prefs: PrefStore = {
  get: key => {
    try {
      const file = fileFor(key)
      return file.exists ? file.textSync() : null
    } catch {
      return null
    }
  },
  set: (key, value) => {
    try {
      fileFor(key).write(value)
    } catch {
      // A preference that cannot be saved still applies for this run.
    }
  },
}
