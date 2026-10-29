/**
 * What the phone app imports (`@selfmp3/ytclient/phone`): its side of the
 * hidden YouTube page (webview/), and the kept songs. Like `./host`, nothing
 * here loads youtubei.js or runs anything YouTube sends; that is the page's.
 */
export * from './webview/app.js'
export { WEBVIEW_RECEIVE } from './webview/protocol.js'
export { withKeptSongs } from './keptSongs.js'
export { metaHeader } from './meta.js'
