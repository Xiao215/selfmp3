/**
 * The round mark for an account, without the view (`Avatar.tsx`).
 */

/**
 * The letters on the round mark when the account has no picture: one from
 * each of the first two words of the name, or the first of the address.
 * Null when there is neither, and the plain figure is drawn instead.
 */
export function accountInitials(
  account: { name: string | null; email: string } | null,
): string | null {
  const name = account?.name?.trim()
  if (name) {
    const letters = name
      .split(/\s+/)
      .slice(0, 2)
      .map(word => Array.from(word)[0]?.toUpperCase() ?? '')
      .join('')
    if (letters) return letters
  }
  const email = account?.email.trim()
  return email ? (Array.from(email)[0]?.toUpperCase() ?? null) : null
}
