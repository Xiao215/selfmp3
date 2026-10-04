import {
  failureText,
  useBulkTag,
  useCreateTag,
  useDeleteTag,
  useRenameTag,
  useUpdatePlaylist,
} from '@selfmp3/client'
import { showToast } from '../../ui/toast'
import { swapTagInRules, type TagRef, type TagStep } from './smart.model'

/** What applying did: whether every step was made, and how to take back the ones that were. */
interface TagChangesDone {
  readonly ok: boolean
  readonly undo: () => Promise<void>
}

/**
 * Makes tag changes one ordinary edit at a time (`tagSteps`), so each syncs
 * like an edit made by hand, and keeps how to take back each one made. A
 * deleted or merged tag comes back on Undo as a new tag of the same name and
 * colour, with its songs, and the playlists that followed it follow it again.
 */
export function useTagChanges(): (steps: readonly TagStep[]) => Promise<TagChangesDone> {
  const createTag = useCreateTag()
  const bulkTag = useBulkTag()
  const renameTag = useRenameTag()
  const deleteTag = useDeleteTag()
  const updatePlaylist = useUpdatePlaylist()
  // Making and renaming a tag say nothing when they fail; the other edits say so themselves.
  const make = (input: { name: string; hue?: number }) =>
    createTag.mutateAsync(input).catch((error: unknown) => {
      showToast(failureText('Couldn’t make the tag', error), 'error')
      throw error
    })
  const rename = (input: { id: number; name: string }) =>
    renameTag.mutateAsync(input).catch((error: unknown) => {
      showToast(failureText('Couldn’t rename the tag', error), 'error')
      throw error
    })

  /** A tag made again with its songs, and the playlists that followed it moved onto it. */
  const makeAgain = async (
    tag: { id: number; name: string; hue: number },
    songIds: readonly number[],
    playlists: readonly { id: number; rules: Parameters<typeof swapTagInRules>[0] }[],
  ): Promise<void> => {
    const made = await make({ name: tag.name, hue: tag.hue })
    if (songIds.length > 0) {
      await bulkTag.mutateAsync({ songIds: [...songIds], tagId: made.id, action: 'add' })
    }
    for (const playlist of playlists) {
      await updatePlaylist.mutateAsync({
        id: playlist.id,
        patch: { rules: swapTagInRules(playlist.rules, tag.id, made.id) },
      })
    }
  }

  return async steps => {
    const made = new Map<string, number>()
    const idOf = (ref: TagRef): number => ('id' in ref ? ref.id : made.get(ref.name.toLowerCase())!)
    const undo: (() => Promise<unknown>)[] = []
    let ok = true
    try {
      for (const step of steps) {
        switch (step.kind) {
          case 'make': {
            const tag = await make({ name: step.name })
            made.set(step.name.toLowerCase(), tag.id)
            undo.unshift(() => deleteTag.mutateAsync(tag.id))
            break
          }
          case 'songs': {
            const tagId = idOf(step.tag)
            const songIds = [...step.songIds]
            await bulkTag.mutateAsync({ songIds, tagId, action: step.action })
            const back = step.action === 'add' ? 'remove' : 'add'
            undo.unshift(() => bulkTag.mutateAsync({ songIds, tagId, action: back }))
            break
          }
          case 'rename':
            await rename({ id: step.tagId, name: step.to })
            undo.unshift(() => rename({ id: step.tagId, name: step.from }))
            break
          case 'merge': {
            const { from, into, gaining } = step
            if (gaining.length > 0) {
              await bulkTag.mutateAsync({ songIds: [...gaining], tagId: into.id, action: 'add' })
            }
            for (const playlist of step.playlists) {
              await updatePlaylist.mutateAsync({
                id: playlist.id,
                patch: { rules: swapTagInRules(playlist.rules, from.id, into.id) },
              })
            }
            await deleteTag.mutateAsync(from.id)
            undo.unshift(async () => {
              await makeAgain(from, step.songIds, step.playlists)
              if (gaining.length > 0) {
                await bulkTag.mutateAsync({
                  songIds: [...gaining],
                  tagId: into.id,
                  action: 'remove',
                })
              }
            })
            break
          }
          case 'delete':
            await deleteTag.mutateAsync(step.tag.id)
            undo.unshift(() => makeAgain(step.tag, step.songIds, step.playlists))
            break
        }
      }
    } catch {
      // The step that failed said so.
      ok = false
    }
    return {
      ok,
      undo: async () => {
        for (const step of undo) await step()
      },
    }
  }
}
