import type { DoormanAccess, DoormanAccessUpdate } from '@selfmp3/shared'

/**
 * Settings › Who can sign in, without the screen: the doorman's allow list as
 * its owner changes it (apps/doorman/src/access.ts). Each change sends the
 * whole list, so these work out the next one from the one shown.
 */

/** Loose on purpose: the doorman checks properly, and says so when it refuses. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The list with one more address, or what is wrong with the one typed. */
export function withEmail(
  access: DoormanAccess,
  typed: string,
): { readonly update: DoormanAccessUpdate } | { readonly problem: string } {
  const email = typed.trim().toLowerCase()
  if (!LOOKS_LIKE_EMAIL.test(email)) return { problem: 'That isn’t an email address.' }
  if (access.owners.includes(email)) return { problem: 'Owners can always sign in.' }
  if (access.emails.includes(email)) return { problem: 'They’re already on the list.' }
  return { update: { anyone: access.anyone, emails: [...access.emails, email] } }
}

export function withoutEmail(access: DoormanAccess, email: string): DoormanAccessUpdate {
  return { anyone: access.anyone, emails: access.emails.filter(each => each !== email) }
}

/** The line under the panel's switch, saying what it means right now. */
export function anyoneHint(access: DoormanAccess): string {
  return access.anyone
    ? 'Any Google account can sign in. The people below are kept for when you turn this off.'
    : 'Off: only you and the people below.'
}
