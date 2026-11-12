import { start } from './videoIds.js'

/**
 * The entry point of the script the manifest puts into YouTube Music's own
 * world (videoIds.ts says why there is one). Apart from videoIds.ts so the
 * content script can share its attribute's name without starting it too: in
 * the content script's world the rows' data cannot be seen, and a second
 * stamper there would wipe what this one writes.
 */
start()
