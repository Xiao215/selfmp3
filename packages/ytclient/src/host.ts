/**
 * `@selfmp3/ytclient/host`: what the app's own page loads
 * (docs/features/client-download.md) — the way to the extension, the songs
 * kept, and the sandbox frame that does the rest. Nothing here imports
 * youtubei.js or runs anything YouTube sends; that is the frame's
 * (sandbox/frame.ts), bundled apart into the app's `public/yt-sandbox.js`.
 */
export * from './transport.js'
export * from './keptSongs.js'
export * from './meta.js'
export * from './sandbox/host.js'
