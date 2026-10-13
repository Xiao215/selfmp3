import type { DoormanGrant } from '@selfmp3/shared'

/**
 * Settings › Account › Computers, without the screen
 * (docs/features/shared-server.md): the servers this account has let into
 * its bucket, and the one this build offers when there are none.
 */

/** A server's address as a person reads it: the host, without the scheme. */
export function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '')
}

/** One computer's row: its own name, and where it is. */
export function computerRow(grant: DoormanGrant): { label: string; hint: string } {
  const host = hostOf(grant.server)
  return {
    label: grant.name && grant.name !== host ? grant.name : 'A computer',
    hint: `${host} · works in your storage while your devices are away.`,
  }
}

/**
 * The line when none has been let in: the shared one, when this build offers
 * it, else what a library without a computer goes without.
 */
export function noComputersHint(offered: string): string {
  return offered
    ? `None yet. ${hostOf(offered)} can import, keep your Stats and run Smart features for you, in your own storage.`
    : 'None. Importing, Stats and Smart features need a computer running self.mp3.'
}
