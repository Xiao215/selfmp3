/**
 * The installed desktop app's origin: `app://selfmp3`, the privileged scheme its
 * shell serves the page from (apps/desktop/src/main/protocol.ts).
 *
 * Named here because the server lets it through wherever it lets its own
 * pages through — CORS, and writes — the way the doorman already does. The
 * page asks a server from this origin whenever it talks to one directly, which a
 * browser flags as another site unless the server says otherwise.
 */
export const DESKTOP_APP_ORIGIN = 'app://selfmp3'

/**
 * The browser extension's id (apps/extension). Chrome derives an id from the
 * public key an extension carries, and the extension's manifest commits one, so
 * this id is the same on every install and no other extension can arrive with
 * it (docs/features/browser-extension.md).
 */
export const EXTENSION_ID = 'ojgfoohmmkangonahnbdpelfgmkjkfpi'

/**
 * The extension's origin. Chrome attaches it to every write the extension
 * sends, from its background worker as much as from its pages, so the server
 * lets it through beside the desktop app's.
 */
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`

/**
 * The port the server listens on unless told otherwise. Clients that guess at a
 * local server — the CLI, the extension's "on this computer" hint — have to
 * guess the same number the server picks, so it is written once here.
 */
export const DEFAULT_SERVER_PORT = 4600

/** Where a server on this computer, left on its default port, is listening. */
export const DEFAULT_LOCAL_SERVER_URL = `http://localhost:${DEFAULT_SERVER_PORT}`
