import { DEFAULT_APP_URL } from './cloud.js'
/**
 * The privacy policy, once: what the doorman keeps about a person who signs
 * in with Google, and what passes through it untouched.
 *
 * It is data here rather than a page anywhere, because two places show it.
 * The web app publishes it beside itself on GitHub Pages (`privacy.html`,
 * written from this by `apps/app/scripts/privacy.mjs` at export), which is
 * the address Google's consent screen names — a policy has to sit on a
 * domain of one's own, and workers.dev is not one. The doorman sends
 * `/privacy` there. Edit the words here and both follow.
 */
export interface PrivacySection {
  readonly heading: string
  readonly lines: readonly string[]
}

export interface PrivacyPolicy {
  /** As it reads on the page: "22 September 2026". */
  readonly updated: string
  readonly sections: readonly PrivacySection[]
}

/** Where the policy is published: the one address everything points at. */
export const PRIVACY_POLICY_URL = `${DEFAULT_APP_URL}/privacy.html`

export const PRIVACY_POLICY: PrivacyPolicy = {
  updated: '22 September 2026',
  sections: [
    {
      heading: 'What self.mp3 is',
      lines: [
        'self.mp3 is personal music software. Your library lives in a storage bucket you own, and this service — the doorman — signs you in with Google and passes your own devices’ requests through to that bucket, so no device has to hold the bucket’s key.',
        'It is run by one person, for themselves and people they let in. It is not a company, sells nothing, and shows no advertising.',
      ],
    },
    {
      heading: 'What is kept when you sign in with Google',
      lines: [
        'Google tells the doorman your account’s id, your email address, your name and the address of your profile picture. Nothing else is asked for, and the doorman never sees your Google password.',
        'These four are kept in a session record, so your devices can stay signed in, and shown back to you in the app as who is signed in. A session lasts 180 days from sign-in, or until you sign out. Signing out everywhere ends every session of your account at once.',
        'While a sign-in is in progress, the same four are held for ten minutes under the attempt, then discarded.',
      ],
    },
    {
      heading: 'Your bucket',
      lines: [
        'When you connect your storage bucket, its address, name, key id and application key are kept, encrypted (AES-256-GCM) with a key only the doorman holds. They are used for one thing: passing your own signed-in devices’ reads and writes through to your bucket. They are never sent to any device, and never used to read your bucket on the doorman’s own behalf.',
        'Disconnecting the bucket deletes them at once. The bucket itself, and everything in it, is yours and is never touched by that.',
      ],
    },
    {
      heading: 'What passes through',
      lines: [
        'Your music, cover art, lyrics and library files travel between your devices and your bucket through the doorman. They are not stored on the way, not read, and not logged.',
      ],
    },
    {
      heading: 'Logs',
      lines: [
        'The doorman writes a short line to its log when something goes wrong, such as a sign-in Google did not finish or an address that is not allowed in, so its operator can see why. A log line may name the email address involved. It never contains a session token, a bucket key or any file.',
        'Logs are kept by Cloudflare for a short period and are not used for anything else.',
      ],
    },
    {
      heading: 'Who else is involved',
      lines: [
        'Google, which signs you in. Cloudflare, which runs the doorman and holds its records. The storage provider of the bucket you connected, which holds your library. Nothing is shared with anyone else, and nothing is sold or used for advertising.',
        'The use of information received from Google APIs follows the Google API Services User Data Policy, including its Limited Use requirements.',
      ],
    },
    {
      heading: 'Your choices',
      lines: [
        'Sign out to end a session, or sign out everywhere to end all of them. Disconnect your bucket to delete its key. Both are in the app’s settings.',
        'To have anything else removed, or to ask about any of this, write to xiaozhang20030215@gmail.com.',
      ],
    },
  ],
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The policy as one self-contained page: no script, an inline stylesheet, the
 * doorman's look. Every string is escaped on its way in, however trusted.
 */
export function renderPrivacyPage(policy: PrivacyPolicy = PRIVACY_POLICY): string {
  const body = policy.sections
    .map(section =>
      [
        `<h2>${escapeHtml(section.heading)}</h2>`,
        ...section.lines.map(line => `<p>${escapeHtml(line)}</p>`),
      ].join('\n'),
    )
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy · self.mp3</title>
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
.brand { margin: 0 0 20px; color: var(--accent); font-weight: 700; letter-spacing: 0.02em; }
h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; }
h2 { margin: 24px 0 8px; font-size: 17px; line-height: 1.3; }
p { margin: 0 0 12px; color: var(--text-secondary); overflow-wrap: anywhere; }
</style>
</head>
<body>
<main>
<p class="brand">self.mp3</p>
<h1>Privacy</h1>
<p>Last updated ${escapeHtml(policy.updated)}.</p>
${body}
</main>
</body>
</html>
`
}
