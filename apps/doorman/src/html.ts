import { sha256Base64 } from './encoding.js'

/**
 * The few pages a person sees in their browser: the end of signing in, and
 * the ways it can go wrong.
 *
 * Each page is one self-contained document with no script at all. The
 * stylesheet is inline and named in the Content-Security-Policy by its hash,
 * worked out from the stylesheet itself so the two cannot drift apart;
 * nothing else may load. Going back to the app is a meta refresh, which needs
 * no script either.
 *
 * `Referrer-Policy: no-referrer` matters here: the callback's address carries
 * Google's code and the sign-in's state, and it must not travel on as the
 * Referer of wherever the page goes next.
 *
 * Every piece of text is escaped where it goes into the page, including an
 * email address Google vouched for — the page never trusts that a value is
 * harmless because of where it came from.
 */

const STYLE = `
:root {
  color-scheme: dark;
  --surface: oklch(0.16 0.012 268);
  --card: oklch(0.19 0.014 268);
  --border: oklch(0.3 0.016 268);
  --text: oklch(0.97 0.005 268);
  --text-secondary: oklch(0.76 0.012 268);
  --accent: oklch(0.72 0.16 268);
  --on-accent: oklch(0.15 0.02 268);
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --surface: oklch(0.985 0.004 268);
    --card: oklch(1 0 0);
    --border: oklch(0.89 0.008 268);
    --text: oklch(0.22 0.015 268);
    --text-secondary: oklch(0.44 0.014 268);
    --accent: oklch(0.52 0.19 268);
    --on-accent: oklch(0.99 0 0);
  }
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
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
}
main {
  width: 100%;
  max-width: 420px;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
}
.brand { margin: 0 0 20px; color: var(--accent); font-weight: 700; letter-spacing: 0.02em; }
h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; }
p { margin: 0 0 12px; color: var(--text-secondary); overflow-wrap: anywhere; }
a {
  display: inline-block;
  margin-top: 12px;
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
  text-decoration: none;
}
`

let styleHash: Promise<string> | null = null

export interface PageOptions {
  readonly status: number
  readonly title: string
  readonly lines: readonly string[]
  /** Where "back to self.mp3" goes. The page also goes there by itself after a moment. */
  readonly next?: string | null
}

export async function page(options: PageOptions): Promise<Response> {
  styleHash ??= sha256Base64(STYLE)
  const hash = await styleHash
  const next = options.next ?? null

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    next ? `<meta http-equiv="refresh" content="2; url=${escapeHtml(next)}">` : '',
    `<title>${escapeHtml(options.title)} · self.mp3</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    '<p class="brand">self.mp3</p>',
    `<h1>${escapeHtml(options.title)}</h1>`,
    ...options.lines.map(line => `<p>${escapeHtml(line)}</p>`),
    next ? `<a href="${escapeHtml(next)}">Back to self.mp3</a>` : '',
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

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Safe in text and in a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ESCAPES[char] ?? char)
}
