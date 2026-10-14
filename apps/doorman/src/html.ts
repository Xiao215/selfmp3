import {
  darkPalette,
  DEFAULT_ACCENT_HUE,
  leading,
  lightPalette,
  radius,
  type,
  type ThemePalette,
} from '@selfmp3/client/tokens'
import { sha256Base64 } from './encoding.js'

/**
 * The few pages a person sees in their browser: the sign-in code, and the
 * ways signing in can go wrong.
 *
 * Each page is one self-contained document with no script at all. The
 * stylesheet is inline and named in the Content-Security-Policy by its hash,
 * worked out from the stylesheet itself so the two cannot drift apart;
 * nothing else may load, and no page may be framed.
 *
 * `Referrer-Policy: no-referrer` matters here: the callback's address carries
 * Google's code and the sign-in's state, and it must not travel on as the
 * Referer of wherever the browser goes next.
 *
 * Every piece of text is escaped where it goes into the page, including an
 * email address Google vouched for — the page never trusts that a value is
 * harmless because of where it came from.
 */

/**
 * The pages' colours are the app's own, from `@selfmp3/client/tokens` — the
 * one module of the client package with nothing in it but the palettes, so
 * the Worker bundles a few hundred lines of colour arithmetic and none of the
 * client, and a page cannot drift from the app. Dark first, as the app is,
 * and Paper when the system is light; the accent at the default hue, since a
 * sign-in page has no device to read a chosen one from.
 */
function paletteVars(palette: ThemePalette): string {
  return [
    `--surface: ${palette.surface0};`,
    `--card: ${palette.surface1};`,
    `--border: ${palette.border};`,
    `--text: ${palette.textPrimary};`,
    `--text-secondary: ${palette.textSecondary};`,
    `--accent: ${palette.accent};`,
  ].join(' ')
}

const STYLE = `
:root { color-scheme: dark; ${paletteVars(darkPalette(DEFAULT_ACCENT_HUE))} }
@media (prefers-color-scheme: light) {
  :root { color-scheme: light; ${paletteVars(lightPalette(DEFAULT_ACCENT_HUE))} }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--surface);
  color: var(--text);
  font: ${type.body}px/${leading.body}px -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
}
main {
  width: 100%;
  max-width: 420px;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: ${radius.card}px;
  background: var(--card);
}
.brand { margin: 0 0 20px; color: var(--accent); font-weight: 700; letter-spacing: 0.02em; }
h1 { margin: 0 0 12px; font-size: ${type.large}px; line-height: ${leading.large}px; }
p { margin: 0 0 12px; color: var(--text-secondary); overflow-wrap: anywhere; }
a { color: var(--accent); }
.code {
  margin: 20px 0;
  color: var(--text);
  font: 700 40px/1.2 ui-monospace, 'SF Mono', Menlo, monospace;
  letter-spacing: 0.08em;
  user-select: all;
}
`

let styleHash: Promise<string> | null = null

interface PageOptions {
  readonly status: number
  readonly title: string
  readonly lines: readonly string[]
  /** A sign-in code, shown large after the lines, and the notes that go under it. */
  readonly code?: string
  readonly notes?: readonly string[]
}

export async function page(options: PageOptions): Promise<Response> {
  styleHash ??= sha256Base64(STYLE)
  const hash = await styleHash
  const paragraphs = (lines: readonly string[] = []) =>
    lines.map(line => `<p>${escapeHtml(line)}</p>`)

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(options.title)} · self.mp3</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    '<p class="brand">self.mp3</p>',
    `<h1>${escapeHtml(options.title)}</h1>`,
    ...paragraphs(options.lines),
    options.code ? `<p class="code">${escapeHtml(options.code)}</p>` : '',
    ...paragraphs(options.notes),
    '</main>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n')

  return new Response(html, {
    status: options.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy':
        `default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; ` +
        "form-action 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'cache-control': 'no-store',
    },
  })
}

/** What a chat app draws for a link (linkPage.ts): its card's words, picture and colour. */
export interface PreviewOptions {
  readonly title: string
  readonly description: string
  /** The address the card is for: the link itself. */
  readonly url: string
  /** Where the page's one link goes, for a person who lands here instead of a chat app. */
  readonly open: string
  readonly image: { readonly url: string; readonly alt: string }
  /** Open Graph's kind: `music.song`, `music.playlist` or `website`. */
  readonly kind: string
  /** Seconds, for a song whose length is known. */
  readonly duration?: number
  /** The stripe Discord draws down the card's edge. */
  readonly color: string
}

/**
 * The page a chat app reads a link's card from. Only its head matters to
 * them; the body is for a person sent here by mistake — a browser whose name
 * looked like a chat app's — and is one line and a link on to the app.
 *
 * `noindex`: a link is for whoever it was sent to, not for a search engine
 * that comes across it.
 */
export async function previewPage(options: PreviewOptions): Promise<Response> {
  styleHash ??= sha256Base64(STYLE)
  const hash = await styleHash
  const meta = (attribute: 'property' | 'name', name: string, content: string) =>
    `<meta ${attribute}="${name}" content="${escapeHtml(content)}">`

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(options.title)}</title>`,
    meta('name', 'description', options.description),
    meta('name', 'theme-color', options.color),
    meta('property', 'og:site_name', 'self.mp3'),
    meta('property', 'og:type', options.kind),
    meta('property', 'og:title', options.title),
    meta('property', 'og:description', options.description),
    meta('property', 'og:url', options.url),
    meta('property', 'og:image', options.image.url),
    meta('property', 'og:image:alt', options.image.alt),
    options.duration ? meta('property', 'music:duration', String(options.duration)) : '',
    // A square cover reads best as Discord's small picture beside the words.
    meta('name', 'twitter:card', 'summary'),
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    '<p class="brand">self.mp3</p>',
    `<h1>${escapeHtml(options.title)}</h1>`,
    `<p>${escapeHtml(options.description)}</p>`,
    `<p><a href="${escapeHtml(options.open)}">Open it</a></p>`,
    '</main>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n')

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy':
        `default-src 'none'; style-src 'sha256-${hash}'; base-uri 'none'; ` +
        "form-action 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'x-robots-tag': 'noindex',
      'cache-control': 'no-store',
    },
  })
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Safe in text and in a quoted attribute. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ESCAPES[char] ?? char)
}
