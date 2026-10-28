import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { useCreatePlaylist } from '@selfmp3/client'
import type { DescribeResult } from '@selfmp3/shared'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { showFailure, showToast } from '../../ui/toast'
import { newPlaylist } from '../playlists/playlists.model'
import { keptAnswer } from './answers.store'

/**
 * The answers already played as they came, by their kept id: played once
 * however often they are drawn again (a hidden turn, the page drawn anew, the
 * card beside the list it opened).
 */
const playedAsTheyCame = new Set<string>()

/**
 * A list asked to play, played as it comes ("Play now, rest proposes",
 * 2026-10-27): from its first song, once, as a playback answer is carried
 * out. Only the first list of a reply asked to play is `on`.
 */
export function usePlayAsItComes(
  keptId: string | undefined,
  ids: readonly number[],
  on: boolean,
): void {
  const player = usePlayerCommands()
  useEffect(() => {
    if (!on || !keptId || ids.length === 0 || playedAsTheyCame.has(keptId)) return
    const answer = keptAnswer(keptId)
    if (!answer) return
    playedAsTheyCame.add(keptId)
    player.playFrom(ids, 0, {
      source: {
        kind: 'answer',
        text: answer.text,
        name: answer.result.understanding.name,
        answerId: keptId,
      },
      whole: true,
    })
  }, [on, keptId, ids, player])
}

/**
 * A list asked to keep: Save makes the playlist of exactly the songs shown, by
 * the list's name, and says so with a way to open it.
 */
export function useSaveAnswer(
  result: DescribeResult | undefined,
  ids: readonly number[],
): { save: () => Promise<void>; saving: boolean; saved: string | null } {
  const router = useRouter()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    const input = result ? newPlaylist('manual', result.understanding.name) : null
    if (!input || ids.length === 0 || saving) return
    setSaving(true)
    try {
      const created = await createPlaylist({ input, songIds: [...ids] })
      setSaved(created.name)
      showToast(`Saved “${created.name}”`, 'good', {
        actions: [
          {
            label: 'Open',
            onPress: () =>
              router.navigate({ pathname: '/playlists/[id]', params: { id: String(created.id) } }),
          },
        ],
      })
    } catch (caught) {
      showFailure(`Couldn’t save “${input.name}”`, caught)
    } finally {
      setSaving(false)
    }
  }
  return { save, saving, saved }
}
