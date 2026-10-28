import {
  clamp,
  DOORMAN_PATHS,
  formatShareStart,
  hasColour,
  parseShareStart,
  plural,
  RoomIdSchema,
  ShareIdSchema,
  ShareKeySchema,
  shareLineAt,
  ShareLinkSchema,
  type ShareLink,
} from '@selfmp3/shared'
import { darkPalette, DEFAULT_ACCENT_HUE, oklchToHex } from '@selfmp3/client/tokens'
import type { Context } from './context.js'
import { previewPage, type PreviewOptions } from './html.js'
import { methodNotAllowed, notFound } from './http.js'
import { shareObject } from './shareRoutes.js'

/**
 * A share link's own address, `/l/<id>/<key>` (docs/features/share-links.md,
 * "How a link looks in a chat").
 *
 * The web app on GitHub Pages cannot say what a link holds: Pages has no file
 * for the address, so it answers with the app and a 404, and a chat app reads
 * nothing from either. So a link points here instead, on the doorman's own
 * domain. A chat app fetching it gets a page whose head names the song, with
 * its cover as the picture; a person is sent straight on to the same address
 * in the app (`APP_URL`).
 *
 * Which is which goes by the visitor's name for itself. Every chat app that
 * draws cards says it is a bot or names itself — Discordbot, Slackbot,
 * TelegramBot, WhatsApp, and Messages, which calls itself
 * facebookexternalhit — and no browser does. A browser that is taken for one
 * gets the card's page, which has a link on.
 *
 * Reading the link for its card counts nothing (share.ts's `/peek`): a chat
 * app is not a guest, and a link nobody has opened still ends a week after it
 * was sent.
 *
 * Shared from a line, the address carries where to start, `?t=0:42`. A
 * person is sent on with it; a chat's card names the line, which the link
 * keeps, so nothing of the sender's bucket is read for it. A `t` that does
 * not read as a time is left off, and the link is as it is without one. A
 * list's address can name the song it opens on, `?s=<entry>`: a person is
 * sent on with it, and the card shows that song's cover.
 */

const PREVIEWERS =
  /bot|crawler|spider|facebookexternalhit|slack|whatsapp|telegram|discord|embedly|iframely|skypeuripreview|linkedin|pinterest|vkshare|mastodon/i

function isPreviewer(userAgent: string | null): boolean {
  return userAgent !== null && PREVIEWERS.test(userAgent)
}

export async function linkPage(ctx: Context): Promise<Response> {
  const app = ctx.env.APP_URL?.replace(/\/+$/, '')
  if (!app) throw notFound()
  const method = ctx.request.method
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(['GET', 'HEAD'])

  const path = ctx.url.pathname
  // The domain's own address is the app's.
  if (path === '/') return onTo(app)
  const [l, id, key, ...rest] = path.split('/').filter(Boolean)
  if (l !== 'l' || rest.length > 0) throw notFound()
  const ids = ShareIdSchema.safeParse(id)
  const keys = ShareKeySchema.safeParse(key)
  const previewer = isPreviewer(ctx.request.headers.get('user-agent'))
  const gone: Card = {
    // Forgotten, cut short, or a key that is not its own: none says anything about the link.
    title: 'self.mp3',
    description: 'This link is gone.',
    kind: 'website',
    image: appIcon(app),
    color: ACCENT,
  }
  if (!ids.success || !keys.success) {
    // Cut short when it was copied: a person goes on to the app all the same,
    // whose page for it is the torn sleeve.
    const cut = `${app}/l/${segment(id)}/${segment(key)}`
    if (!previewer) return onTo(cut)
    return previewPage({ ...gone, url: ctx.url.href, open: cut })
  }

  const start = parseShareStart(ctx.url.searchParams.get('t'))
  const named = RoomIdSchema.safeParse(ctx.url.searchParams.get('s'))
  const opensOn = named.success ? named.data : null
  const query = [
    opensOn === null ? null : `s=${opensOn}`,
    start === null ? null : `t=${formatShareStart(start)}`,
  ].filter(Boolean)
  const at = query.length > 0 ? `?${query.join('&')}` : ''
  const there = `${app}/l/${ids.data}/${keys.data}${at}`
  if (!previewer) return onTo(there)

  const peeked = await shareObject(ctx, ids.data).fetch(
    `https://share/peek?k=${encodeURIComponent(keys.data)}`,
  )
  const link = peeked.ok ? ShareLinkSchema.safeParse(await peeked.json()) : null
  if (!peeked.ok) await peeked.body?.cancel()
  const card = link?.success
    ? linkCard(link.data, start, opensOn, { doorman: ctx.url.origin, app })
    : gone
  return previewPage({ ...card, url: ctx.url.href, open: there })
}

/** What is left of a cut-short link's part, as the app's address can carry it: `-` for nothing. */
function segment(part: string | undefined): string {
  return part && /^[A-Za-z0-9]{1,64}$/.test(part) ? part : '-'
}

/** The app's own accent, for a card with no cover colour to take. */
const ACCENT = darkPalette(DEFAULT_ACCENT_HUE).accent

type Card = Omit<PreviewOptions, 'url' | 'open'>

/**
 * What the card says (A1): the song, or the list's name, first, as Apple
 * Music's do; then what it is and who sent it. Once it has ended, the line
 * says so — a chat keeps a card long after the link is gone. Shared from a
 * line, the card leads with the line where it says what it is, or with
 * where it starts when the link no longer has that line. A list's cover is
 * the song it opens on, when that song has one.
 */
function linkCard(
  link: ShareLink,
  start: number | null,
  opensOn: string | null,
  at: { doorman: string; app: string },
): Card {
  const first = link.entries.find(entry => !entry.gone) ?? link.entries[0]
  const song = link.kind === 'song' ? (first?.song ?? null) : null
  const from = link.from.name
  const line = song ? shareLineAt(link, start) : null
  const what = song
    ? [
        line ? `“${line.text}”` : start !== null ? `From ${formatShareStart(start)}` : null,
        song.artist,
        line ? null : 'Song',
      ]
        .filter(Boolean)
        .join(' · ')
    : plural(link.entries.length, 'song', 'songs')
  const description = !link.ended
    ? `${what} · Shared by ${from}`
    : link.ended.why === 'removed'
      ? `${what} · No longer shared`
      : `${what} · Link ended · ask ${from} for it again`

  const covered = link.entries.filter(entry => !entry.gone && entry.song.cover !== null)
  const pictured =
    (link.kind === 'list' ? covered.find(entry => entry.id === opensOn) : undefined) ?? covered[0]
  const title = song?.title ?? link.name
  const image = pictured
    ? {
        url: `${at.doorman}${DOORMAN_PATHS.share}/${link.id}/files/${pictured.id}/cover?k=${link.key}`,
        alt: `The cover of ${pictured.song.title}`,
      }
    : appIcon(at.app)
  const tone = pictured?.song.coverTone ?? null
  return {
    title,
    description,
    kind: song ? 'music.song' : 'music.playlist',
    ...(song && song.duration > 0 ? { duration: Math.round(song.duration) } : {}),
    image,
    // The dark theme's wash of a playing song (songColors in the client's
    // art/coverColor.ts), so the card's edge is the colour the app draws it in.
    color:
      tone && hasColour(tone) && !link.ended
        ? oklchToHex(0.68, clamp(tone.chroma * 1.6, 0.11, 0.18), tone.hue)
        : ACCENT,
  }
}

/** The app's icon, from beside the app (apps/app/public/icons): for a card with no cover. */
function appIcon(app: string): PreviewOptions['image'] {
  return { url: `${app}/icons/icon-512.png`, alt: 'self.mp3' }
}

function onTo(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  })
}
