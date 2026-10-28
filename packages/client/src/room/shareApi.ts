import {
  DOORMAN_PATHS,
  formatShareStart,
  ShareLinkSchema,
  ShareSummariesSchema,
  type DoormanFetch,
  type RoomFilePart,
  type ShareAction,
  type ShareCreate,
  type ShareLink,
  type ShareSummary,
} from '@selfmp3/shared'
import { doormanSend } from './send.js'

/**
 * Share links on the doorman, from a device (docs/features/share-links.md;
 * the doorman's shareRoutes.ts). Making one and your lists need you signed
 * in; opening one, playing it and asking for it again do not, though a
 * session is sent when there is one, so the link is remembered as yours.
 */
interface ShareApi {
  create(session: string, input: ShareCreate): Promise<ShareLink>
  /** The links you sent, newest first. */
  sent(session: string): Promise<ShareSummary[]>
  /** The ones you opened signed in: Home's From friends. */
  received(session: string): Promise<ShareSummary[]>
  /** `visitor` is this device's own id, so a signed-out look is one guest however often. */
  open(session: string | null, id: string, key: string, visitor: string): Promise<ShareLink>
  ask(session: string | null, id: string, key: string, name: string): Promise<ShareLink>
  /** The link after it; null once it is forgotten. */
  act(session: string, id: string, action: ShareAction): Promise<ShareLink | null>
  fileUrl(link: Pick<ShareLink, 'id' | 'key'>, entryId: string, part: RoomFilePart): string
}

export function createShareApi(doormanUrl: string, fetch: DoormanFetch): ShareApi {
  const base = doormanUrl.replace(/\/+$/, '')
  const send = doormanSend(base, fetch)
  const one = (body: unknown): ShareLink => ShareLinkSchema.parse(body)
  const many = (body: unknown): ShareSummary[] => ShareSummariesSchema.parse(body)
  const path = DOORMAN_PATHS.shareLink

  return {
    create: (session, input) => send(DOORMAN_PATHS.share, one, { json: input, session }),
    sent: session => send(DOORMAN_PATHS.share, many, { session }),
    received: session => send(`${DOORMAN_PATHS.share}/received`, many, { session }),
    open: (session, id, key, visitor) => send(path(id, '', key, visitor), one, { session }),
    ask: (session, id, key, name) => send(path(id, '/ask', key), one, { json: { name }, session }),
    act: (session, id, action) =>
      send(path(id, '/act'), body => (body === null ? null : one(body)), {
        json: action,
        session,
      }),
    fileUrl: (link, entryId, part) =>
      `${base}${path(link.id, `/files/${entryId}/${part}`, link.key)}`,
  }
}

/**
 * A share link's address: its page in the web app, which opens without
 * self.mp3. A list's names the song it opens on, `?s=<entry>`; shared from a
 * line, it says where to start, `?t=0:42`. The colon is left as it is, which
 * a query may carry, so the address reads as a time.
 */
export function shareLinkUrl(
  appUrl: string,
  link: Pick<ShareLink, 'id' | 'key'>,
  { song = null, start = null }: { song?: string | null; start?: number | null } = {},
): string {
  const query = [
    song === null ? null : `s=${encodeURIComponent(song)}`,
    start === null ? null : `t=${formatShareStart(start)}`,
  ].filter(Boolean)
  const at = query.length > 0 ? `?${query.join('&')}` : ''
  return `${appUrl.replace(/\/+$/, '')}/l/${link.id}/${link.key}${at}`
}
