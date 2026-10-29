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
  updated: '24 October 2026',
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
        'When you connect your storage bucket, its address, name, key id and application key are kept, encrypted (AES-256-GCM) with a key only the doorman holds. They are used for two things: passing your own signed-in devices’ reads and writes through to your bucket, and reading the files of the songs you share — in a link, a listening room or a shared playlist — for the people you shared them with, while that lasts. They are never sent to any device, and never used to read your bucket for anything else.',
        'Disconnecting the bucket deletes them at once. The bucket itself, and everything in it, is yours and is never touched by that.',
      ],
    },
    {
      heading: 'Sharing',
      lines: [
        'A song you share plays from your own bucket. Its files are read through the doorman for the people you shared it with, and only while the link, room or playlist lasts.',
        'A share link keeps the songs in it and the name and profile picture you share it under, so whoever holds the link sees who sent it. It plays for 30 days at most, and ends sooner after 7 days without a play. Its card stays for 90 days after it ends; then the doorman forgets the link entirely.',
        'While a link lasts, it keeps for its sender the names of the signed-in people who opened it (up to 50) and of anyone who asks to hear it again. Someone not signed in is counted, not named: their device sends a random id of its own, so a second look is not counted twice.',
        'Chat apps that show a preview of a link fetch its page and the song’s cover through the doorman.',
        'A listening room keeps the name and picture of each person in it, and the songs they add, while it is open. It is deleted ten minutes after it ends, or two hours after it was last used.',
        'A shared playlist keeps the names and pictures of its people and the songs they put in it, until its last person leaves; then it is deleted.',
      ],
    },
    {
      heading: 'What passes through',
      lines: [
        'Your music, cover art, lyrics and library files travel between your devices and your bucket through the doorman. They are not stored on the way, not read, and not logged.',
      ],
    },
    {
      heading: 'Logs and counts',
      lines: [
        'The doorman writes a short line to its log when something goes wrong, such as a sign-in Google did not finish or an address that is not allowed in, so its operator can see why. A log line may name the email address involved. It never contains a session token, a bucket key or any file.',
        'Logs are kept by Cloudflare for a short period and are not used for anything else.',
        'The doorman also keeps daily totals for its operator: how many files were read, by kind and by app, how many sessions were started, and how many sign-ins were turned away. They are numbers only, with no account, name, address or file in them, and are kept for a year.',
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
