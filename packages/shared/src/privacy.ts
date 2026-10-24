import { DEFAULT_APP_URL } from './cloud.js'
import { escapeHtml, renderPublicPage } from './publicPage.js'
/**
 * The privacy policy, once: what the doorman keeps about a person who signs
 * in with Google, and what passes through it untouched.
 *
 * It is data here rather than a page anywhere. The web app publishes it
 * beside itself on GitHub Pages (`privacy.html`, written from this by
 * `apps/app/scripts/pages.mjs` at export), which is the address Google's
 * consent screen names — a policy has to sit on a domain of one's own, and
 * workers.dev is not one. Edit the words here and the page follows.
 */
interface PrivacySection {
  readonly heading: string
  readonly lines: readonly string[]
}

interface PrivacyPolicy {
  /** As it reads on the page: "22 September 2026". */
  readonly updated: string
  readonly sections: readonly PrivacySection[]
}

/** Where the policy is published: the one address everything points at. */
export const PRIVACY_POLICY_URL = `${DEFAULT_APP_URL}/privacy.html`

export const PRIVACY_POLICY: PrivacyPolicy = {
  updated: '13 October 2026',
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
        'In a listening room or a shared playlist you open or join while signed in, the other people in it see your profile picture beside the name you go by there.',
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

/** The policy as one page, in the look `publicPage.ts` gives every page beside the app. */
export function renderPrivacyPage(policy: PrivacyPolicy = PRIVACY_POLICY): string {
  const body = policy.sections
    .map(section =>
      [
        `<h2>${escapeHtml(section.heading)}</h2>`,
        ...section.lines.map(line => `<p>${escapeHtml(line)}</p>`),
      ].join('\n'),
    )
    .join('\n')
  return renderPublicPage(
    'Privacy',
    `<h1>Privacy</h1>\n<p>Last updated ${escapeHtml(policy.updated)}.</p>\n${body}`,
  )
}
