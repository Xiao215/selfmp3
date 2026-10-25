import { DEFAULT_DOORMAN_URL } from './cloud.js'
import { DOORMAN_PATHS } from './doormanWire.js'
import { IOS_INSTALL_LINK, IOS_INSTALL_PAGE_URL } from './iosApp.js'
import { escapeHtml } from './publicPage.js'

/**
 * The iPhone app's install page, published beside the web app as install.html
 * (apps/app/scripts/pages.mjs).
 *
 * Not in `publicPage.ts`'s plain look: this one is the app's front door, so it
 * wears the app's faces (Instrument Serif and Bricolage Grotesque, copied next
 * to it at build, so nothing is fetched from anyone else) and the icon's
 * violet. And unlike the other pages it has a few lines of script, for the one
 * thing a static page cannot know: which browser it is in. A link shared in
 * WeChat opens in WeChat's own browser, which cannot install an app, and
 * neither can Chrome on an iPhone or anything on a computer — so the page says
 * where to open it instead of letting the Install button fail silently.
 */

/** The fonts pages.mjs copies into `fonts/`, by the name the stylesheet uses. */
export const INSTALL_PAGE_FONTS = {
  'InstrumentSerif-Regular.ttf': 'instrument-serif/400Regular/InstrumentSerif_400Regular.ttf',
  'InstrumentSerif-Italic.ttf':
    'instrument-serif/400Regular_Italic/InstrumentSerif_400Regular_Italic.ttf',
  'BricolageGrotesque-Regular.ttf':
    'bricolage-grotesque/400Regular/BricolageGrotesque_400Regular.ttf',
  'BricolageGrotesque-SemiBold.ttf':
    'bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf',
} as const

const QUESTIONS: readonly (readonly [string, string])[] = [
  [
    'Why does my iPhone need adding?',
    'An app from outside the App Store installs only on the iPhones it was signed for. Your ID is how yours gets on the list.',
  ],
  [
    'The profile says “Not Verified”',
    'That’s expected. It only reads your iPhone’s ID, then it’s gone — nothing stays installed.',
  ],
  [
    'It says “Unable to Install”',
    'Your iPhone isn’t in the newest build yet. Ask for one, then tap Install again.',
  ],
  [
    'How do updates work?',
    'The app tells you when a new build is out. Tap Install; your music and settings stay.',
  ],
]

const STYLE = `
@font-face { font-family: 'Instrument Serif'; src: url(fonts/InstrumentSerif-Regular.ttf); font-display: swap; }
@font-face { font-family: 'Instrument Serif'; font-style: italic; src: url(fonts/InstrumentSerif-Italic.ttf); font-display: swap; }
@font-face { font-family: 'Bricolage'; font-weight: 400; src: url(fonts/BricolageGrotesque-Regular.ttf); font-display: swap; }
@font-face { font-family: 'Bricolage'; font-weight: 600; src: url(fonts/BricolageGrotesque-SemiBold.ttf); font-display: swap; }
:root {
  color-scheme: dark;
  --ground: #0b0a10;
  --text: #f5f3fa;
  --dim: rgba(245, 243, 250, 0.6);
  --faint: rgba(245, 243, 250, 0.38);
  --line: rgba(255, 255, 255, 0.08);
  --card: rgba(255, 255, 255, 0.045);
  --violet: #b9a4ff;
  --deep: #6d5ce7;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; background: var(--ground); }
body {
  margin: 0;
  min-height: 100dvh;
  position: relative;
  color: var(--text);
  font: 400 16px/1.5 'Bricolage', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
}
/* The glow is one screen tall from the top, whatever the page's length, so
   opening "Not working?" lengthens the page without moving it. */
body::before {
  content: ''; position: absolute; z-index: -1; inset: 0 0 auto; height: 100vh; pointer-events: none;
  background:
    radial-gradient(90vmax 60vmax at 50% -12%, rgba(124, 96, 255, 0.34), transparent 62%),
    radial-gradient(70vmax 50vmax at 110% 40%, rgba(185, 164, 255, 0.08), transparent 60%);
}
main {
  max-width: 420px;
  margin: 0 auto;
  padding: max(56px, env(safe-area-inset-top)) 20px max(40px, env(safe-area-inset-bottom));
}
.hero { text-align: center; }
.icon {
  width: 96px; height: 96px; border-radius: 22px; display: block; margin: 0 auto 22px;
  box-shadow: 0 24px 60px -12px rgba(109, 92, 231, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06);
}
h1 {
  margin: 0;
  font: 400 54px/1 'Instrument Serif', Georgia, serif;
  letter-spacing: -0.01em;
}
.lede { margin: 10px 0 0; font: 400 24px/1.25 'Instrument Serif', Georgia, serif; color: var(--dim); }
.lede em {
  background: linear-gradient(100deg, var(--violet), #8f7cff);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.away {
  display: none;
  margin: 28px 0 0; padding: 14px 16px; border-radius: 16px;
  background: rgba(185, 164, 255, 0.1); border: 1px solid rgba(185, 164, 255, 0.28);
  font-size: 15px; line-height: 1.45;
}
.away strong { font-weight: 600; }
.away .link { display: block; margin-top: 8px; color: var(--violet); word-break: break-all; font-size: 14px; }
body.elsewhere .away { display: block; }
ol { list-style: none; margin: 36px 0 0; padding: 0; }
li:not(:last-child)::before {
  content: ''; position: absolute; left: 17px; top: 44px; bottom: -22px; width: 2px; border-radius: 1px;
  background: linear-gradient(var(--deep), rgba(109, 92, 231, 0.2));
}
li { position: relative; padding-left: 52px; }
li + li { margin-top: 26px; }
.n {
  position: absolute; left: 0; top: 0; width: 36px; height: 36px; border-radius: 50%;
  display: grid; place-items: center; font-weight: 600; font-size: 15px;
  background: linear-gradient(140deg, var(--violet), var(--deep));
  box-shadow: 0 0 0 5px var(--ground);
}
h2 { margin: 5px 0 2px; font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
li p { margin: 0; color: var(--dim); font-size: 15px; }
.flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 12px 0 0; padding: 0; color: var(--faint); font-size: 13px; }
.flow span { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--dim); }
.button {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 14px; height: 52px; border-radius: 16px;
  font-weight: 600; font-size: 16px; text-decoration: none; color: var(--text);
  background: var(--card); border: 1px solid var(--line);
  transition: transform 120ms ease, filter 120ms ease;
  -webkit-tap-highlight-color: transparent;
}
.button:active { transform: scale(0.98); filter: brightness(1.15); }
.button.go {
  border: 0; color: #fff;
  background: linear-gradient(135deg, #a28cff, var(--deep));
  box-shadow: 0 14px 32px -12px rgba(109, 92, 231, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.button svg { width: 18px; height: 18px; }
body.elsewhere .button { opacity: 0.4; pointer-events: none; }
details {
  margin-top: 44px; border-radius: 18px; background: var(--card); border: 1px solid var(--line);
}
summary {
  list-style: none; cursor: pointer; padding: 16px 18px; font-weight: 600; font-size: 15px;
  display: flex; justify-content: space-between; align-items: center;
}
summary::-webkit-details-marker { display: none; }
summary::after { content: '+'; font-size: 20px; font-weight: 400; color: var(--faint); transition: transform 160ms ease; }
details[open] summary::after { transform: rotate(45deg); }
dl { margin: 0; padding: 0 18px 8px; }
dt { font-weight: 600; font-size: 15px; padding-top: 14px; border-top: 1px solid var(--line); }
dd { margin: 4px 0 14px; color: var(--dim); font-size: 14px; }
footer { margin-top: 32px; text-align: center; color: var(--faint); font-size: 13px; }
footer em { font: italic 400 16px 'Instrument Serif', Georgia, serif; color: var(--dim); }
`

/**
 * Which browser this is, said before anyone taps: `elsewhere` dims the buttons
 * and shows the note, with the words for where the page is open. Safari on an
 * iPhone or iPad (an iPad says it is a Mac, but has a touch screen) keeps the
 * page as it is.
 */
const SCRIPT = `
(function () {
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var say;
  if (/MicroMessenger/i.test(ua)) say = 'WeChat can’t install apps. Tap <strong>···</strong> at the top right, then <strong>Open in Safari</strong> (在 Safari 中打开).';
  else if (/\\bQQ\\/|MQQBrowser/i.test(ua)) say = 'QQ can’t install apps. Tap <strong>···</strong>, then open this page in <strong>Safari</strong>.';
  else if (ios && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\\//.test(ua)) say = 'Only <strong>Safari</strong> can install apps. Open this page there.';
  else if (!ios) say = 'This is for iPhone. Open this page in <strong>Safari</strong> on your iPhone:';
  if (!say) return;
  document.getElementById('away-words').innerHTML = say;
  document.body.classList.add('elsewhere');
})();
`

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>`

export function renderInstallPage(doormanUrl: string = DEFAULT_DOORMAN_URL): string {
  const questions = QUESTIONS.map(
    ([q, a]) => `<dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd>`,
  ).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0a10">
<title>Get self.mp3 for iPhone</title>
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="preload" href="fonts/InstrumentSerif-Regular.ttf" as="font" type="font/ttf" crossorigin>
<style>${STYLE}</style>
</head>
<body>
<main>
<header class="hero">
<img class="icon" src="icons/icon-180.png" alt="" width="96" height="96">
<h1>self.mp3</h1>
<p class="lede">Your music, on <em>your iPhone.</em></p>
</header>

<div class="away" role="note"><span id="away-words"></span><span class="link">${escapeHtml(IOS_INSTALL_PAGE_URL)}</span></div>

<ol>
<li>
<span class="n">1</span>
<h2>Add your iPhone</h2>
<p>Send its ID so we can add it.</p>
<p class="flow"><span>Allow</span>→<span>Settings</span>→<span>Install</span></p>
<a class="button" href="${escapeHtml(`${doormanUrl}${DOORMAN_PATHS.device}`)}">Get my iPhone ID</a>
</li>
<li>
<span class="n">2</span>
<h2>Install</h2>
<p>Once you’re added, it’s one tap.</p>
<a class="button go" href="${escapeHtml(IOS_INSTALL_LINK)}">${ARROW}Install self.mp3</a>
</li>
</ol>

<details>
<summary>Not working?</summary>
<dl>
${questions}
</dl>
</details>

<footer>Shared with friends · <em>self.mp3</em></footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`
}
