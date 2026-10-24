import { DEFAULT_APP_URL } from './cloud.js'
import { escapeHtml, renderPublicPage } from './publicPage.js'

/**
 * Making a Backblaze bucket, once, for someone who has never seen a bucket:
 * the steps the app's "Don't have a bucket yet?" lists on Where it lives
 * (`apps/app/src/features/welcome/StorageScreen.tsx`), and the page the web
 * app publishes beside itself (`bucket.html`, written from this by
 * `apps/app/scripts/pages.mjs` at export) with the same steps at length.
 * One place for the words, so the two never disagree.
 *
 * Each step names the console's own labels, in `**`, as Backblaze's docs
 * give them (checked 2026-10-23: sign-up, buckets, lifecycle rules,
 * application keys, caps and alerts). Where a default would be refused —
 * a key for All buckets, a master key, a bucket that keeps old versions —
 * the step says so before the doorman has to (`apps/doorman/src/storage.ts`).
 */

/** Where the page is published: the one address the app and the docs point at. */
export const BUCKET_GUIDE_URL = `${DEFAULT_APP_URL}/bucket.html`

/** Backblaze's own pages, each where a step happens. The console ones ask to sign in first. */
export const BACKBLAZE_SIGN_UP_URL = 'https://www.backblaze.com/sign-up/cloud-storage'
export const BACKBLAZE_BUCKETS_URL = 'https://secure.backblaze.com/b2_buckets.htm'
export const BACKBLAZE_KEYS_URL = 'https://secure.backblaze.com/app_keys.htm'
/** Caps & Alerts, where the daily allowance is raised. */
export const BACKBLAZE_CAPS_URL = 'https://secure.backblaze.com/b2_caps_alerts.htm'

export interface BucketGuideStep {
  readonly title: string
  /** One line, as the app's helper shows it. */
  readonly detail: string
  /** The page's fuller words, a paragraph each. */
  readonly more: readonly string[]
  /** Where on Backblaze the step happens. */
  readonly link?: { readonly label: string; readonly url: string }
}

export const BUCKET_GUIDE: {
  readonly intro: readonly string[]
  readonly steps: readonly BucketGuideStep[]
  /** What the app may say when a step was missed, and which step it means. */
  readonly refusals: readonly { readonly says: string; readonly fix: string }[]
} = {
  intro: [
    'self.mp3 keeps your music in a storage bucket of your own, at Backblaze. You make it once, in about ten minutes, and every device you sign in to finds it by itself after that.',
    'It is easiest on a computer: Backblaze shows a long key once, and you copy it into self.mp3.',
  ],
  steps: [
    {
      title: 'Make a Backblaze account',
      detail: 'Sign up for B2 Cloud Storage with any email. The first 10 GB are free.',
      more: [
        'Enter an email address and press **Get started for free**. It does not have to be your Google one.',
        'Backblaze emails a link to confirm the address. Open it in the same browser, within 15 minutes.',
        'Choose a password and the data region nearest you, accept the terms, and press **Create Account**. The first 10 GB are free.',
      ],
      link: { label: 'Sign up on Backblaze', url: BACKBLAZE_SIGN_UP_URL },
    },
    {
      title: 'Create a private bucket',
      detail:
        '**Buckets** → **Create a Bucket**. A name no one has used, like selfmp3-yourname, and **Private**. Leave the rest as it is.',
      more: [
        'In the menu on the left, under B2 Cloud Storage, press **Buckets**, then **Create a Bucket**.',
        'Every Backblaze user shares one list of names, so a plain one is often taken. Use letters, numbers and dashes, like selfmp3-yourname; Backblaze says at once if it is taken.',
        'Choose **Private**, leave **Object Lock** off, and press **Create a Bucket**.',
      ],
      link: { label: 'Open Buckets', url: BACKBLAZE_BUCKETS_URL },
    },
    {
      title: 'Keep only the last version',
      detail:
        'On the new bucket, **Lifecycle Settings** → **Keep only the last version of the file**, and save. self.mp3 refuses a bucket without it.',
      more: [
        'Backblaze keeps every old version of every file unless told otherwise, so a removed song or a replaced cover would go on using your 10 GB.',
        'On the bucket you made, press **Lifecycle Settings**, choose **Keep only the last version of the file**, and save.',
        'self.mp3 checks this when you connect. If it was missed it says so: set it, and press Connect again. Nothing needs making again.',
      ],
      link: { label: 'Open Buckets', url: BACKBLAZE_BUCKETS_URL },
    },
    {
      title: 'Make a key for that bucket',
      detail:
        '**Application Keys** → **Add a New Application Key**. Under **Allow Access to Bucket(s)** pick your bucket, not All. **Read and Write**. Leave the rest empty.',
      more: [
        'In the menu on the left, press **Application Keys**, then **Add a New Application Key**. Not the master application key: it opens your whole account, and self.mp3 refuses it.',
        'Name it anything with letters, numbers and dashes, like selfmp3.',
        'Under **Allow Access to Bucket(s)**, choose the bucket you made. A key for **All** is refused.',
        'Under type of access, choose **Read and Write**.',
        'Leave **Allow List All Bucket Names** unticked, and the file name prefix and duration empty. Press **Create New Key**.',
      ],
      link: { label: 'Open Application Keys', url: BACKBLAZE_KEYS_URL },
    },
    {
      title: 'Copy the two strings into self.mp3',
      detail:
        'Backblaze shows **keyID** and **applicationKey** once, right after. Paste them above and press Connect.',
      more: [
        'Straight after **Create New Key**, Backblaze shows the **keyID** and the **applicationKey**. The applicationKey is shown only this once, so copy both before you leave the page.',
        'In self.mp3, on **Where it lives** — the page after your first Google sign-in, or Settings › Account › Storage later — paste the keyID into Key ID and the applicationKey into Application key, and press **Connect**.',
        'Lost the applicationKey? Make another key the same way. The old one can be deleted.',
        'The key goes to self.mp3’s sign-in service, sealed; no device keeps it. Your other devices need nothing more than the same Google sign-in.',
      ],
    },
    {
      title: 'Before a big first import: raise the daily limits',
      detail:
        '**Caps & Alerts** → **Edit Caps**. Hundreds of songs at once can use up a day’s limit, and the library then waits until midnight GMT.',
      more: [
        'Backblaze limits what a bucket does each day, under **Caps & Alerts**. Past a limit it stops the bucket until midnight GMT (5 pm Pacific); self.mp3 says so, and carries on by itself afterwards.',
        'A first import of hundreds of songs is the usual way to reach one. To avoid the wait, press **Edit Caps**, raise the transaction limits or choose **No Cap**, and press **Update Caps**. A change takes up to ten minutes.',
        'Since May 2026 Backblaze charges nothing for requests. Storage past 10 GB, and downloads past three times what you store, do cost; keep a cap on those if you want a ceiling.',
      ],
      link: { label: 'Open Caps & Alerts', url: BACKBLAZE_CAPS_URL },
    },
  ],
  refusals: [
    {
      says: 'Backblaze does not know that key',
      fix: 'Copy both strings again, whole, with no spaces at either end — or make a new key (step 4).',
    },
    {
      says: 'That key opens every bucket on the account',
      fix: 'Make a key for your one bucket rather than All (step 4).',
    },
    {
      says: 'The key needs Read and Write on the bucket',
      fix: 'Make a new key with Read and Write (step 4).',
    },
    {
      says: 'This bucket keeps every old version of a file',
      fix: 'Choose Keep only the last version of the file on the bucket, then Connect again (step 3).',
    },
    {
      says: 'Storage allowance used up',
      fix: 'Raise the limit under Caps & Alerts, or wait for midnight GMT (step 6).',
    },
  ],
}

/** A step's words in pieces, with the console's labels — `**` in the source — marked. */
export function guideParts(text: string): { readonly text: string; readonly label: boolean }[] {
  return text
    .split('**')
    .map((piece, index) => ({ text: piece, label: index % 2 === 1 }))
    .filter(piece => piece.text !== '')
}

/** The words as plain text, for where nothing can be marked. */
export function guideText(text: string): string {
  return text.replaceAll('**', '')
}

const inline = (text: string): string =>
  guideParts(text)
    .map(piece =>
      piece.label ? `<strong>${escapeHtml(piece.text)}</strong>` : escapeHtml(piece.text),
    )
    .join('')

/** The guide as one page, in the look `publicPage.ts` gives every page beside the app. */
export function renderBucketGuidePage(guide: typeof BUCKET_GUIDE = BUCKET_GUIDE): string {
  const steps = guide.steps
    .map((step, index) =>
      [
        `<h2>${index + 1}. ${escapeHtml(step.title)}</h2>`,
        ...step.more.map(line => `<p>${inline(line)}</p>`),
        ...(step.link
          ? [
              `<p><a class="go" href="${escapeHtml(step.link.url)}" target="_blank" rel="noopener">${escapeHtml(step.link.label)}</a></p>`,
            ]
          : []),
      ].join('\n'),
    )
    .join('\n')
  const refusals = guide.refusals
    .map(r => `<li><strong>${escapeHtml(r.says)}…</strong> ${escapeHtml(r.fix)}</li>`)
    .join('\n')
  return renderPublicPage(
    'Set up your bucket',
    [
      '<h1>Set up your bucket</h1>',
      ...guide.intro.map(line => `<p>${inline(line)}</p>`),
      steps,
      '<h2>If self.mp3 says…</h2>',
      `<ul>\n${refusals}\n</ul>`,
    ].join('\n'),
  )
}
