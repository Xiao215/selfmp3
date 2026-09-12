// Spike-only stand-in for expo-file-system in the web bundle.
//
// expo-file-system has no web implementation: it warns "not supported on web"
// and its `File` throws `this.validatePath is not a function` on construction.
// Six files in apps/app build a `File` or a `Directory` at module scope
// (src/offline/*, src/cloud/nativePlatform.ts, src/ui/accent.tsx), so the app
// crashes on web before any screen renders. That is the single reason the phone
// app cannot simply be exported to the browser today.
//
// docs/UNIVERSAL.md already answers it: phase 3 puts all of this behind the
// OfflineStore port, whose web implementation is apps/web's existing Cache API
// and IndexedDB code. Until then the spike needs the app to *boot* on web so
// check 4 can measure the audio engine, so this shim stands in — inert, and
// honest about being empty rather than pretending files were written.

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
