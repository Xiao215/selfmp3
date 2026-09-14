/**
 * The contract between the Electron shell and the page it renders.
 *
 * Imported by both `apps/desktop`, which implements it, and `apps/app`, which
 * consumes it. See `bridge.ts` for the shape and `schemas.ts` for the rules
 * each side parses with.
 */
export * from './bridge.js'
export * from './channels.js'
export * from './menu.js'
export * from './schemas.js'
