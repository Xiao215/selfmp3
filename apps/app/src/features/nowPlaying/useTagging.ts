import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutationState } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { usePlayer } from '../../player/PlayerProvider'
import {
  parseTagging,
  tagCloseStep,
  taggingLeft,
  taggingLine,
  type TagCloseStep,
} from './tagging.model'

export interface Tagging {
  /** Whether the page is in play-and-tag at all. */
  readonly on: boolean
  /** Whether the editor is raised for the song playing. */
  readonly open: boolean
  /** "Tagging · 3 to go". */
  readonly line: string
  /** Raise the editor again, from the page's own tag button. */
  readonly raise: () => void
  /** The editor's close, which decides whether to go on or stop. */
  readonly close: () => void
  /** Leave the mode, editor and all. */
  readonly stop: () => void
}

/**
 * Play-and-tag on Now Playing, for the phone page and the computer's stage
 * alike (`tagging.model.ts` has the rules).
 *
 * The editor is raised once for each song that comes up while the mode is on,
 * however it came up — tagged and moved on from, skipped by hand, or played
 * into from the song before. Closing it judges the song as the library has it:
 * the picker saves each tick as it is made, so the song itself says whether it
 * was given a tag.
 */
export function useTagging(): Tagging {
  const player = usePlayer()
  const router = useRouter()
  const { tagging } = useLocalSearchParams<{ tagging?: string }>()
  const on = parseTagging(tagging)
  const song = player.current
  const songId = song?.id ?? null
  const tagged = (song?.tagIds.length ?? 0) > 0
  const hasNext = player.songs[player.queue.index + 1] !== undefined

  // A tick on its way to the server: `useSetSongTags` names the song in what it sends.
  const saving =
    useMutationState({
      filters: {
        status: 'pending',
        predicate: mutation => isTagsFor(mutation.state.variables, songId),
      },
    }).length > 0

  const [open, setOpen] = useState(false)
  const [raisedFor, setRaisedFor] = useState<number | null>(null)
  // The song whose editor was closed while a tick was still being saved: it
  // is judged once the save lands. A ref, because judging it draws nothing.
  const judging = useRef<number | null>(null)

  // Adjusted during render rather than in an effect, so a new song never draws
  // a frame without its editor.
  if (on && songId !== null && raisedFor !== songId) {
    setRaisedFor(songId)
    setOpen(true)
  }
  if (!on && (raisedFor !== null || open)) {
    setRaisedFor(null)
    setOpen(false)
  }

  // Leaving is only the address: the mode's own state follows it, above.
  const leave = useCallback((): void => {
    judging.current = null
    router.setParams({ tagging: undefined })
  }, [router])

  const act = useCallback(
    (step: TagCloseStep): void => {
      if (step === 'wait') {
        judging.current = songId
        return
      }
      judging.current = null
      if (step === 'next') player.next()
      else leave()
    },
    [player, leave, songId],
  )

  const close = (): void => {
    setOpen(false)
    act(tagCloseStep({ tagged, saving, hasNext }))
  }

  useEffect(() => {
    // A song skipped past while its save was out is not judged at all.
    if (judging.current !== null && judging.current !== songId) judging.current = null
    if (judging.current === null || saving) return
    act(tagCloseStep({ tagged, saving, hasNext }))
  }, [saving, tagged, hasNext, songId, act])

  // The queue ran out from under the mode, or was cleared: nothing left to tag.
  useEffect(() => {
    if (on && songId === null) router.setParams({ tagging: undefined })
  }, [on, songId, router])

  return {
    on,
    open: on && open,
    line: taggingLine(taggingLeft(player.songs, player.queue.index)),
    raise: () => setOpen(true),
    close,
    stop: leave,
  }
}

function isTagsFor(variables: unknown, songId: number | null): boolean {
  if (songId === null || typeof variables !== 'object' || variables === null) return false
  const sent = variables as { songId?: unknown; tagIds?: unknown }
  return sent.songId === songId && Array.isArray(sent.tagIds)
}
