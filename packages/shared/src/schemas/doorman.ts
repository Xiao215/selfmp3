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
 *   GET    /v1/auth/callback                           ← Google comes back here
 *   POST   /v1/auth/claim   { attempt }                → pending, or a session
 *   POST   /v1/auth/signout
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

export const DoormanClaimRequestSchema = z.object({ attempt: SignInAttemptSchema })
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

export const DoormanClaimResultSchema = z.discriminatedUnion('status', [
  /** Google has not come back yet. Ask again in a moment. */
  z.object({ status: z.literal('pending') }),
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
