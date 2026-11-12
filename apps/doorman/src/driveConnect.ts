import {
  DOORMAN_ERROR,
  DRIVE_CONNECTED_FRAGMENT,
  DRIVE_REFUSAL,
  DRIVE_REFUSAL_WORDS,
  DRIVE_REFUSED_FRAGMENT,
  DoormanDriveStartSchema,
  DoormanError,
  SIGN_IN_TTL_MS,
  type DoormanDriveStarted,
  type DriveRefusal,
} from '@selfmp3/shared'
import * as auth from './auth.js'
import { requireDevice, type Context } from './context.js'
import { Drive, prepareDrive, type DriveTarget } from './drive.js'
import { randomToken } from './encoding.js'
import { DRIVE_SCOPE, GoogleError, authUrl, checkIdToken, exchangeCode } from './google.js'
import { page } from './html.js'
import { json, notSetUp, readJson, redirect } from './http.js'
import { openState, pkceChallenge, pkceVerifier, signState, type DriveState } from './signin.js'
import { holdsLibrary, movable } from './move.js'
import { checkFormat, dropMove, letGo } from './storage.js'
import { StoreError } from './store.js'

/**
 * Connecting Google Drive: the storage an account gets with one more yes to
 * Google and nothing to copy (docs/features/storage-providers.md).
 *
 * It is the trip a sign-in makes (auth.ts), made again by an account already
 * signed in, for one more thing: the `drive.file` scope, which lets the
 * doorman keep files of its own making in the account's Drive, and a refresh
 * token to do it with while no device is there.
 *
 *   POST /v1/storage/drive      the device asks, with its session; the answer
 *                               is the address of Google's page, which it opens
 *   GET  /v1/auth/callback      Google sends the browser back. The same
 *                               address a sign-in comes back to — so the OAuth
 *                               client needs no second redirect address — and
 *                               the signed state says which trip this was.
 *
 * The state names the account that asked, and Google's answer must be for
 * that account: someone sent a link of another's making connects nothing,
 * because the Drive they say yes with is not the account in the state. So
 * nothing comes back to the device to claim, as a sign-in's code does. The
 * browser returns to the app saying only how it went, and the device asks
 * `/v1/me`.
 *
 * Starting writes nothing. The callback's one KV write is the sealed record,
 * made only once the folder is there and `format.json` in it reads back.
 */

/** `POST /v1/storage/drive { returnTo? }` → `{ url }` */
export async function start(ctx: Context): Promise<Response> {
  const session = await requireDevice(ctx)
  const input = await readJson(ctx.request, DoormanDriveStartSchema)
  const google = auth.googleClient(ctx)
  if (!google) throw notSetUp('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.')
  const keys = await ctx.keys()

  // A move needs somewhere to move from, and somewhere else to move to.
  if (input.move) await movable(ctx, session.sub, 'drive')

  const nonce = randomToken()
  const state: DriveState = {
    drive: session.sub,
    ...(input.move ? { move: true } : {}),
    returnTo: auth.safeReturn(
      input.returnTo ?? null,
      ctx.origins,
      auth.appSchemes(ctx.env.APP_SCHEMES),
    ),
    nonce,
    exp: ctx.now() + SIGN_IN_TTL_MS,
  }
  const body: DoormanDriveStarted = {
    url: authUrl({
      clientId: google.clientId,
      redirectUri: auth.redirectUri(ctx),
      state: await signState(state, keys.state),
      nonce,
      codeChallenge: await pkceChallenge(await pkceVerifier(nonce, keys.pkce)),
      drive: { email: session.email },
    }),
  }
  return json(body)
}

/**
 * `GET /v1/auth/callback` — Google sends the browser back here from either
 * trip. One made to connect Drive is finished here; a sign-in, and anything
 * that is neither, is auth.ts's.
 */
export async function callback(ctx: Context): Promise<Response> {
  const keys = await auth.keysOrNull(ctx)
  const google = auth.googleClient(ctx)
  const params = ctx.url.searchParams
  const state =
    keys && google ? await openState(params.get('state') ?? '', keys.state, ctx.now()) : null
  if (!keys || !google || !state || !('drive' in state)) return auth.callback(ctx)

  const code = params.get('code')
  if (params.get('error') !== null || !code) {
    return ended(
      state,
      params.get('error') === null ? DRIVE_REFUSAL.failed : DRIVE_REFUSAL.cancelled,
    )
  }

  let target: DriveTarget
  try {
    const answer = await exchangeCode({
      fetch: ctx.fetch,
      code,
      codeVerifier: await pkceVerifier(state.nonce, keys.pkce),
      redirectUri: auth.redirectUri(ctx),
      ...google,
    })
    const identity = checkIdToken(answer.idToken, {
      clientId: google.clientId,
      nonce: state.nonce,
      now: ctx.now(),
    })
    if (identity.sub !== state.drive) return ended(state, DRIVE_REFUSAL.otherAccount)
    // Google's page has a box for each thing asked, and this one can be left empty.
    if (!answer.scopes.includes(DRIVE_SCOPE)) return ended(state, DRIVE_REFUSAL.unticked)
    if (!answer.refreshToken) throw new GoogleError('Google answered without a refresh token', 502)

    target = await prepareDrive(answer.refreshToken, ctx.storeDeps.drive)
    const drive = new Drive(target, ctx.storeDeps.drive)
    await checkFormat(drive, ctx.now)
    if (state.move && (await holdsLibrary(drive))) return ended(state, DRIVE_REFUSAL.holdsLibrary)
  } catch (error) {
    // A format.json this build may not write to is said as it is (`checkFormat`).
    if (error instanceof DoormanError && error.code === DOORMAN_ERROR.unprocessable) {
      return ended(state, DRIVE_REFUSAL.failed, error.message)
    }
    if (!(error instanceof GoogleError) && !(error instanceof StoreError)) throw error
    // The reason goes to the Worker's log, for the owner; a full Drive is the person's to hear.
    ctx.log.warn('connecting Google Drive failed', { reason: error.message })
    const said = error instanceof StoreError && error.kind === 'full' ? error.message : undefined
    return ended(state, DRIVE_REFUSAL.failed, said)
  }

  if (state.move) {
    // The storage is left as it is: the Drive is only where the move is going (move.ts).
    await ctx.accounts.startMove(state.drive, { kind: 'drive', ...target })
    return ended(state, null)
  }
  const previous = await ctx.accounts.storage(state.drive)
  await ctx.accounts.connect(state.drive, { kind: 'drive', ...target })
  letGo(ctx, previous, 'drive')
  await dropMove(ctx, state.drive, 'drive')
  return ended(state, null)
}

/**
 * Where the trip ends: back in the app, with how it went in the fragment
 * (shared's `driveBackFromUrl`), or on a page of the doorman's own when the
 * device gave nowhere to come back to.
 */
function ended(state: DriveState, refusal: DriveRefusal | null, said?: string): Promise<Response> {
  if (state.returnTo) {
    const fragment =
      refusal === null
        ? `${DRIVE_CONNECTED_FRAGMENT}=connected`
        : `${DRIVE_REFUSED_FRAGMENT}=${refusal}`
    return Promise.resolve(redirect(auth.withFragment(state.returnTo, fragment)))
  }
  if (refusal === null) {
    return page({
      status: 200,
      title: 'Google Drive is connected',
      lines: [
        state.move
          ? 'Your library can be moved to a folder called self.mp3 in your Google Drive.'
          : 'Your music will be kept in a folder called self.mp3 in your Google Drive.',
      ],
      notes: ['Go back to self.mp3.'],
    })
  }
  return page({
    status: 400,
    title: 'Google Drive is not connected',
    lines: [said ?? DRIVE_REFUSAL_WORDS[refusal], 'Start again from self.mp3.'],
    link: auth.BACK_TO_APP,
  })
}
