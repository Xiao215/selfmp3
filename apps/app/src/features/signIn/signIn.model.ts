/**
 * Signing in, without the screen: what it says at each point, and when a
 * sign-in whose way back never arrived is given up on.
 *
 * Nothing here asks for a code. The doorman sends Google back to the app with
 * the code inside the link — `selfmp3://welcome#signin-code=…`, or this page's
 * own address on the web — and the app claims the session with it. A person
 * never sees that code, so when the link is lost the answer is to start again,
 * not a box asking for something they were never shown.
 */

/**
 * How long after Google finishes to wait for the link before saying it did not
 * come back. The doorman reports "finished" a moment before the browser hands
 * the link over, so without a grace the screen would flash its failure on a
 * sign-in that was about to work.
 */
export const LINK_GRACE_MS = 8_000

export type SignInStage =
  | { readonly kind: 'idle'; readonly message: string | null }
  /** Google is open. `googleDoneAt` is when the doorman first said Google had finished. */
  | { readonly kind: 'waiting'; readonly googleDoneAt: number | null }
  /** Google finished, and the link back to the app never arrived. */
  | { readonly kind: 'lost' }
  /** The link arrived and its code is being spent. */
  | { readonly kind: 'claiming' }

/** What the doorman says about the attempt: gone (expired, or never kept), still at Google, or finished. */
type AttemptState = 'gone' | 'pending' | 'done'

export const TOOK_TOO_LONG = 'That took too long. Try again.'

/** The stage after asking the doorman how the attempt stands. Only a wait is moved on. */
export function afterCheck(stage: SignInStage, attempt: AttemptState, now: number): SignInStage {
  if (stage.kind !== 'waiting') return stage
  if (attempt === 'gone') return { kind: 'idle', message: TOOK_TOO_LONG }
  if (attempt === 'pending') return stage
  if (stage.googleDoneAt === null) return { kind: 'waiting', googleDoneAt: now }
  return now - stage.googleDoneAt >= LINK_GRACE_MS ? { kind: 'lost' } : stage
}

interface SignInCopy {
  /** The headline's first line. */
  readonly lead: string
  /** Its second line. */
  readonly rest: string
  /** What ends it, set in the serif's italic and the accent, as every greeting's full stop is. */
  readonly mark: string
  readonly body: string | null
}

/**
 * The words for each stage, as Welcome sets them. The same on every device, so
 * none of them names one: the line under the button is Welcome's, and does.
 */
export function copyFor(stage: SignInStage): SignInCopy {
  switch (stage.kind) {
    case 'idle':
      return {
        lead: 'Your music,',
        rest: 'your words for it',
        mark: '.',
        body: 'The songs you saved, on every device, sorted by the tags you give them. No feed, no ads, nobody else’s taste.',
      }
    case 'waiting':
      return {
        lead: 'Finish in your',
        rest: 'browser',
        mark: '.',
        body: 'Google is open in your browser. self.mp3 comes back by itself when you’re done.',
      }
    case 'lost':
      return {
        lead: 'Didn’t come',
        rest: 'back',
        mark: '?',
        body: 'Google finished, but the browser didn’t hand the sign-in back to self.mp3. Start again, and choose Open when it asks.',
      }
    case 'claiming':
      return { lead: 'Signing you', rest: 'in', mark: '…', body: null }
  }
}
