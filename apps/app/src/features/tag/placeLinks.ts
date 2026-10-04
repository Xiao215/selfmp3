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

/**
 * A tag opened from its Home tile. The stack is told by the address: a place
 * that grows out of its tile fades in and goes back into the tile, where one
 * opened any other way slides (`shell/pageStep.ts`), and a screen's move is
 * decided before the page is there to say how it was opened.
 */
export function tagFromTileLink(name: string) {
  return { pathname: '/tag/[name]', params: { name, via: 'tile' } } as const
}

/** Whether a route's params say it was opened from its Home tile. */
export function fromTile(params: object | undefined): boolean {
  return (params as { via?: unknown } | undefined)?.via === 'tile'
}

export function artistLink(name: string) {
  return { pathname: '/artist/[name]', params: { name } } as const
}
