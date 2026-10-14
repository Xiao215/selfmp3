import { z } from 'zod'

/**
 * A server working for several accounts (docs/features/shared-server.md): who
 * it works for, as its own page lists them. Asked only from the server's own
 * machine. Joining is answered with a `CloudServer`, the same addresses and
 * token a snapshot names.
 */
export const HubWorkspaceSchema = z.object({
  /** `local` for the one library of a folder bucket. */
  id: z.string(),
  email: z.string().nullable(),
  songs: z.number().int().nonnegative(),
  /** Whether its bucket is reachable and connected. */
  connected: z.boolean(),
  joinedAt: z.string().nullable(),
})
export type HubWorkspace = z.infer<typeof HubWorkspaceSchema>

export const HubStatusSchema = z.object({ workspaces: z.array(HubWorkspaceSchema) })
export type HubStatus = z.infer<typeof HubStatusSchema>

/**
 * Which library a request from the server's own machine means, by its id in
 * `GET /api/hub`, when it carries no token. The server's page and the
 * `selfmp3` command send it on a server working for several. From anywhere
 * else it is ignored: a library is only ever named there by its token.
 */
export const HUB_LIBRARY_HEADER = 'X-Selfmp3-Library'

/**
 * Where the doorman tells a server that one of its grants was taken back
 * (Settings › Account › Computers › Remove, or signing out everywhere), so it
 * lets the library go at once rather than at its next look at the bucket.
 */
export const HUB_CHECK_PATH = '/api/hub/check'

/**
 * `POST /api/hub/check`: which grant to look at again. It carries nothing
 * secret and proves nothing. The server only asks the doorman, with the
 * grant's own token, whether it still holds, so whoever sends it can at most
 * make the server ask a little sooner than it would have.
 */
export const HubCheckSchema = z.object({
  grant: z.string().regex(/^[0-9a-f]{16}$/, 'not a grant id'),
})
export type HubCheck = z.infer<typeof HubCheckSchema>
