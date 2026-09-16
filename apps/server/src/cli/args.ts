import { parseArgs } from 'node:util'

/**
 * Argument parsing for the `selfmp3` command, kept pure so it can be tested
 * without spawning anything. Only node's own `util.parseArgs` — the CLI is
 * meant to work from a bare checkout with no extra dependencies.
 */

export const COMMANDS = ['start', 'scan', 'import', 'backup', 'doctor', 'help'] as const

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
  /** Bearer token, when the server has one configured. */
  readonly token: string | null
}

export class CliUsageError extends Error {}

export const USAGE = `selfmp3 — a private music library you actually own

Usage: selfmp3 <command> [options]

Commands
  start                 run the server in the foreground
  scan                  rescan the library folder (server must be running)
  import <url...>       queue one or more links for download (server must be running)
  backup <dest-dir>     copy data/ and library/ into <dest-dir>, only what changed
  doctor                check node, yt-dlp, ffmpeg, the server and the folders
  help                  show this message

Options
  --url <base>          server address (default: http://localhost:$SELFMP3_PORT or 4600)
  --token <token>       bearer token, if SELFMP3_AUTH_TOKEN is set on the server
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
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  const url = values.url?.replace(/\/+$/, '') ?? null
  const token = values.token ?? null
  const [name, ...rest] = positionals

  if (values.version) return { command: { name: 'version' }, url, token }
  if (values.help || name === undefined || name === 'help') {
    return { command: { name: 'help' }, url, token }
  }

  switch (name) {
    case 'start':
    case 'scan':
    case 'doctor':
      if (rest.length > 0) throw new CliUsageError(`${name} takes no arguments`)
      return { command: { name }, url, token }
    case 'import':
      if (rest.length === 0) throw new CliUsageError('import needs at least one url')
      return { command: { name, urls: rest }, url, token }
    case 'backup': {
      const [dest] = rest
      if (!dest || rest.length > 1) throw new CliUsageError('backup needs exactly one <dest-dir>')
      return { command: { name, dest }, url, token }
    }
    default:
      throw new CliUsageError(`unknown command "${name}"`)
  }
}
