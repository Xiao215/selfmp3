/**
 * The You page, without the screen: which rows it lists and what each says.
 *
 * You is behind the avatar on a phone's Home. It gathers the pages a computer keeps in its
 * sidebar and a phone has nowhere else to put: Stats and Tags, with Settings.
 * Songs without a tag are not a page any more: All tags leads with a card for
 * them (docs/UI-MIGRATION.md, Phase 4).
 *
 * Every row is here for every kind of library. Stats needs the server, and the
 * page it opens says so when there is none in reach; a row that vanished
 * instead told a device signed in to the cloud that self.mp3 has no stats.
 */

export type YouRowId = 'stats' | 'tags' | 'settings'

export interface YouRow {
  readonly id: YouRowId
  readonly label: string
  readonly href: string
  /** Quiet text before the chevron: "328 plays this month", "2". */
  readonly hint: string | null
}

const plural = (count: number, one: string, many: string): string =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`

export function youRows({
  plays,
  tags,
}: {
  /**
   * Plays in the last thirty days — Stats' opening window — once known. A cloud
   * library only knows once it has reached its server, and says nothing until.
   */
  plays: number | undefined
  tags: number | undefined
}): readonly YouRow[] {
  return [
    {
      id: 'stats',
      label: 'Stats & report',
      href: '/stats',
      hint: plays === undefined ? null : `${plural(plays, 'play', 'plays')} this month`,
    },
    {
      id: 'tags',
      label: 'Tags',
      href: '/tags',
      hint: tags === undefined ? null : tags.toLocaleString(),
    },
    { id: 'settings', label: 'Settings', href: '/settings', hint: null },
  ]
}
