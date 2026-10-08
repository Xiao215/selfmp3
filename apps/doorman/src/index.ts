import type { Env } from './context.js'
import { createDoorman } from './doorman.js'

/**
 * The Worker's entry point: the doorman, as Cloudflare runs it. Everything
 * is in doorman.ts; this file only hands it to the runtime.
 *
 * Nothing but the default export and the Durable Object class lives here.
 * The runtime treats every export of this module as an entry point of its
 * own, and finds a Durable Object class by the name wrangler.toml gives it.
 */
export default createDoorman() satisfies ExportedHandler<Env>

export { ChangesObject as Changes } from './changes.js'
