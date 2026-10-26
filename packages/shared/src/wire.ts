/**
 * `@selfmp3/shared/wire`: the part of this package with no schema in it, for
 * what has to stay small — the service worker (apps/app/sw/sw.ts), which
 * esbuild bundles on its own, and the desktop bridge, which the preload
 * carries. Everything here is also exported from `@selfmp3/shared` itself.
 */

export * from './apiWire.js'
export * from './doormanWire.js'
export * from './origins.js'
export * from './range.js'
export { plainPageAt } from './publicPage.js'
