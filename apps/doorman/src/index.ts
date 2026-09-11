import type { Env } from './context.js'
import { createDoorman } from './doorman.js'

/**
 * The Worker's entry point: the doorman, as Cloudflare runs it. Everything
 * is in doorman.ts; this file only hands it to the runtime.
 *
 * Nothing but the default export lives here. The runtime treats every other
 * export of this module as an entry point of its own.
 */
export default createDoorman() satisfies ExportedHandler<Env>
