/**
 * The library the reference set is captured against.
 *
 * `docs/UNIVERSAL.md` asks for the captures to be made "with the same seeded
 * library (the thirteen songs the dev server has)". Thirteen songs is what the
 * dev library has and no more: no playlists, one tag, nothing loved. Half the
 * states in the reference table — a smart playlist with its rules open, an
 * empty playlist, one tag filtered and another excluded — cannot be reached
 * from that, so this makes them, through the API, before anything is captured.
 *
 * It is idempotent, and it is the reason the set is reproducible rather than a
 * one-off: anyone with the dev library can run it and get the same screens.
 * Everything it creates is prefixed so it can be told apart from real data.
 */

const API = process.env.SELFMP3_API_URL ?? 'http://localhost:4600'

/** Named so a human reading their own library knows where these came from. */
export const SEEDED = {
  tag: 'reference',
  manual: 'Reference — evening',
  smart: 'Reference — long songs',
  empty: 'Reference — nothing yet',
} as const

type Json = Record<string, unknown>

async function api<T>(method: string, path: string, body?: Json): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as T
}

interface Library {
  songs: Array<{ id: number; title: string; duration: number; loved: boolean; tagIds: number[] }>
  tags: Array<{ id: number; name: string }>
  playlists: Array<{ id: number; name: string }>
}

export async function seedReferenceLibrary(): Promise<void> {
  const library = await api<Library>('GET', '/api/library')
  if (library.songs.length === 0) {
    throw new Error(
      'The dev library is empty. The reference set is the old app with real songs in ' +
        'it; capturing an empty one would prove nothing. See verify/README.md.',
    )
  }

  // A second tag, so "one tag filtered, one excluded" is a real state rather
  // than a filter and an empty list. The longest six songs get it, which is
  // arbitrary but fixed, so the same songs carry it on every run.
  let tag = library.tags.find(t => t.name === SEEDED.tag)
  if (!tag) tag = await api<{ id: number; name: string }>('POST', '/api/tags', { name: SEEDED.tag })
  const longest = [...library.songs].sort((a, b) => b.duration - a.duration).slice(0, 6)
  await api('POST', '/api/tags/bulk', {
    tagId: tag.id,
    songIds: longest.map(s => s.id),
    action: 'add',
  })

  const byName = new Map(library.playlists.map(p => [p.name, p.id]))

  // A manual list with songs in it.
  if (!byName.has(SEEDED.manual)) {
    const playlist = await api<{ id: number }>('POST', '/api/playlists', {
      name: SEEDED.manual,
      description: 'Five songs, in the order they were added.',
    })
    await api('POST', `/api/playlists/${playlist.id}/songs`, {
      songIds: library.songs.slice(0, 5).map(s => s.id),
    })
  }

  // A smart list, whose rules are the thing being captured.
  if (!byName.has(SEEDED.smart)) {
    await api('POST', '/api/playlists', {
      name: SEEDED.smart,
      description: 'Everything over three and a half minutes.',
      kind: 'smart',
      rules: {
        match: 'all',
        rules: [{ field: 'duration', op: 'gt', value: 210 }],
        orderBy: 'duration',
        order: 'desc',
        limit: null,
      },
    })
  }

  // And one with nothing in it, for the empty state.
  if (!byName.has(SEEDED.empty)) {
    await api('POST', '/api/playlists', {
      name: SEEDED.empty,
      description: 'Deliberately empty, for the empty state.',
    })
  }

  // A loved song, so the heart is filled somewhere in the set.
  const loved = library.songs.find(s => s.loved)
  if (!loved) {
    const first = library.songs[0]
    if (first) await api('POST', `/api/songs/${first.id}/loved`, { loved: true })
  }
}
