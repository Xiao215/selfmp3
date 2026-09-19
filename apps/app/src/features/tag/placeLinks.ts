/**
 * Where a tag and an artist live: `/tag/<name>` and `/artist/<name>`
 * (docs/UI-MIGRATION.md, "Routes after"). Every door to one goes through
 * here, so the address is written once.
 *
 * By name rather than id: an artist has no id, and a tag's name is what a
 * person would type or share. A tag renamed is a new address; the old one
 * says the tag is not there.
 */

export function tagLink(name: string) {
  return { pathname: '/tag/[name]', params: { name } } as const
}

export function artistLink(name: string) {
  return { pathname: '/artist/[name]', params: { name } } as const
}
