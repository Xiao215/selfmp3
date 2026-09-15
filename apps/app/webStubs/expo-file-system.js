// expo-file-system, as the web bundle sees it (metro.config.js resolves it here).
//
// expo-file-system has no web implementation: it warns "not supported on web"
// and its `File` throws `this.validatePath is not a function` on construction.
// Nearly every file that uses it has a `.web` sibling that keeps things in
// IndexedDB or the Cache API instead. src/offline/listenOutbox.ts has none, so
// in a browser it runs against this — inert, and honest about being empty
// rather than pretending files were written.

const NOT_HERE = 'no file system on web; this belongs behind the OfflineStore port'

export const Paths = {
  document: '/document',
  cache: '/cache',
}

export class File {
  constructor(...segments) {
    this.uri = segments.map(String).join('/')
  }

  // Readers answer "nothing is here", which is the truth on web until the port
  // exists, and is what every caller already handles for a cold cache.
  get exists() {
    return false
  }

  get size() {
    return 0
  }

  text() {
    return Promise.resolve('')
  }

  textSync() {
    return ''
  }

  // Writers are the dangerous half: silently accepting a write would make the
  // offline code believe a song is downloaded.
  write() {
    throw new Error(NOT_HERE)
  }

  create() {
    throw new Error(NOT_HERE)
  }

  // Deleting nothing is genuinely a no-op, so cleanup paths need not branch.
  delete() {}
}

export class Directory {
  constructor(...segments) {
    this.uri = segments.map(String).join('/')
  }

  get exists() {
    return false
  }

  create() {}

  delete() {}

  list() {
    return []
  }
}
