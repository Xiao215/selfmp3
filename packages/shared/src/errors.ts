/**
 * What went wrong, as one line of text: an Error's message, or whatever else
 * was thrown, as a string. For logs and for the reasons a screen shows, on
 * the server, the desktop shell, the extension and the app alike.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The code a thrown error carries — Node's `ENOENT` or `EPIPE`, SQLite's
 * `SQLITE_FULL` — or undefined when it carries none. For the server and the
 * desktop shell, which act on what the system said rather than on its words.
 */
export function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
