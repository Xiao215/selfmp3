import { useCallback, useState } from 'react'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { clientApi, failureText, queryKeys, useLibrary } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { showToast } from '../../ui/toast'
import { followRules } from '../library/saveTags'
import { newPlaylist } from '../playlists/playlists.model'
import {
  describeSource,
  savePlan,
  type ListSource,
  type SavePlan,
  type SourceLine,
} from './lists.model'
import { noteListSaved } from './recentLists.store'

/**
 * Up next's Save (docs/features/lists.md): what plays now, kept as a playlist.
 *
 * It asks nothing. Tags combined become a playlist that fills from them; an
 * answer, a search or songs you picked become a playlist of the songs in Up
 * next as they are. Up next then wears the playlist's name and the button says
 * it is saved, rather than going away and leaving you to wonder whether it
 * worked. The message after it offers the two things anyone wants then: to
 * open it, or not to have done it.
 */
export function useSaveUpNext(): {
  /** What the line over Up next says, or null when nothing is playing from anywhere named. */
  readonly line: SourceLine | null
  /** What Save would make, or null when there is nothing to save. */
  readonly plan: SavePlan | null
  readonly saving: boolean
  readonly save: () => void
} {
  const player = usePlayer()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: library } = useLibrary()
  const [saving, setSaving] = useState(false)

  const known = { tags: library?.tags ?? [], playlists: library?.playlists ?? [] }
  const source = player.source
  const line = source && player.queue.items.length > 0 ? describeSource(source, known) : null
  const plan = source && library ? savePlan(source, player.queue, known) : null

  const { setSource } = player
  const save = useCallback(() => {
    if (!plan || saving) return
    const before = source
    setSaving(true)
    void (async () => {
      try {
        const api = clientApi()
        const input =
          plan.kind === 'follow'
            ? newPlaylist('live', plan.name, {
                rules: followRules({ tagIds: plan.tagIds, sort: 'addedAt', descending: true }),
              })
            : newPlaylist('manual', plan.name)
        if (!input) return
        const created = await api.createPlaylist(input)
        if (plan.kind === 'songs')
          await api.addToPlaylist(created.id, { songIds: [...plan.songIds] })
        await queryClient.invalidateQueries({ queryKey: queryKeys.library })
        const kept: ListSource = {
          kind: 'playlist',
          playlistId: created.id,
          name: created.name,
          saved: true,
        }
        setSource(kept)
        // Played again from Recently played, it is simply that playlist.
        noteListSaved({ kind: 'playlist', playlistId: created.id, name: created.name })
        showToast(`Saved “${created.name}”`, 'good', {
          actions: [
            {
              label: 'Open',
              onPress: () =>
                router.navigate({
                  pathname: '/playlists/[id]',
                  params: { id: String(created.id) },
                }),
            },
            {
              label: 'Undo',
              onPress: () => {
                setSource(before)
                void api
                  .deletePlaylist(created.id)
                  .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.library }))
                  .catch((caught: unknown) =>
                    showToast(failureText('Couldn’t undo that', caught), 'error'),
                  )
              },
            },
          ],
        })
      } catch (caught) {
        showToast(failureText(`Couldn’t save “${plan.name}”`, caught), 'error')
      } finally {
        setSaving(false)
      }
    })()
  }, [plan, saving, source, setSource, queryClient, router])

  return { line, plan, saving, save }
}
