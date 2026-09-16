/**
 * A tiny structured logger.
 *
 * A dependency like pino would be overkill for a single-user server that logs
 * to a terminal or a launchd file. This gives levelled, timestamped, greppable
 * output in about forty lines and adds nothing to the install.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

const LEVEL_COLOR: Record<Exclude<LogLevel, 'silent'>, string> = {
  debug: '[90m',
  info: '[36m',
  warn: '[33m',
  error: '[31m',
}

const RESET = '[0m'
const DIM = '[90m'

type LogFn = (message: string, fields?: Record<string, unknown>) => void

/**
 * Declared with property-arrow signatures rather than method shorthand.
 *
 * These are routinely passed around detached — `const log = status >= 500 ?
 * logger.error : logger.warn` — and method shorthand would make that a lint
 * error about `this` binding. Property syntax says what is true: these are
 * properties holding closures, with no `this` to lose.
 */
export interface Logger {
  readonly debug: LogFn
  readonly info: LogFn
  readonly warn: LogFn
  readonly error: LogFn
  readonly child: (scope: string) => Logger
}

/** Colour only when a human is watching; launchd log files stay clean. */
const useColor = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined

/**
 * Render one log field.
 *
 * Every branch is explicit because a bare `String(value)` on an `unknown`
 * happily produces `[object Object]`, which is the least useful thing a log
 * line can say.
 */
function render(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (value === null) return 'null'
  try {
    return JSON.stringify(value) ?? '?'
  } catch {
    // Circular structure, or a BigInt inside an object.
    return '[unserialisable]'
  }
}

function formatFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    parts.push(`${key}=${render(value)}`)
  }
  if (parts.length === 0) return ''
  return useColor ? ` ${DIM}${parts.join(' ')}${RESET}` : ` ${parts.join(' ')}`
}

export function createLogger(level: LogLevel, scope = ''): Logger {
  const threshold = LEVEL_RANK[level]

  function emit(
    lineLevel: Exclude<LogLevel, 'silent'>,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVEL_RANK[lineLevel] < threshold) return
    const time = new Date().toISOString().slice(11, 19)
    const tag = lineLevel.toUpperCase().padEnd(5)
    const prefix = useColor
      ? `${DIM}${time}${RESET} ${LEVEL_COLOR[lineLevel]}${tag}${RESET}`
      : `${time} ${tag}`
    const where = scope ? (useColor ? `${DIM}[${scope}]${RESET} ` : `[${scope}] `) : ''
    const line = `${prefix} ${where}${message}${formatFields(fields)}`
    // Trouble to stderr, everything else to stdout. Not a formality: the
    // launchd job sends the two to different files (scripts/install-service.sh
    // — selfmp3.log and selfmp3.error.log), and sending both to stderr, which
    // `console.warn` does, left the first empty and filled the second with
    // routine successes. The `no-console` rule allows only warn and error,
    // which is how that happened; here stdout is the point.
    if (lineLevel === 'error' || lineLevel === 'warn') console.error(line)
    // eslint-disable-next-line no-console -- stdout is the point; see above
    else console.log(line)
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: childScope => createLogger(level, scope ? `${scope}:${childScope}` : childScope),
  }
}
