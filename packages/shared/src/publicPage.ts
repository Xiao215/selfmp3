/**
 * The look of the plain pages the web app publishes beside itself on GitHub
 * Pages — the privacy policy (`privacy.ts`) and the bucket guide
 * (`bucketGuide.ts`): one self-contained page, no script, an inline
 * stylesheet, the doorman's look. Written at export by
 * `apps/app/scripts/pages.mjs`.
 */

/**
 * The plain pages beside the web app, by name, and the file each is written
 * to by apps/app/scripts/pages.mjs. GitHub Pages answers `privacy` for
 * privacy.html and `install/` for install/index.html. The app's service worker
 * leaves every form of these addresses alone, or it would keep one as the
 * app's offline index.
 */
export const PLAIN_PAGES = {
  privacy: 'privacy.html',
  bucket: 'bucket.html',
  install: 'install/index.html',
} as const

/**
 * Which plain page a path below the app's base is, by any of its addresses
 * (`privacy` or `privacy.html`, `install/` or its index file), or null for
 * the app's own.
 */
export function plainPageAt(path: string): keyof typeof PLAIN_PAGES | null {
  const page = path.replace(/^\/+/, '').replace(/(?:\/index)?\.html$|\/$/, '')
  return Object.hasOwn(PLAIN_PAGES, page) ? (page as keyof typeof PLAIN_PAGES) : null
}

/**
 * The app's icon, for a plain page's tab and home-screen tile, from a page
 * `up` folders below the app (`'../'` for one in its own folder).
 */
export const pageIcons = (up = ''): string =>
  `<link rel="icon" type="image/svg+xml" href="${up}icons/icon.svg">
<link rel="icon" type="image/png" sizes="192x192" href="${up}icons/icon-192.png">
<link rel="apple-touch-icon" href="${up}icons/icon-180.png">`

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Text made safe in a page: in its body, and in an attribute quoted either
 * way. These pages and the doorman's (apps/doorman's html.ts) escape with it.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ESCAPES[char] ?? char)
}

/** A page around `body`, which the caller has already escaped. */
export function renderPublicPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · self.mp3</title>
${pageIcons()}
<style>
:root {
  color-scheme: dark;
  --surface: oklch(0.16 0.012 268);
  --card: oklch(0.19 0.014 268);
  --border: oklch(0.3 0.016 268);
  --text: oklch(0.97 0.005 268);
  --text-secondary: oklch(0.76 0.012 268);
  --accent: oklch(0.72 0.16 268);
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
  max-width: 640px;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
}
@media (max-width: 480px) {
  body { padding: 16px; }
  main { padding: 20px; }
}
@font-face { font-family: 'Instrument Serif'; src: url(fonts/InstrumentSerif-Regular.ttf); font-display: swap; }
.brand { margin: 0 0 16px; color: var(--text); font: 400 28px/1 'Instrument Serif', Georgia, serif; letter-spacing: -0.01em; }
h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; }
h2 { margin: 24px 0 8px; font-size: 17px; line-height: 1.3; }
p, li { margin: 0 0 12px; color: var(--text-secondary); overflow-wrap: anywhere; }
ul { margin: 0 0 12px; padding-left: 20px; }
li { margin-bottom: 6px; }
strong { color: var(--text); font-weight: 600; }
a { color: var(--accent); }
.go {
  display: inline-block;
  margin: 0 0 12px;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  font-weight: 600;
  text-decoration: none;
}
.go:hover { border-color: var(--accent); }
</style>
</head>
<body>
<main>
<p class="brand">self.mp3</p>
${body}
</main>
</body>
</html>
`
}
