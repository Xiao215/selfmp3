import {
  clamp,
  DOORMAN_PATHS,
  hasColour,
  plural,
  ShareIdSchema,
  ShareKeySchema,
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
  if (!ids.success || !keys.success) throw notFound('no such link')

  const there = `${app}/l/${ids.data}/${keys.data}`
  if (!isPreviewer(ctx.request.headers.get('user-agent'))) return onTo(there)

  const peeked = await shareObject(ctx, ids.data).fetch(
    `https://share/peek?k=${encodeURIComponent(keys.data)}`,
  )
  const link = peeked.ok ? ShareLinkSchema.safeParse(await peeked.json()) : null
  if (!peeked.ok) await peeked.body?.cancel()
  const card = link?.success
    ? linkCard(link.data, { doorman: ctx.url.origin, app })
    : {
        // Forgotten, or a key that is not its own: neither says anything about the link.
        title: 'self.mp3',
        description: 'This link is gone.',
        kind: 'website',
        image: appIcon(app),
        color: ACCENT,
      }
  return previewPage({ ...card, url: ctx.url.href, open: there })
}

/** The app's own accent, for a card with no cover colour to take. */
const ACCENT = darkPalette(DEFAULT_ACCENT_HUE).accent

type Card = Omit<PreviewOptions, 'url' | 'open'>

/**
 * What the card says (A1): the song, or the list's name, first, as Apple
 * Music's do; then what it is and who sent it. Once it has ended, the line
 * says so — a chat keeps a card long after the link is gone.
 */
function linkCard(link: ShareLink, at: { doorman: string; app: string }): Card {
  const first = link.entries.find(entry => !entry.gone) ?? link.entries[0]
  const song = link.kind === 'song' ? (first?.song ?? null) : null
  const from = link.from.name
  const what = song
    ? [song.artist, 'Song'].filter(Boolean).join(' · ')
    : plural(link.entries.length, 'song', 'songs')
  const description = !link.ended
    ? `${what} · Shared by ${from}`
    : link.ended.why === 'removed'
      ? `${what} · No longer shared`
      : `${what} · Link ended · ask ${from} for it again`

  const pictured = link.entries.find(entry => !entry.gone && entry.song.cover !== null)
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
