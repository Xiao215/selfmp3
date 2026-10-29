/*
 * The sandbox frame runs YouTube's code, and whatever answers its requests
 * chooses that code. It is safe only where the app put it: an iframe with
 * `sandbox="allow-scripts"` and nothing else, whose origin is opaque — `'null'`.
 *
 * The same page is published with the web app, though, and any site can
 * frame it without a sandbox. There it would run with the app's own origin,
 * its storage and its self.mp3 session in reach, and the site that framed it
 * would be the one answering its requests. So the first thing the frame does,
 * before storage.ts or youtubei.js runs a line, is look: anywhere but an
 * opaque origin it stops here, and nothing after it runs.
 */
if (self.origin !== 'null') {
  throw new Error('the YouTube sandbox runs only in the frame the app makes for it')
}

export {}
