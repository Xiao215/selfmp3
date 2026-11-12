import {
  DOORMAN_ERROR,
  DoormanError,
  DoormanMoveCopySchema,
  DoormanMoveStartSchema,
  FORMAT_KEY,
  SNAPSHOTS_FOLDER,
  isCloudFileKey,
  isLookedAtCloudKey,
  messageOf,
  newestSnapshotKey,
  sameStorage,
  type DoormanList,
  type DoormanMove,
  type DoormanSpace,
} from '@selfmp3/shared'
import { described } from './accounts.js'
import { changesOf, requireDevice, type Context } from './context.js'
import { Drive } from './drive.js'
import { badRequest, discard, json, noContent, readJson, redact, unprocessable } from './http.js'
import type { Session } from './sessions.js'
import { backblazeBucket, bucketFrom, letGo, tryBucket } from './storage.js'
import type { Store } from './store.js'
import { openStore, type AccountStorage } from './stores.js'

/**
 * Moving a library from the account's storage to another place, file for
 * file (docs/features/storage-providers.md, "Moving").
 *
 * An account has one storage, before, during and after. The new place is
 * connected beside it only as where the move is going (`move:<sub>`,
 * accounts.ts), and until the move is finished every device goes on reading
 * and writing the old one. So a move can be stopped at any point, or simply
 * left, and nothing has changed.
 *
 *   PUT    /v1/storage/move         a bucket to move to: tried as connecting
 *                                   one is, then kept as where the move goes.
 *                                   (Google Drive is asked for on Google's own
 *                                   page: driveConnect.ts, `move: true`.)
 *   GET    /v1/storage/move         where the move under way is going
 *   GET    /v1/storage/move/list    what the new place holds so far
 *   POST   /v1/storage/move/copy    copy a few files across
 *   POST   /v1/storage/move/finish  the new place becomes the storage
 *   DELETE /v1/storage/move         stop: forget the new place
 *
 * The device drives it, because a Worker cannot: the free plan allows an
 * answer fifty requests of its own and ten milliseconds of CPU, and a library
 * is thousands of files. It lists both places, and names the files the new one
 * lacks a few at a time (`MOVE_COPY_MOST`); each is streamed from one store
 * into the other, never held. Closing the page loses nothing: the next look
 * finds what is already across and copies the rest.
 *
 * A place that already holds a library is refused as somewhere to move to.
 * The device copies snapshots last, so a move half done is not yet a library
 * and one begun again is taken up where it stopped.
 */

const noMove = (): DoormanError =>
  new DoormanError(409, DOORMAN_ERROR.noMove, 'nothing is being moved; start again')

const ALREADY_THERE = 'Your library is already there.'

/**
 * The account's storage, for a move out of it to `to`, whose kind is all that
 * is known of it yet. Refused with no storage to move from, and for Google
 * Drive to Google Drive: an account has one Drive, and its library is in it.
 */
export async function movable(
  ctx: Context,
  sub: string,
  to: AccountStorage['kind'],
): Promise<AccountStorage> {
  const from = await ctx.accounts.storage(sub, true)
  if (!from) throw new DoormanError(409, DOORMAN_ERROR.noStorage, 'connect your storage first')
  if (from.kind === 'drive' && to === 'drive') throw unprocessable(ALREADY_THERE)
  return from
}

/** Whether a place already has a library in it: a snapshot is what makes files one. */
export async function holdsLibrary(store: Store): Promise<boolean> {
  return (await store.list(SNAPSHOTS_FOLDER, null)).objects.length > 0
}

/** `GET /v1/storage/move` */
export async function state(ctx: Context): Promise<Response> {
  const session = await requireDevice(ctx)
  return json(await answer(ctx, session))
}

/** `PUT /v1/storage/move` — a bucket to move to, tried before it is kept. */
export async function start(ctx: Context): Promise<Response> {
  const session = await requireDevice(ctx)
  const input = await readJson(ctx.request, DoormanMoveStartSchema)
  const from = await movable(ctx, session.sub, 'bucket')
  const target =
    'backblaze' in input
      ? await backblazeBucket(ctx, input.backblaze)
      : bucketFrom(ctx, input.bucket)
  const to: AccountStorage = { kind: 'bucket', ...target }
  if (sameStorage(described(from), described(to))) throw unprocessable(ALREADY_THERE)
  if (await holdsLibrary(await tryBucket(ctx, target))) {
    throw unprocessable(
      'That bucket already has a library in it. Use an empty bucket, or another folder in it.',
    )
  }
  const before = await ctx.accounts.moving(session.sub)
  await ctx.accounts.startMove(session.sub, to)
  // A Google Drive the last move was going to is no longer going to be used.
  letGo(ctx, before, from.kind === 'drive' ? 'drive' : 'bucket')
  return json(await answer(ctx, session))
}

/** `DELETE /v1/storage/move` — stop. The storage is as it was; what was copied is left where it is. */
export async function stop(ctx: Context): Promise<Response> {
  const session = await requireDevice(ctx)
  const to = await ctx.accounts.moving(session.sub)
  if (to) {
    const from = await ctx.accounts.storage(session.sub, true)
    await ctx.accounts.stopMove(session.sub)
    letGo(ctx, to, from?.kind ?? null)
  }
  const body: DoormanMove = { to: null }
  return json(body)
}

/** `GET /v1/storage/move/list?cursor=<c>` — one page of everything the new place holds. */
export async function list(ctx: Context): Promise<Response> {
  const session = await requireDevice(ctx)
  const { to } = await places(ctx, session)
  const cursor = ctx.url.searchParams.get('cursor')
  if (cursor !== null && (cursor === '' || cursor.length > 4096)) {
    throw badRequest('that is not a cursor from a listing')
  }
  const page = await to.list('', cursor)
  const body: DoormanList = {
    objects: page.objects.filter(object => isCloudFileKey(object.key)),
    cursor: page.cursor,
  }
  return json(body)
}

/**
 * `POST /v1/storage/move/copy { keys, remove }` — copy these files to the new
 * place, and remove those from it.
 *
 * `format.json` is never copied: the new place has its own, written when it
 * was connected. Only snapshots and logs may be removed, which is what keeps
 * those two folders true copies when the old place prunes one mid-move. A
 * file the old place no longer has is passed over: the device lists again
 * before it finishes, and finds it gone there too.
 */
export async function copy(ctx: Context): Promise<Response> {
  const session = await requireDevice(ctx)
  const input = await readJson(ctx.request, DoormanMoveCopySchema)
  if (input.keys.some(key => !isCloudFileKey(key) || key === FORMAT_KEY)) {
    throw badRequest('that is not a file a move copies')
  }
  if (input.remove.some(key => !isCloudFileKey(key) || !isLookedAtCloudKey(key))) {
    throw badRequest('only a snapshot or a log file is removed by a move')
  }
  const { from, to } = await places(ctx, session)
  await Promise.all([
    ...input.keys.map(key => copyOne(from, to, key)),
    ...input.remove.map(key => to.remove(key)),
  ])
  return noContent()
}

/** One file, streamed from one store into the other with what it says of itself. */
async function copyOne(from: Store, to: Store, key: string): Promise<void> {
  const found = await from.fetchObject('GET', key, new Headers())
  if (!found) return
  const length = Number(found.headers.get('content-length') ?? Number.NaN)
  if (found.status !== 200 || !Number.isSafeInteger(length) || length < 0) {
    await discard(found)
    throw new DoormanError(502, DOORMAN_ERROR.bucketError, `could not read ${key} to move it`)
  }
  const options = {
    contentType: found.headers.get('content-type') ?? 'application/octet-stream',
    contentEncoding: found.headers.get('content-encoding'),
  }
  if (length === 0 || !found.body) {
    await discard(found)
    await to.write(key, new Uint8Array(0), options)
    return
  }
  await to.write(key, { stream: found.body, length }, options)
}

/**
 * `POST /v1/storage/move/finish` — the new place becomes the account's
 * storage, and remembers where the library came from (`movedFrom`), so a
 * server keeps its books (apps/server's `adoptTarget`).
 *
 * The device says when: it has listed both places and found nothing left to
 * copy. The doorman checks the one thing that would make finishing early a
 * loss rather than a wait — the newest snapshot, the library's own list of
 * itself, must be in the new place.
 *
 * The old place is left exactly as it was. A Google Drive's token is handed
 * back (`letGo`), so self.mp3 keeps no way into a Drive it no longer uses; the
 * files stay in it until the person deletes them there.
 */
export async function finish(ctx: Context): Promise<Response> {
  const session = await requireDevice(ctx)
  const previous = await ctx.accounts.storage(session.sub, true)
  const target = await ctx.accounts.moving(session.sub)
  if (!previous || !target) throw noMove()
  const from = openStore(previous, ctx.storeDeps)
  const to = openStore(target, ctx.storeDeps)

  const snapshots = (await from.list(SNAPSHOTS_FOLDER, null)).objects.map(object => object.key)
  const newest = newestSnapshotKey(snapshots)
  if (newest) {
    const copied = await to.fetchObject('HEAD', newest, new Headers())
    if (!copied)
      throw unprocessable('The move is not finished: the newest snapshot is not across yet.')
    await discard(copied)
  }

  await ctx.accounts.connect(session.sub, { ...target, movedFrom: described(previous) })
  await ctx.accounts.stopMove(session.sub)
  letGo(ctx, previous, target.kind)
  // Devices and servers look again, and find the same library in its new place.
  try {
    await changesOf(ctx, session).bump()
  } catch (error) {
    ctx.log.warn('the change counter could not be moved', { message: redact(messageOf(error)) })
  }
  return json(await ctx.accounts.me(session))
}

/**
 * `GET /v1/storage/space[?of=move]` — how much room the storage has, or the
 * place a move is going to. Null for a bucket.
 */
export async function space(ctx: Context): Promise<Response> {
  const session = await requireDevice(ctx)
  const storage =
    ctx.url.searchParams.get('of') === 'move'
      ? await ctx.accounts.moving(session.sub)
      : await ctx.accounts.storage(session.sub, true)
  if (!storage) {
    throw ctx.url.searchParams.get('of') === 'move'
      ? noMove()
      : new DoormanError(409, DOORMAN_ERROR.noStorage, 'connect your storage first')
  }
  const body: DoormanSpace = {
    space: storage.kind === 'drive' ? await new Drive(storage, ctx.storeDeps.drive).space() : null,
  }
  return json(body)
}

async function answer(ctx: Context, session: Session): Promise<DoormanMove> {
  const to = await ctx.accounts.moving(session.sub)
  return { to: to && described(to) }
}

/** Both ends of the move under way, opened. */
async function places(ctx: Context, session: Session): Promise<{ from: Store; to: Store }> {
  const from = await ctx.accounts.storage(session.sub, true)
  const to = await ctx.accounts.moving(session.sub)
  if (!from || !to) throw noMove()
  return { from: openStore(from, ctx.storeDeps), to: openStore(to, ctx.storeDeps) }
}
