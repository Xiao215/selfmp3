/**
 * What went wrong, as one line of text: an Error's message, or whatever else
 * was thrown, as a string. For logs and for the reasons a screen shows.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
