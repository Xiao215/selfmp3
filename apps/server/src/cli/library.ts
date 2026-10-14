import { plural, type HubWorkspace } from '@selfmp3/shared'
import { CliUsageError } from './args.js'

/**
 * Which of a server's libraries a command means (docs/features/shared-server.md).
 *
 * A server works for every account that joined it, one library each, and a
 * request finds its library by the token it carries. From the server's own
 * computer it may name one by id instead (`HUB_LIBRARY_HEADER`), which is what
 * `--library` turns into: the id itself, or the email of the account. With no
 * `--library`, the only library is the one meant; with several, the command
 * stops and lists them rather than guessing.
 *
 * Kept pure so it can be tested without a server.
 */

/** The id to name, or null when the server's only library is meant without one. */
export function pickLibrary(
  workspaces: readonly HubWorkspace[],
  wanted: string | null,
): string | null {
  if (workspaces.length === 0) {
    throw new CliUsageError(
      'this server works for no libraries yet: an account joins it from the app',
    )
  }
  if (wanted === null) {
    if (workspaces.length === 1) return null
    throw new CliUsageError(
      `this server works for ${plural(workspaces.length, 'library', 'libraries')}; ` +
        `say which with --library <id or email>:\n${listing(workspaces)}`,
    )
  }
  const byId = workspaces.find(workspace => workspace.id === wanted)
  if (byId) return byId.id
  const email = wanted.toLowerCase()
  const byEmail = workspaces.filter(workspace => workspace.email?.toLowerCase() === email)
  if (byEmail.length === 1) return byEmail[0]!.id
  throw new CliUsageError(
    byEmail.length === 0
      ? `no library here is ${wanted}; these are:\n${listing(workspaces)}`
      : `${plural(byEmail.length, 'library', 'libraries')} here are ${wanted}; ` +
          `say which by id:\n${listing(byEmail)}`,
  )
}

/** One line a library: its id, its account and its size. */
function listing(workspaces: readonly HubWorkspace[]): string {
  return workspaces
    .map(
      workspace =>
        `    ${workspace.id}  ${workspace.email ?? (workspace.id === 'local' ? 'this server’s own' : 'account not known yet')}  ` +
        plural(workspace.songs, 'song', 'songs'),
    )
    .join('\n')
}
