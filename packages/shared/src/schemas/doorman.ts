import { z } from 'zod'

/**
 * The doorman's contract — see docs/SYNC.md.
 *
 * The doorman is a small Cloudflare Worker between every device and the
 * bucket. It signs you in with Google, keeps the one bucket that belongs to
 * your Google account (its key sealed, never sent back), and passes a
 * signed-in device's reads and writes through to that bucket. Devices never
 * hold the bucket's key.
 *
 *   GET    /v1/health
 *   GET    /v1/auth/start?attempt=<id>&return=<url>   → Google's sign-in page
 *   GET    /v1/auth/callback                           ← Google comes back here,
 *                                                         and the code is shown
 *   POST   /v1/auth/claim   { attempt, code? }         → pending, code, or a session
 *   POST   /v1/auth/signout
 *   POST   /v1/auth/signout-everywhere                 → every session of the account
 *   GET    /v1/me
 *   PUT    /v1/storage      CloudConnect               → connect your bucket
 *   DELETE /v1/storage                                 → forget it
 *   GET    /v1/list?prefix=<p>&cursor=<c>
 *   GET | HEAD | PUT | DELETE  /v1/files/<key>
 *
 * Everything but health, start, callback and claim needs
 * `Authorization: Bearer <session>`.
 */

/**
 * A sign-in attempt, named by the device that starts it. The device keeps it
 * and asks the doorman to claim the session with it — which is what makes
 * signing in work where Google's page opens outside the app, as it does in an
 * iPhone home-screen app, and nothing is handed back to the app directly.
 */
export const SignInAttemptSchema = z.string().regex(/^[0-9a-f]{32}$/, 'not a sign-in attempt')
export type SignInAttempt = z.infer<typeof SignInAttemptSchema>

/**
 * What turns an attempt into a session: a code the doorman shows once Google
 * has signed you in — on its own page, and in the fragment of the address it
 * sends you back to (`#signin-code=<code>`), never alongside the attempt.
 *
 * Starting an attempt is not enough to claim it. Someone who sends you a
 * sign-in link of their own making never sees the code you are shown, so
 * the session is not theirs to take. A device that started the attempt and
 * lands back on the page reads the code from the fragment; one that did not
 * — an iPhone home-screen app, whose sign-in opens in a sheet of its own —
 * asks you to type it. A wrong code ends the attempt.
 *
 * Eight characters of Crockford's base 32, shown as `4F7K-2QXM`. Case,
 * hyphens and spaces in what is typed back do not matter, and nor do the
 * letters that are easily mistaken for digits (I and L for 1, O for 0).
 */
export const SIGN_IN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function normalizeSignInCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}

/** `4F7K2QXM` → `4F7K-2QXM`, for showing. */
export function formatSignInCode(code: string): string {
  const clean = normalizeSignInCode(code)
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

export const SignInCodeSchema = z
  .string()
  .max(32)
  .transform(normalizeSignInCode)
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/, 'not a sign-in code'))

export const DoormanClaimRequestSchema = z.object({
  attempt: SignInAttemptSchema,
  /** Left out to ask how things stand; sent to claim the session. */
  code: SignInCodeSchema.optional(),
})
export type DoormanClaimRequest = z.infer<typeof DoormanClaimRequestSchema>

/** Where your bucket is. The key itself is never sent back. */
export const DoormanStorageSchema = z.object({
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string(),
  prefix: z.string(),
  /** The first few characters of the key id, to tell two keys apart. */
  keyIdHint: z.string(),
})
export type DoormanStorage = z.infer<typeof DoormanStorageSchema>

/** Who is signed in, and the bucket that belongs to their Google account. */
export const DoormanMeSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
  /** Null until a bucket is connected: the first thing a new account does. */
  storage: DoormanStorageSchema.nullable(),
})
export type DoormanMe = z.infer<typeof DoormanMeSchema>

/**
 * How a claim went. A wrong code is not one of these: it is refused (403,
 * `wrong_code`), and the attempt with it, so starting again is the only way on.
 */
export const DoormanClaimResultSchema = z.discriminatedUnion('status', [
  /** Google has not come back yet. Ask again in a moment. */
  z.object({ status: z.literal('pending') }),
  /** Google has signed you in: now the code shown after it, to claim the session. */
  z.object({ status: z.literal('code') }),
  z.object({
    status: z.literal('signed-in'),
    /** The session. Sent as `Authorization: Bearer <token>` from now on. */
    token: z.string().min(32),
    me: DoormanMeSchema,
  }),
])
export type DoormanClaimResult = z.infer<typeof DoormanClaimResultSchema>

export const DoormanListSchema = z.object({
  objects: z.array(z.object({ key: z.string(), size: z.number().int().nonnegative() })),
  /** Pass back to get the next page; null on the last one. */
  cursor: z.string().nullable(),
})
export type DoormanList = z.infer<typeof DoormanListSchema>

export const DoormanHealthSchema = z.object({ ok: z.literal(true), version: z.string() })
export type DoormanHealth = z.infer<typeof DoormanHealthSchema>
