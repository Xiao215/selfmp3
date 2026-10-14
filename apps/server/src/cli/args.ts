import { parseArgs } from 'node:util'
import { DEFAULT_SERVER_PORT } from '@selfmp3/shared'

/**
 * Argument parsing for the `selfmp3` command, kept pure so it can be tested
 * without spawning anything. Only node's own `util.parseArgs` — the CLI is
 * meant to work from a bare checkout with no extra dependencies.
 */

export type Command =
  | { readonly name: 'start' }
  | { readonly name: 'scan' }
  | { readonly name: 'import'; readonly urls: readonly string[] }
  | { readonly name: 'backup'; readonly dest: string }
  | { readonly name: 'doctor' }
  | { readonly name: 'help' }
  | { readonly name: 'version' }

interface ParsedCli {
  readonly command: Command
  /** Base URL of a running server, e.g. `http://localhost:4600`. */
  readonly url: string | null
  /** A library's token, for a server on another computer; this one's needs none. */
  readonly token: string | null
  /**
   * Which library, by its id or its account's email, on a server on this
   * computer that works for several (`cli/library.ts`).
   */
  readonly library: string | null
}

export class CliUsageError extends Error {}

export const USAGE = `selfmp3 — a private music library you actually own

Usage: selfmp3 <command> [options]

Commands
  start                 run the server in the foreground
  scan                  import what was dropped into the inbox folder (server must be running)
  import <url...>       queue one or more links for download (server must be running)
  backup <dest-dir>     copy the music and the database into <dest-dir>, only what changed
  doctor                check node, yt-dlp, ffmpeg, the server and the folders
  help                  show this message

Options
  --url <base>          server address (default: http://localhost:$SELFMP3_PORT or ${DEFAULT_SERVER_PORT})
  --library <id|email>  which library, when the server works for several (this computer only)
  --token <token>       the library's token, when --url is another computer (in its hub.json)
  --version, -v         print the version
  --help, -h            show this message
`

export function parseCli(argv: readonly string[]): ParsedCli {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      url: { type: 'string' },
      token: { type: 'string' },
      library: { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  const url = values.url?.replace(/\/+$/, '') ?? null
  const token = values.token ?? null
  const library = values.library?.trim() || null
  if (token !== null && library !== null) {
    throw new CliUsageError('give --library or --token, not both: a token names its library')
  }
  const options = { url, token, library }
  const [name, ...rest] = positionals

  if (values.version) return { command: { name: 'version' }, ...options }
  if (values.help || name === undefined || name === 'help') {
    return { command: { name: 'help' }, ...options }
  }

  switch (name) {
    case 'start':
    case 'scan':
    case 'doctor':
      if (rest.length > 0) throw new CliUsageError(`${name} takes no arguments`)
      return { command: { name }, ...options }
    case 'import':
      if (rest.length === 0) throw new CliUsageError('import needs at least one url')
      return { command: { name, urls: rest }, ...options }
    case 'backup': {
      const [dest] = rest
      if (!dest || rest.length > 1) throw new CliUsageError('backup needs exactly one <dest-dir>')
      return { command: { name, dest }, ...options }
    }
    default:
      throw new CliUsageError(`unknown command "${name}"`)
  }
}
