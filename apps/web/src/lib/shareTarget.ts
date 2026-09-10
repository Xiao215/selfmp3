import { extractUrls } from '@selfmp3/shared'

/**
 * Reading a Web Share Target request.
 *
 * The manifest declares `/import?url=…&text=…&title=…`. What actually arrives
 * varies by app: the YouTube app on Android puts the link in `text` (often
 * with the video title in front of it), a browser puts it in `url`, and some
 * apps fill both. Whatever the shape, the import box wants the links, one per
 * line, and nothing else.
 */
export function sharedLinksFromQuery(search: string): string | null {
  const params = new URLSearchParams(search)
  const candidates = [params.get('url'), params.get('text'), params.get('title')]
  const urls = extractUrls(candidates.filter((v): v is string => !!v).join('\n'))
  return urls.length > 0 ? urls.join('\n') : null
}

/** The share-target query keys, so the view can strip them after reading. */
export const SHARE_PARAMS = ['url', 'text', 'title'] as const
