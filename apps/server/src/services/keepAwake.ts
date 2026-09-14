import { spawn } from 'node:child_process'
import type { Logger } from '../logger.js'

/**
 * Keeps the server awake while it is actually doing something for somebody.
 *
 * The usual way this server fails is not a crash: it is a laptop deciding it
 * has been idle for ten minutes, at which point the phone in the next room
 * stops mid-song and the library goes dark until someone touches the keyboard.
 * The server is busy — it is streaming — but nothing tells macOS that, because
 * serving HTTP is not something the power manager knows to count.
 *
 * `caffeinate -i` is how a process says so: it holds an assertion against idle
 * sleep for as long as it runs. One is held here while at least one thing that
 * matters is in flight — a song being streamed, an import being fetched — and
 * dropped when the last of them finishes, so a machine nobody is using still
 * sleeps.
 *
 * **What this does not do.** `-i` prevents *idle* sleep only. Closing a
 * laptop's lid still sleeps it, and no assertion short of the ones Apple
 * reserves for itself changes that; `docs/SETUP.md` covers the lid case. On a
 * desktop, or a laptop with the lid open, this is the whole of it.
 */

/**
 * How long the assertion outlives the last holder.
 *
 * Between two songs there is a gap: one stream ends, the player asks for the
 * next, and for a moment nothing is in flight. Without a grace period that gap
 * spawns and kills a process per track, and — worse — briefly tells macOS the
 * machine is idle while somebody is plainly listening to it.
 */
export const LINGER_MS = 90_000

export interface KeepAwakeService {
  /** Say something is in flight. Call the returned function when it is done. */
  hold(): () => void
  /** Drop the assertion now, whatever is outstanding. For shutdown. */
  stop(): void
  /** Whether an assertion is currently held. For tests and diagnostics. */
  readonly active: boolean
}

/** What this needs of a child process, so a test can hand it something else. */
export interface Caffeinator {
  kill(): void
  once(event: 'error' | 'exit', listener: (error: Error) => void): void
}

export interface KeepAwakeOptions {
  platform?: NodeJS.Platform
  /** Overridden in tests; nothing else should need to. */
  spawnCaffeinate?: () => Caffeinator
}

export function createKeepAwake(
  logger: Logger,
  { platform = process.platform, spawnCaffeinate }: KeepAwakeOptions = {},
): KeepAwakeService {
  // `caffeinate` is macOS's. Everywhere else this is all no-ops, which is the
  // honest answer: a Linux box in a cupboard has its own opinions about sleep.
  const supported = platform === 'darwin'
  const spawnOne: () => Caffeinator =
    spawnCaffeinate ?? (() => spawn('caffeinate', ['-i'], { stdio: 'ignore', detached: false }))

  let held = 0
  let child: Caffeinator | null = null
  let linger: NodeJS.Timeout | null = null

  function start(): void {
    if (child || !supported) return
    try {
      child = spawnOne()
      child.once('error', (error: Error) => {
        // No caffeinate on this machine, somehow. Worth one line, not a crash.
        logger.warn('could not hold the machine awake', { message: error.message })
        child = null
      })
      // If it dies on its own, forget it rather than holding a dead reference
      // and never starting another.
      child.once('exit', () => {
        child = null
      })
      logger.debug('holding the machine awake')
    } catch (error) {
      logger.warn('could not hold the machine awake', {
        message: error instanceof Error ? error.message : String(error),
      })
      child = null
    }
  }

  function release(): void {
    if (!child) return
    child.kill()
    child = null
    logger.debug('letting the machine sleep again')
  }

  return {
    hold(): () => void {
      held += 1
      if (linger) {
        clearTimeout(linger)
        linger = null
      }
      start()

      let done = false
      return () => {
        // A caller that releases twice must not take someone else's hold with
        // it; streams end in more than one way (finish, close, error).
        if (done) return
        done = true
        held -= 1
        if (held > 0) return
        if (linger) clearTimeout(linger)
        linger = setTimeout(() => {
          linger = null
          if (held === 0) release()
        }, LINGER_MS)
        linger.unref()
      }
    },

    stop(): void {
      if (linger) {
        clearTimeout(linger)
        linger = null
      }
      held = 0
      release()
    },

    get active(): boolean {
      return child !== null
    },
  }
}
