import { useCallback, useState } from 'react'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import type { SmartRules, SortDirection, SongSortField } from '@selfmp3/shared'
import { clientApi, queryKeys } from '@selfmp3/client'

import { showToast } from '../../ui/toast'

/**
 * Keeping the tags you are listening to as a playlist.
 *
 * It asks nothing. A name you have to approve before the music you are already
 * enjoying can be kept is three decisions — read the suggestion, decide whether
 * it is yours, decide whether to delete it — for something you had already
 * decided to do. So it saves, the playlist appears in the sidebar as it is
 * made, and the message that follows offers the only two things anyone wants
 * afterwards: a different name, or not to have done it.
 *
 * What it makes follows the tags. Picking tags to build a list and then wanting
 * that list to go stale is not a thing anybody means; and if it is, *Stop
 * following* on the playlist is one press and keeps every song. So there is no
 * question here either.
 */
export function useSaveTagsAsPlaylist(): {
  save: (input: {
    name: string
    tagIds: readonly number[]
    sort: SongSortField
    descending: boolean
  }) => void
  /** True from the press until the playlist exists, so the button can say so. */
  saving: boolean
  /**
   * The name last saved from this screen, or null.
   *
   * A name rather than an id, because what the button needs to know is whether
   * *what is on screen now* has been kept: the caller compares it with the
   * heading, so changing a tag offers Save again without anything having to be
   * reset. Undo clears it, and so does a failure.
   */
  savedName: string | null
} {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState<string | null>(null)

  const save = useCallback(
    (input: {
      name: string
      tagIds: readonly number[]
      sort: SongSortField
      descending: boolean
    }) => {
      if (input.tagIds.length === 0) return
      setSaving(true)
      void (async () => {
        try {
          const created = await clientApi().createPlaylist({
            name: input.name,
            description: '',
            kind: 'live',
            rules: followRules(input),
          })
          void queryClient.invalidateQueries({ queryKey: queryKeys.library })
          setSavedName(created.name)
          showToast(`Saved “${created.name}” — it follows these tags`, 'good', {
            actions: [
              {
                label: 'Rename',
                onPress: () =>
                  router.push({
                    pathname: '/playlists/[id]',
                    params: { id: String(created.id), rename: '1' },
                  }),
              },
              {
                label: 'Undo',
                onPress: () => {
                  setSavedName(null)
                  void clientApi()
                    .deletePlaylist(created.id)
                    .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.library }))
                    .catch((caught: unknown) =>
                      showToast(`Couldn’t undo that: ${(caught as Error).message}`, 'error'),
                    )
                },
              },
            ],
          })
        } catch (caught) {
          showToast(`Couldn’t save the playlist: ${(caught as Error).message}`, 'error')
        } finally {
          setSaving(false)
        }
      })()
    },
    [queryClient, router],
  )

  return { save, saving, savedName }
}

/**
 * The rule set behind "follows these tags": any of them, in the order the
 * library was showing.
 *
 * `any` rather than `all` is the whole of the library's tag rule — a saved
 * playlist that quietly meant something different from the list it was saved
 * from would be the worst kind of surprise. The sort comes along for the same
 * reason.
 */
export function followRules(input: {
  tagIds: readonly number[]
  sort: SongSortField
  descending: boolean
}): SmartRules {
  return {
    match: 'any',
    rules: input.tagIds.map(tagId => ({ field: 'tag' as const, op: 'has' as const, tagId })),
    orderBy: input.sort,
    order: (input.descending ? 'desc' : 'asc') satisfies SortDirection,
    limit: null,
  }
}
