/**
 * The look of the plain pages the web app publishes beside itself on GitHub
 * Pages — the privacy policy (`privacy.ts`) and the bucket guide
 * (`bucketGuide.ts`): one self-contained page, no script, an inline
 * stylesheet, the doorman's look. Written at export by
 * `apps/app/scripts/pages.mjs`.
 */

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A page around `body`, which the caller has already escaped. */
export function renderPublicPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · self.mp3</title>
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
.brand { margin: 0 0 20px; color: var(--accent); font-weight: 700; letter-spacing: 0.02em; }
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
