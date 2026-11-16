import {
  DOORMAN_ERROR,
  DoormanError,
  FORMAT_KEY,
  LOG_FOLDER,
  MOVE_COPY_MOST,
  SNAPSHOTS_FOLDER,
  isLookedAtCloudKey,
  type DoormanList,
  type DoormanSpace,
} from '@selfmp3/shared'

/**
 * Moving a library to another place, as the device drives it
 * (apps/doorman/src/move.ts has the doorman's half, and why a device drives).
 *
 * A round lists the old place and the new one, works out what the new one
 * lacks (`movePlan`), and has the doorman copy it a few files at a time. Rounds
 * repeat until one finds nothing to do: a song imported meanwhile is simply in
 * the next round. Only then is the doorman told to finish, which is the
 * moment the new place becomes the storage.
 *
 * Nothing is kept here between runs. A move stopped half way — the page
 * closed, the phone locked — starts again by listing, and finds what is
 * already across.
 */

type Listed = DoormanList['objects'][number]

/** What the driver asks of the doorman: session.ts's `moveApi` in the app, a stand-in in tests. */
export interface MoveApi {
  /** One page of everything in the storage. */
  listFrom: (cursor: string | null) => Promise<DoormanList>
  /** One page of everything in the place the move is going to. */
  listTo: (cursor: string | null) => Promise<DoormanList>
  /** The room in the place the move is going to, or null where there is no limit to ask about. */
  room: () => Promise<DoormanSpace['space']>
  copy: (keys: readonly string[], remove: readonly string[]) => Promise<void>
  finish: () => Promise<void>
}

export type MoveProgress =
  /** Listing both places. */
  | { readonly phase: 'looking' }
  /** Copying songs: how many of the library's are across. */
  | { readonly phase: 'songs'; readonly done: number; readonly total: number }
  /** Copying everything else: covers, lyrics, and last the library's own records. */
  | { readonly phase: 'rest'; readonly done: number; readonly total: number }
  | { readonly phase: 'finishing' }

/** Why a move stopped short, in words for the page. The move can be taken up again. */
export class MoveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoveError'
  }
}

/** What one round has to do, in the order it is done. */
interface MovePlan {
  /** Songs the new place lacks. */
  readonly songs: readonly Listed[]
  /** Everything else it lacks, the library's own records last: logs, then snapshots. */
  readonly rest: readonly Listed[]
  /** Snapshots and logs in the new place that the old one no longer has. */
  readonly remove: readonly string[]
  /** How many songs the library has, and how many of them are already across. */
  readonly songsTotal: number
  readonly songsAcross: number
}

const isSong = (key: string): boolean => key.startsWith('audio/')

/** Where a file comes in the copying: songs, then pictures and words, then logs, then snapshots. */
function turn(key: string): number {
  if (isSong(key)) return 0
  if (key.startsWith(SNAPSHOTS_FOLDER)) return 3
  if (key.startsWith(LOG_FOLDER)) return 2
  return 1
}

/**
 * What the new place lacks of the old one's files, by name and size.
 * `format.json` is each place's own and never copied. Snapshots go last: a
 * snapshot is what makes a place a library, so a move half done is not one.
 */
export function movePlan(from: readonly Listed[], to: readonly Listed[]): MovePlan {
  const across = new Map(to.map(object => [object.key, object.size]))
  const kept = new Set(from.map(object => object.key))
  const lacking = from
    .filter(object => object.key !== FORMAT_KEY && across.get(object.key) !== object.size)
    .sort((a, b) => turn(a.key) - turn(b.key) || (a.key < b.key ? -1 : 1))
  const songs = lacking.filter(object => isSong(object.key))
  const songsTotal = from.filter(object => isSong(object.key)).length
  return {
    songs,
    rest: lacking.filter(object => !isSong(object.key)),
    remove: to.map(object => object.key).filter(key => isLookedAtCloudKey(key) && !kept.has(key)),
    songsTotal,
    songsAcross: songsTotal - songs.length,
  }
}

/** Rounds before a library that never stops changing is given up on for now. */
const ROUNDS_MOST = 6
/** Batches sent at once: each is up to `MOVE_COPY_MOST` files copied side by side. */
const TOGETHER = 2
/** Goes at a batch the storage or the network refused for a moment. */
const TRIES = 3
const TRY_AGAIN_MS = 2000

interface MoveOptions {
  readonly onProgress?: (progress: MoveProgress) => void
  /** Stop asked for: the move ends after the batches under way, having changed nothing. */
  readonly stopped?: () => boolean
  readonly wait?: (ms: number) => Promise<void>
}

/**
 * Run the move to its end. Answers `false` when it was stopped (`stopped`),
 * `true` once the doorman has made the new place the storage. Throws
 * `MoveError`, or the doorman's own refusal, when it cannot go on.
 */
export async function runMove(api: MoveApi, options: MoveOptions = {}): Promise<boolean> {
  const say = options.onProgress ?? (() => undefined)
  const stopped = options.stopped ?? (() => false)
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  for (let round = 1; ; round++) {
    say({ phase: 'looking' })
    const [from, to] = await Promise.all([all(api.listFrom), all(api.listTo)])
    const plan = movePlan(from, to)
    if (plan.songs.length + plan.rest.length + plan.remove.length === 0) break
    if (round > ROUNDS_MOST) {
      throw new MoveError('The library kept changing while it was being moved. Try again.')
    }
    if (round === 1) await checkRoom(api, plan)
    if (stopped()) return false

    const send = async (keys: readonly string[], remove: readonly string[]): Promise<void> => {
      for (let attempt = 1; ; attempt++) {
        try {
          await api.copy(keys, remove)
          return
        } catch (error) {
          if (attempt >= TRIES || !passing(error)) throw error
          await wait(TRY_AGAIN_MS * attempt)
        }
      }
    }

    let songsAcross = plan.songsAcross
    const songsDone = await together(batches(plan.songs), stopped, async batch => {
      await send(batch, [])
      songsAcross += batch.length
      say({ phase: 'songs', done: songsAcross, total: plan.songsTotal })
    })
    if (!songsDone) return false

    // Logs and snapshots are a few small files at the very end, and go one
    // batch at a time so the newest snapshot is the last thing to arrive.
    const records = plan.rest.filter(object => isLookedAtCloudKey(object.key))
    const others = plan.rest.filter(object => !isLookedAtCloudKey(object.key))
    let restAcross = 0
    const count = async (batch: readonly string[], remove: readonly string[]): Promise<void> => {
      await send(batch, remove)
      restAcross += batch.length
      say({ phase: 'rest', done: restAcross, total: plan.rest.length })
    }
    if (!(await together(batches(others), stopped, batch => count(batch, [])))) return false
    for (const batch of batches(records)) {
      if (stopped()) return false
      await count(batch, [])
    }
    for (let at = 0; at < plan.remove.length; at += MOVE_COPY_MOST) {
      if (stopped()) return false
      await send([], plan.remove.slice(at, at + MOVE_COPY_MOST))
    }
  }

  if (stopped()) return false
  say({ phase: 'finishing' })
  await api.finish()
  return true
}

/** Refuse before copying anything when the new place plainly has no room for it. */
async function checkRoom(api: MoveApi, plan: MovePlan): Promise<void> {
  const room = await api.room()
  if (!room || room.limit === null) return
  const needed = [...plan.songs, ...plan.rest].reduce((sum, object) => sum + object.size, 0)
  const free = Math.max(0, room.limit - room.used)
  if (needed > free) {
    throw new MoveError(
      `There is not enough room: ${bytesInWords(needed)} to move, and ${bytesInWords(free)} free in your Google storage.`,
    )
  }
}

/** "4.1 GB", "310 MB": a size as storage is spoken of, in powers of 1024. */
export function bytesInWords(bytes: number): string {
  const GB = 1024 ** 3
  const MB = 1024 ** 2
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1)} GB`
  return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / MB))} MB`
}

/** The storage or the network refusing for a moment: the same request will do shortly. */
function passing(error: unknown): boolean {
  return (
    error instanceof DoormanError &&
    // Not `unanswered`: a full Drive and a refused key are 502s too, and final.
    (error.status === 0 ||
      error.code === DOORMAN_ERROR.bucketBusy ||
      error.code === DOORMAN_ERROR.bucketUnreachable)
  )
}

async function all(page: (cursor: string | null) => Promise<DoormanList>): Promise<Listed[]> {
  const objects: Listed[] = []
  let cursor: string | null = null
  do {
    const listed: DoormanList = await page(cursor)
    objects.push(...listed.objects)
    cursor = listed.cursor
  } while (cursor !== null)
  return objects
}

function batches(objects: readonly Listed[]): string[][] {
  const out: string[][] = []
  for (let at = 0; at < objects.length; at += MOVE_COPY_MOST) {
    out.push(objects.slice(at, at + MOVE_COPY_MOST).map(object => object.key))
  }
  return out
}

/** Run the batches a few at once, in order. False when a stop was asked for before the end. */
async function together(
  work: readonly string[][],
  stopped: () => boolean,
  run: (batch: string[]) => Promise<void>,
): Promise<boolean> {
  let next = 0
  let halted = false
  const lane = async (): Promise<void> => {
    for (;;) {
      if (stopped()) {
        halted = true
        return
      }
      const batch = work[next++]
      if (!batch) return
      await run(batch)
    }
  }
  await Promise.all(Array.from({ length: Math.min(TOGETHER, work.length) }, lane))
  return !halted
}
