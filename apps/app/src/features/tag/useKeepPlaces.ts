import { useState } from 'react'
import { useRouter } from 'expo-router'
import { useCreatePlaylist } from '@selfmp3/client'
import { showFailure, showToast } from '../../ui/toast'
import { followRules } from '../lists/followRules'
import { combinedName, type TagMatch } from '../lists/lists.model'
import { newPlaylist } from '../playlists/playlists.model'
import { placeName, type Place } from './tag.model'

/**
 * The Combined page's Keep as playlist (C1, docs/features/lists.md): tags put
 * together become a playlist that fills from them, any or all as the page
 * shows — no need to play them first. With an artist among them there is no
 * rule to follow, so it keeps the songs on show.
 */
export function useKeepPlaces(
  places: readonly Place[],
  match: TagMatch,
  songIds: readonly number[],
): { readonly keeping: boolean; readonly keep: () => void } {
  const router = useRouter()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const [keeping, setKeeping] = useState(false)

  const keep = (): void => {
    if (keeping || places.length === 0) return
    const name = combinedName(places.map(placeName), match)
    const tagIds = places.flatMap(place => (place.kind === 'tag' ? [place.tag.id] : []))
    const follows = tagIds.length === places.length
    const input = follows
      ? newPlaylist('live', name, {
          rules: followRules({ tagIds, match, sort: 'addedAt', descending: true }),
        })
      : newPlaylist('manual', name)
    if (!input || (!follows && songIds.length === 0)) return
    setKeeping(true)
    void (async () => {
      try {
        const created = await createPlaylist({ input, songIds: follows ? [] : songIds })
        showToast(`Kept “${created.name}”`, 'good', {
          actions: [
            {
              label: 'Open',
              onPress: () =>
                router.navigate({
                  pathname: '/playlists/[id]',
                  params: { id: String(created.id) },
                }),
            },
          ],
        })
      } catch (caught) {
        showFailure(`Couldn’t keep “${name}”`, caught)
      } finally {
        setKeeping(false)
      }
    })()
  }
  return { keeping, keep }
}
