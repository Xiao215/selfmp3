/**
 * Which place an address is, for whatever lights up while you are on it: the
 * sidebar's tag rows (docs/UI-MIGRATION.md, Phase 4).
 */

/**
 * Whether `pathname` is this tag's page, `/tag/<name>`. The name in an
 * address may arrive encoded ("night%20drive", or "%25" for a "%" and "%2E"
 * for a dot, `placeParam`) or not, and a tag's name is compared the way a new
 * tag is checked for a twin: trimmed, case ignored. Everything after
 * `/tag/` is the name, a "/" in it too: the router hands the address over
 * decoded, so "a/b" arrives as "/tag/a/b", and had never lit its row.
 */
export function onTagPage(pathname: string, name: string): boolean {
  const prefix = '/tag/'
  if (!pathname.startsWith(prefix)) return false
  const raw = pathname.slice(prefix.length)
  if (raw === '') return false
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // A stray "%" that is not an escape: the address as it stands is the name.
  }
  return decoded.trim().toLowerCase() === name.trim().toLowerCase()
}
