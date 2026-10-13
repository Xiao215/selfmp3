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
