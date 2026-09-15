/**
 * The You page, without the screen: which rows it lists and what each says.
 *
 * You is the phone's fourth tab. It gathers the pages a computer keeps in its
 * sidebar and a phone had nowhere to put: Stats, Untagged and Tags, with
 * Settings, which used to have the tab to itself.
 */

export type YouRowId = 'stats' | 'inbox' | 'tags' | 'settings'

export interface YouRow {
  readonly id: YouRowId
  readonly label: string
  readonly href: string
  /** Quiet text before the chevron: "328 plays this month", "2". */
  readonly hint: string | null
  /** A number worth drawing as a pill: songs still waiting for a tag. */
  readonly count: number | null
}

const plural = (count: number, one: string, many: string): string =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`

export function youRows({
  fromCloud,
  plays,
  untagged,
  tags,
}: {
  /** A cloud library: no server behind it, so no Stats and no Untagged (both ask the server). */
  fromCloud: boolean
  /** Plays in the last thirty days — Stats' opening window — once known. */
  plays: number | undefined
  /** Songs without a tag, once the library has loaded. */
  untagged: number | undefined
  tags: number | undefined
}): readonly YouRow[] {
  const rows: YouRow[] = []
  if (!fromCloud) {
    rows.push({
      id: 'stats',
      label: 'Stats & report',
      href: '/stats',
      hint: plays === undefined ? null : `${plural(plays, 'play', 'plays')} this month`,
      count: null,
    })
    rows.push({
      id: 'inbox',
      label: 'Untagged',
      href: '/inbox',
      hint: untagged === 0 ? 'All tagged' : null,
      count: untagged ? untagged : null,
    })
  }
  rows.push({
    id: 'tags',
    label: 'Tags',
    href: '/tags',
    hint: tags === undefined ? null : tags.toLocaleString(),
    count: null,
  })
  rows.push({ id: 'settings', label: 'Settings', href: '/settings', hint: null, count: null })
  return rows
}
