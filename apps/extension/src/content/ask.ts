import type { PageReplies, PageRequest } from '../bridge.js'

/**
 * How the content script asks the worker, without zod.
 *
 * The worker checks everything that arrives from a page — that is the side with
 * the token and the server's address to protect — so checking it again here
 * would only put 60 KB of schema into every YouTube page for nothing.
 */

type PageReply<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

export async function askPage<R extends PageRequest>(
  request: R,
): Promise<PageReply<PageReplies[R['type']]>> {
  try {
    const reply: unknown = await chrome.runtime.sendMessage(request)
    if (reply && typeof reply === 'object' && 'ok' in reply) {
      return reply as PageReply<PageReplies[R['type']]>
    }
    return { ok: false, message: 'The extension did not answer.' }
  } catch {
    // The extension was reloaded or updated under the page: the pill stops
    // rather than throwing into YouTube's own console.
    return { ok: false, message: 'The extension is not there any more.' }
  }
}
