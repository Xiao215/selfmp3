/**
 * Where a tag and an artist live: `/tag/<name>` and `/artist/<name>`
 * (docs/UI-MIGRATION.md, "Routes after"). Every door to one goes through
 * here, so the address is written once.
 *
 * By name rather than id: an artist has no id, and a tag's name is what a
 * person would type or share. A tag renamed is a new address; the old one
 * says the tag is not there.
 */

/**
 * A name as the address carries it: the same name, for every name but two
 * kinds (bug bash F170).
 *
 * The router reads a param out of the address and then decodes it once more
 * for the screen, so a name with a "%" in it lost it on the way: "%2F" opened
 * the tag "/", which is no tag. Each "%" goes as "%25", which that second
 * decode gives back. And a name that is only dots, "." or "..", is a step
 * the browser takes before the router sees it — "/tag/.." is Home — so its
 * dots go as "%2E", which the same decode gives back as dots.
 */
export function placeParam(name: string): string {
  const kept = name.replace(/%/g, '%25')
  return /^\.+$/.test(kept) ? kept.replace(/\./g, '%2E') : kept
}

export function tagLink(name: string) {
  return { pathname: '/tag/[name]', params: { name: placeParam(name) } } as const
}

/**
 * A tag opened from its Home tile. The stack is told by the address: a place
 * that grows out of its tile fades in and goes back into the tile, where one
 * opened any other way slides (`shell/pageStep.ts`), and a screen's move is
 * decided before the page is there to say how it was opened.
 */
export function tagFromTileLink(name: string) {
  return { pathname: '/tag/[name]', params: { name: placeParam(name), via: 'tile' } } as const
}

/** Whether a route's params say it was opened from its Home tile. */
export function fromTile(params: object | undefined): boolean {
  return (params as { via?: unknown } | undefined)?.via === 'tile'
}

export function artistLink(name: string) {
  return { pathname: '/artist/[name]', params: { name: placeParam(name) } } as const
}
