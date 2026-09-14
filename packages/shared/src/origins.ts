/**
 * The installed Mac app's origin: `app://selfmp3`, the privileged scheme its
 * shell serves the page from (apps/desktop/src/main/protocol.ts).
 *
 * Named here because the server lets it through wherever it lets its own
 * pages through — CORS, and writes — the way the doorman already does. The
 * page asks a Mac from this origin whenever it talks to one directly, which a
 * browser flags as another site unless the Mac says otherwise.
 */
export const DESKTOP_APP_ORIGIN = 'app://selfmp3'
