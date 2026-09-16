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
