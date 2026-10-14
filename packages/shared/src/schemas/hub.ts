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
  /**
   * How it reaches its account's bucket: a grant the account gave this server;
   * a device's sign-in from before workspaces, not yet swapped for one; or
   * nothing — the folder bucket's library, or one from before that never
   * signed in.
   */
  grant: z.enum(['granted', 'from-before', 'none']),
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
