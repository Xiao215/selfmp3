import { ANDROID_DOWNLOAD_URL } from './androidApp.js'
import { DEFAULT_DOORMAN_URL } from './cloud.js'
import { DOORMAN_PATHS } from './doormanWire.js'
import { IOS_INSTALL_LINK } from './iosApp.js'
import { INSTALL_PAGE_URL } from './phoneBuilds.js'
import { escapeHtml, pageIcons } from './publicPage.js'

/**
 * The phone app's install page, iPhone and Android on one page, published
 * beside the web app in its own folder, install/index.html, so its address is
 * `/install/` with no file name (apps/app/scripts/pages.mjs). What it loads is
 * one folder up.
 *
 * One address rather than one per phone: the link is shared in group chats,
 * where nobody knows who has which. The page shows the steps for the phone it
 * is opened on, with a switch for the other, and `#android` or `#iphone`
 * names one outright, for a link sent from a computer.
 *
 * Not in `publicPage.ts`'s plain look: this one is the app's front door, so it
 * wears the app's faces (Instrument Serif and Bricolage Grotesque, copied next
 * to it at build, so nothing is fetched from anyone else) and the icon's
 * violet. And unlike the other pages it has a few lines of script, for what a
 * static page cannot know: which phone and which browser it is in. A link
 * shared in WeChat opens in WeChat's own browser, which can neither install
 * an iPhone app nor download an Android one, and neither can Chrome on an
 * iPhone or anything on a computer — so the page says where to open it
 * instead of letting the button fail silently.
 */

/** The fonts pages.mjs copies into the app's `fonts/`, by the name the stylesheet uses. */
export const INSTALL_PAGE_FONTS = {
  'InstrumentSerif-Regular.ttf': 'instrument-serif/400Regular/InstrumentSerif_400Regular.ttf',
  'InstrumentSerif-Italic.ttf':
    'instrument-serif/400Regular_Italic/InstrumentSerif_400Regular_Italic.ttf',
  'BricolageGrotesque-Regular.ttf':
    'bricolage-grotesque/400Regular/BricolageGrotesque_400Regular.ttf',
  'BricolageGrotesque-SemiBold.ttf':
    'bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf',
} as const

type Questions = readonly (readonly [string, string])[]

const IPHONE_QUESTIONS: Questions = [
  [
    'Why does my iPhone need adding?',
    'An app from outside the App Store installs only on the iPhones it was signed for. Your ID is how yours gets on the list; nothing else about your iPhone is sent.',
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

const ANDROID_QUESTIONS: Questions = [
  [
    'Is it safe to allow?',
    'It lets that one browser install apps you open from it. You can turn it off again in Settings once self.mp3 is in.',
  ],
  [
    'It says “Blocked by Play Protect”',
    'Play Protect doesn’t know apps from outside the Play Store. Tap More details, then Install anyway.',
  ],
  [
    'It says “App not installed”',
    'Usually there isn’t enough space, or a self.mp3 from somewhere else is in the way. Free some space or uninstall that one, then open the download again.',
  ],
  [
    'How do updates work?',
    'The app tells you when a new build is out. Tap Install; your music and settings stay.',
  ],
]

const STYLE = `
@font-face { font-family: 'Instrument Serif'; src: url(../fonts/InstrumentSerif-Regular.ttf); font-display: swap; }
@font-face { font-family: 'Instrument Serif'; font-style: italic; src: url(../fonts/InstrumentSerif-Italic.ttf); font-display: swap; }
@font-face { font-family: 'Bricolage'; font-weight: 400; src: url(../fonts/BricolageGrotesque-Regular.ttf); font-display: swap; }
@font-face { font-family: 'Bricolage'; font-weight: 600; src: url(../fonts/BricolageGrotesque-SemiBold.ttf); font-display: swap; }
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
.switch {
  display: inline-flex; margin: 24px 0 0; padding: 4px; border-radius: 999px;
  background: var(--card); border: 1px solid var(--line);
}
.switch button {
  appearance: none; border: 0; background: none; cursor: pointer;
  padding: 7px 18px; border-radius: 999px;
  font: 600 14px 'Bricolage', -apple-system, sans-serif; color: var(--dim);
  -webkit-tap-highlight-color: transparent;
}
.switch button[aria-pressed='true'] { background: rgba(185, 164, 255, 0.16); color: var(--text); }
body[data-phone='ios'] .android, body[data-phone='android'] .ios { display: none; }
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
.field {
  display: block; width: 100%; margin: 14px 0 0; height: 48px; padding: 0 16px; border-radius: 14px;
  border: 1px solid var(--line); background: var(--card); color: var(--text);
  font: 400 16px 'Bricolage', -apple-system, sans-serif; outline: none;
}
.field::placeholder { color: var(--faint); }
.field:focus { border-color: rgba(185, 164, 255, 0.55); }
body.elsewhere .field { opacity: 0.4; pointer-events: none; }
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
 * Which phone the page is for, and whether this browser can install it. The
 * phone is `#android` or `#iphone` when the address names one, else the one
 * the page is open on, else the iPhone. `elsewhere` dims the buttons and shows
 * the note, with the words for where to open the page instead.
 */
const SCRIPT = `
(function () {
  // The name goes with the ID, so the owner's list says who asked.
  var name = document.getElementById('name');
  var getId = document.getElementById('get-id');
  var base = getId.getAttribute('href');
  name.addEventListener('input', function () {
    var typed = name.value.trim();
    getId.setAttribute('href', typed ? base + '?name=' + encodeURIComponent(typed) : base);
  });
})();
(function () {
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var android = /Android/i.test(ua);
  var wechat = /MicroMessenger/i.test(ua);
  var qq = /\\bQQ\\/|MQQBrowser/i.test(ua);
  var page = ${JSON.stringify(INSTALL_PAGE_URL)};
  function away(phone) {
    if (phone === 'ios') {
      if (android) return 'This is the iPhone app. For yours, pick <strong>Android</strong> above.';
      if (wechat) return 'WeChat can’t install apps. Tap <strong>···</strong> at the top right, then <strong>Open in Safari</strong> (在 Safari 中打开).';
      if (qq) return 'QQ can’t install apps. Tap <strong>···</strong>, then open this page in <strong>Safari</strong>.';
      if (ios && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\\//.test(ua)) return 'Only <strong>Safari</strong> can install apps. Open this page there.';
      if (!ios) return 'This is for iPhone. Open this page in <strong>Safari</strong> on your iPhone:';
    } else {
      if (ios) return 'This is the Android app. For yours, pick <strong>iPhone</strong> above.';
      if (wechat) return 'WeChat can’t download apps. Tap <strong>···</strong> at the top right, then <strong>Open in Browser</strong> (在浏览器打开).';
      if (qq) return 'QQ can’t download apps. Tap <strong>···</strong>, then open this page in your browser.';
      if (!android) return 'This is for Android. Open this page on your Android phone:';
    }
    return '';
  }
  var buttons = document.querySelectorAll('.switch button');
  function show(phone) {
    document.body.setAttribute('data-phone', phone);
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-phone') === phone));
    }
    var words = away(phone);
    document.getElementById('away-words').innerHTML = words;
    document.getElementById('away-link').textContent = page + (phone === 'android' ? '#android' : '#iphone');
    document.body.classList.toggle('elsewhere', words !== '');
    document.title = phone === 'android' ? 'Get self.mp3 for Android' : 'Get self.mp3 for iPhone';
  }
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function () {
      var phone = this.getAttribute('data-phone');
      show(phone);
      history.replaceState(null, '', phone === 'android' ? '#android' : '#iphone');
    });
  }
  var named = location.hash.slice(1);
  show(named === 'android' ? 'android' : named === 'iphone' ? 'ios' : android ? 'android' : 'ios');
})();
`

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>`

const questionList = (questions: Questions): string =>
  questions.map(([q, a]) => `<dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd>`).join('\n')

export function renderInstallPage(doormanUrl: string = DEFAULT_DOORMAN_URL): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0a10">
<title>Get self.mp3</title>
${pageIcons('../')}
<link rel="preload" href="../fonts/InstrumentSerif-Regular.ttf" as="font" type="font/ttf" crossorigin>
<style>${STYLE}</style>
</head>
<body data-phone="ios">
<main>
<header class="hero">
<img class="icon" src="../icons/icon-180.png" alt="" width="96" height="96">
<h1>self.mp3</h1>
<p class="lede">Your music, on <em class="ios">your iPhone.</em><em class="android">your phone.</em></p>
<div class="switch" role="group" aria-label="Your phone">
<button type="button" data-phone="ios" aria-pressed="true">iPhone</button>
<button type="button" data-phone="android" aria-pressed="false">Android</button>
</div>
</header>

<div class="away" role="note"><span id="away-words"></span><span class="link" id="away-link">${escapeHtml(INSTALL_PAGE_URL)}</span></div>

<ol class="ios">
<li>
<span class="n">1</span>
<h2>Add your iPhone</h2>
<p>Say who you are, then send its ID. The page you land on says when it’s ready.</p>
<input class="field" id="name" type="text" maxlength="40" placeholder="Your name" autocomplete="given-name" aria-label="Your name">
<p class="flow"><span>Allow</span>→<span>Settings</span>→<span>Install</span></p>
<a class="button" id="get-id" href="${escapeHtml(`${doormanUrl}${DOORMAN_PATHS.device}`)}">Get my iPhone ID</a>
</li>
<li>
<span class="n">2</span>
<h2>Install</h2>
<p>Once you’re added, it’s one tap.</p>
<a class="button go" href="${escapeHtml(IOS_INSTALL_LINK)}">${ARROW}Install self.mp3</a>
</li>
</ol>

<ol class="android">
<li>
<span class="n">1</span>
<h2>Download</h2>
<p>If your browser asks whether to keep the file, keep it.</p>
<a class="button go" href="${escapeHtml(ANDROID_DOWNLOAD_URL)}">${ARROW}Download self.mp3</a>
</li>
<li>
<span class="n">2</span>
<h2>Install</h2>
<p>Open the download. The first time, your phone asks to let your browser install apps — allow it, then go back.</p>
<p class="flow"><span>Open</span>→<span>Allow</span>→<span>Install</span></p>
</li>
</ol>

<details class="ios">
<summary>Not working?</summary>
<dl>
${questionList(IPHONE_QUESTIONS)}
</dl>
</details>

<details class="android">
<summary>Not working?</summary>
<dl>
${questionList(ANDROID_QUESTIONS)}
</dl>
</details>

<footer>Shared with friends · <em>self.mp3</em></footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`
}
